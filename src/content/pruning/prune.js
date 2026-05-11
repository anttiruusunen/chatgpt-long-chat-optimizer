import { state } from "../core/state.js";
import {
    getConversationContainer,
    getConversationSections,
    invalidateConversationDomCache,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { requestStoreHistoryPrune } from "../bridge/chatStoreBridgeClient.js";
import {
    hasAssistantFeedbackState,
    isIncompleteAssistantSection,
} from "../streaming/assistantSignals.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    hideContainer,
    revealContainer,
} from "./pruneUi.js";

function getLatestAssistantPruneDeferralReason(sections) {
    const latestSection = sections[sections.length - 1];

    if (!(latestSection instanceof HTMLElement)) {
        return null;
    }

    if (latestSection.getAttribute("data-turn") !== "assistant") {
        return null;
    }

    if (isIncompleteAssistantSection(latestSection)) {
        return "latest-assistant-incomplete";
    }

    if (hasAssistantFeedbackState(latestSection)) {
        return "latest-assistant-feedback";
    }

    return null;
}

function normalizeHistoryKeptExchanges(
    historyKeptExchanges = state.settings.historyKeptExchanges
) {
    return Math.max(
        1,
        Math.floor(Number(historyKeptExchanges) || 1)
    );
}

/**
 * Requests a store-native prune from the page bridge.
 *
 * DOM sections are deliberately not used as prune candidates. The page-context
 * bridge owns selecting store nodes to delete by walking the active ChatGPT
 * store branch from currentLeafId backwards.
 */
function requestStorePruneWithBridge({
    historyKeptExchanges = state.settings.historyKeptExchanges,
    reason = "store-prune",
} = {}) {
    const keepCount = normalizeHistoryKeptExchanges(historyKeptExchanges);

    if (isReplyStreaming()) {
        debugLog("Prune: deferred store pruning during active reply", {
            historyKeptExchanges: keepCount,
            reason,
        });

        return {
            posted: false,
            deferred: true,
            reason: "reply streaming",
            historyKeptExchanges: keepCount,
        };
    }

    const result = requestStoreHistoryPrune({
        historyKeptExchanges: keepCount,
        reason,
    });

    debugLog("Prune: requested store-native history prune", {
        historyKeptExchanges: result?.historyKeptExchanges ?? keepCount,
        posted: Boolean(result?.posted),
        reason: result?.reason || reason,
    });

    return {
        ...result,
        deferred: false,
        historyKeptExchanges: result?.historyKeptExchanges ?? keepCount,
    };
}

/**
 * Main pruning pass.
 *
 * Store-native only:
 * - content script does not choose DOM sections to prune
 * - content script does not soft-prune
 * - content script does not insert placeholder/sentinel UI
 * - page bridge chooses/removes old store nodes
 */
export function pruneOldSections(
    historyKeptExchanges = state.settings.historyKeptExchanges,
    options = {},
    {
        ensureObserverAttached,
        refreshObservedSections,
    } = {}
) {
    if (!state.featureFlags.pruning) {
        return {
            visibleSectionsChanged: false,
            placeholderChanged: false,
            posted: false,
            reason: "pruning disabled",
        };
    }

    ensureObserverAttached?.();

    const keepCount = normalizeHistoryKeptExchanges(historyKeptExchanges);
    const currentVisibleSections = getConversationSections();

    const latestAssistantPruneDeferralReason =
        currentVisibleSections.length > 0
            ? getLatestAssistantPruneDeferralReason(currentVisibleSections)
            : null;

    if (latestAssistantPruneDeferralReason) {
        debugLog("Prune: deferred because latest assistant is unstable", {
            reason: latestAssistantPruneDeferralReason,
            historyKeptExchanges: keepCount,
        });

        return {
            visibleSectionsChanged: false,
            placeholderChanged: false,
            posted: false,
            initialPruneDeferred: true,
            reason: latestAssistantPruneDeferralReason,
        };
    }

    const pruneResult = requestStorePruneWithBridge({
        historyKeptExchanges: keepCount,
        reason: options.reason || "prune-store-history",
    });

    invalidateConversationDomCache();
    refreshObservedSections?.();

    debugLog("Prune: store-native prune cycle completed", {
        visibleSections: currentVisibleSections.length,
        historyKeptExchanges: keepCount,
        storePrunePosted: Boolean(pruneResult?.posted),
        deferred: Boolean(pruneResult?.deferred),
        reason: pruneResult?.reason,
    });

    return {
        visibleSectionsChanged: Boolean(pruneResult?.posted),
        placeholderChanged: false,
        posted: Boolean(pruneResult?.posted),
        deferred: Boolean(pruneResult?.deferred),
        reason: pruneResult?.reason,
        result: pruneResult,
    };
}

/**
 * Runs startup prune behind an optional temporary mask.
 *
 * The mask prevents old turns from flashing during page load. We do not build
 * placeholder/sentinel UI anymore; after the store prune request we simply
 * reveal the container and refresh the observed sections.
 */
export function runInitialPrune(
    container,
    {
        pruneOldSections,
        refreshObservedSections,
        installStartupPruneMask,
        removeStartupPruneMask,
    },
    {
        useStartupMask = true,
    } = {}
) {
    if (!state.featureFlags.pruning) return;

    if (!state.settings.autoPrune || state.didInitialPrune) {
        return;
    }

    if (useStartupMask) {
        installStartupPruneMask?.();
        hideContainer(container);
    }

    requestAnimationFrame(() => {
        try {
            const result = pruneOldSections(
                state.settings.historyKeptExchanges,
                {
                    reason: "initial-prune",
                }
            );

            if (result?.initialPruneDeferred) {
                debugLog("Prune: initial prune deferred", {
                    reason: result.reason,
                    useStartupMask,
                });

                refreshObservedSections?.();
                return;
            }

            state.didInitialPrune = true;

            debugLog("Prune: initial prune completed", {
                ...result,
                useStartupMask,
            });

            refreshObservedSections?.();
        } catch (error) {
            console.error("[Thread Optimizer] Initial prune failed", error);
        } finally {
            if (!useStartupMask) {
                refreshObservedSections?.();
                return;
            }

            requestAnimationFrame(() => {
                revealContainer(container);

                requestAnimationFrame(() => {
                    const latestContainer = getConversationContainer();

                    refreshObservedSections?.();
                    removeStartupPruneMask?.();

                    debugLog("Prune: post-initial stabilization refresh completed", {
                        hasContainer: Boolean(latestContainer),
                        useStartupMask,
                    });
                });
            });
        }
    });
}