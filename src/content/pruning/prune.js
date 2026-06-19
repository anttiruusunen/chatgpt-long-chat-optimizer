import { state } from "../core/state.js";
import {
    getConversationContainer,
    getConversationSections,
    invalidateConversationDomCache,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { requestStoreHistoryPrune } from "../bridge/chatStoreBridgeClient.js";
import {
    hasAssistantActiveGenerationState,
    hasAssistantFeedbackState,
    isIncompleteAssistantSection,
} from "../streaming/assistantSignals.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";

const CONVERSATION_TURN_SELECTOR =
    'section[data-turn], section[data-testid^="conversation-turn-"], [data-turn-id-container]';

const STORE_PRUNE_TURN_STABILITY_MS = 350;

let lastTurnSnapshot = {
    count: -1,
    changedAt: 0,
};

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
    return Math.max(1, Math.floor(Number(historyKeptExchanges) || 1));
}

function getVisibleConversationTurnCount() {
    return document.querySelectorAll(CONVERSATION_TURN_SELECTOR).length;
}

function getTurnStabilityState(now = performance.now()) {
    const count = getVisibleConversationTurnCount();

    if (count !== lastTurnSnapshot.count) {
        lastTurnSnapshot = {
            count,
            changedAt: now,
        };
    }

    return {
        count,
        stableForMs: Math.max(0, now - lastTurnSnapshot.changedAt),
    };
}

function shouldDeferStorePruneForTurnStability() {
    const stability = getTurnStabilityState();

    if (stability.count <= 0) {
        return {
            defer: true,
            reason: "conversation turns unavailable",
            ...stability,
        };
    }

    if (stability.stableForMs < STORE_PRUNE_TURN_STABILITY_MS) {
        return {
            defer: true,
            reason: "conversation turns unstable",
            requiredStableMs: STORE_PRUNE_TURN_STABILITY_MS,
            ...stability,
        };
    }

    return {
        defer: false,
        ...stability,
    };
}

export function resetStorePruneTurnStabilityForTests({
    count = -1,
    changedAt = 0,
} = {}) {
    lastTurnSnapshot = {
        count,
        changedAt,
    };
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

    if (hasAssistantActiveGenerationState(document)) {
        debugLog("Prune: deferred store pruning during active assistant generation", {
            historyKeptExchanges: keepCount,
            reason,
        });

        return {
            posted: false,
            deferred: true,
            reason: "assistant generation active",
            historyKeptExchanges: keepCount,
        };
    }

    const turnStability = shouldDeferStorePruneForTurnStability();

    if (turnStability.defer) {
        debugLog("Prune: deferred store pruning until conversation turns stabilize", {
            historyKeptExchanges: keepCount,
            reason,
            deferReason: turnStability.reason,
            visibleTurnCount: turnStability.count,
            stableForMs: Math.round(turnStability.stableForMs),
            requiredStableMs: turnStability.requiredStableMs,
        });

        return {
            posted: false,
            deferred: true,
            reason: turnStability.reason,
            historyKeptExchanges: keepCount,
            visibleTurnCount: turnStability.count,
            stableForMs: turnStability.stableForMs,
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
            deferred: true,
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
        requestId: pruneResult?.requestId ?? null,
        deferred: Boolean(pruneResult?.deferred),
        reason: pruneResult?.reason,
        result: pruneResult,
    };
}

/**
 * Runs the startup/navigation prune.
 */
export function runInitialPrune(
    container,
    {
        pruneOldSections,
        refreshObservedSections,
        onPruneStarted,
        onPruneResult,
        onPruneFinished,
    } = {}
) {
    if (!state.featureFlags.pruning) return;
    if (!state.settings.autoPrune || state.didInitialPrune) {
        return;
    }

    requestAnimationFrame(() => {
        let result = null;

        try {
            onPruneStarted?.();

            result = pruneOldSections?.(
                state.settings.historyKeptExchanges,
                {
                    reason: "initial-prune",
                }
            );

            onPruneResult?.(result);

            if (result?.deferred) {
                debugLog("Prune: initial prune deferred", {
                    reason: result.reason,
                });

                refreshObservedSections?.();
                return;
            }

            state.didInitialPrune = true;

            debugLog("Prune: initial prune completed", {
                ...result,
            });

            if (!result?.visibleSectionsChanged) {
                refreshObservedSections?.();
            }
        } catch (error) {
            console.error("[Long Chat Optimizer] Initial prune failed", error);
            onPruneFinished?.({
                reason: "initial-prune-error",
                error,
                result,
            });
        } finally {
            requestAnimationFrame(() => {
                const latestContainer = getConversationContainer();

                if (!latestContainer) {
                    onPruneFinished?.({
                        reason: "initial-prune-no-container",
                        result,
                    });
                    return;
                }

                refreshObservedSections?.();

                debugLog("Prune: post-initial stabilization refresh completed", {
                    hasContainer: Boolean(latestContainer),
                    hadInitialContainer: container instanceof Element,
                });

                if (!result?.posted || result?.deferred || !result?.requestId) {
                    onPruneFinished?.({
                        reason: result?.deferred
                            ? "initial-prune-deferred"
                            : "initial-prune-no-store-request",
                        result,
                    });
                }
            });
        }
    });
}