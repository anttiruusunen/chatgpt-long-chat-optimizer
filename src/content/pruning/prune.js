import {
    state,
} from "../core/state.js";
import {
    getConversationContainer,
    getConversationSections,
    getConversationScrollContainer,
    getConversationTurnRoot,
    invalidateConversationDomCache,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import {
    ensurePlaceholderState,
    removePlaceholder,
    hideContainer,
    revealContainer,
} from "./pruneUi.js";
import {
    ensureTopRestoreSentinelState,
    ensureBottomPruneSentinelState,
    getProtectedVisibleSections,
    markSectionUnpruneable,
    clearSectionUnpruneable,
    removeTopRestoreSentinel,
    removeBottomPruneSentinel,
} from "./pruneSentinels.js";
import {
    softPruneSections,
    restoreSoftPrunedSections,
} from "./pruneDom.js";
import {
    preserveScrollAfterRestore,
    preserveScrollAfterReprune,
} from "./pruneScroll.js";
import {
    requestStoreHistoryPrune,
} from "../bridge/chatStoreBridgeClient.js";
import {
    hasAssistantFeedbackState,
    isIncompleteAssistantSection,
} from "../streaming/assistantSignals.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";

const VISIBLE_EXCHANGES = 1;
const SECTIONS_PER_EXCHANGE = 2;

function getVisibleSectionsLimit() {
    return VISIBLE_EXCHANGES * SECTIONS_PER_EXCHANGE;
}

function getRecoverableSectionsLimit(
    historyKeptExchanges = state.settings.historyKeptExchanges
) {
    const safeExchanges = Math.max(1, Number(historyKeptExchanges) || 1);

    return safeExchanges * SECTIONS_PER_EXCHANGE;
}

function getSoftPrunedSectionsLimit(
    historyKeptExchanges = state.settings.historyKeptExchanges
) {
    return Math.max(
        0,
        getRecoverableSectionsLimit(historyKeptExchanges) -
            getVisibleSectionsLimit()
    );
}

function getDeferredReactPruneSections() {
    if (!Array.isArray(state.deferredReactPruneSections)) {
        state.deferredReactPruneSections = [];
    }

    return state.deferredReactPruneSections;
}

function updateHiddenCounts() {
    state.totalHiddenCount =
        state.softPrunedSections.length + state.hardEvictedCount;
    state.hiddenCount = state.totalHiddenCount;
    state.isPruned = state.totalHiddenCount > 0;
}

function getFirstAndLastVisibleSections() {
    const visibleSections = getConversationSections();

    return {
        visibleSections,
        firstVisibleSection: visibleSections[0] ?? null,
        lastVisibleSection: visibleSections[visibleSections.length - 1] ?? null,
    };
}

function refreshPruneChrome({
    showPlaceholder = true,
    refreshObservedSections,
    visibleSectionsChanged = false,
} = {}) {
    const { firstVisibleSection, lastVisibleSection } =
        getFirstAndLastVisibleSections();

    const placeholderChanged = showPlaceholder
        ? ensurePlaceholderState(firstVisibleSection)
        : false;

    ensureTopRestoreSentinelState(firstVisibleSection);
    ensureBottomPruneSentinelState(lastVisibleSection);

    if (visibleSectionsChanged) {
        refreshObservedSections?.();
    }

    return placeholderChanged;
}

function getLatestAssistantPruneDeferralReason(sections) {
    const latestSection = sections[sections.length - 1];

    if (latestSection?.getAttribute("data-turn") !== "assistant") {
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

function getAssistantFeedbackSections(sections) {
    return sections.filter(
        (section) =>
            section instanceof HTMLElement &&
            section.getAttribute("data-turn") === "assistant" &&
            hasAssistantFeedbackState(section)
    );
}

/**
 * Requests a store-native prune from the page bridge.
 *
 * DOM sections are deliberately ignored here. The page-context bridge owns
 * selecting nodes to delete by traversing the active ChatGPT store branch from
 * currentLeafId backwards.
 */
function requestStorePruneWithBridge({
    historyKeptExchanges = state.settings.historyKeptExchanges,
    reason = "store-prune",
} = {}) {
    if (isReplyStreaming()) {
        debugLog("Prune: deferred store pruning during active reply", {
            historyKeptExchanges,
            reason,
        });

        return {
            prunedCount: 0,
            posted: false,
            deferred: true,
            reason: "reply streaming",
        };
    }

    const result = requestStoreHistoryPrune({
        historyKeptExchanges,
        reason,
    });

    debugLog("Prune: requested store-native history prune", {
        historyKeptExchanges: result.historyKeptExchanges,
        posted: Boolean(result.posted),
        reason: result.reason || reason,
    });

    return {
        ...result,
        prunedCount: 0,
        deferred: false,
    };
}

export function enforceSoftPrunedLimit() {
    /*
     * Store pruning is now authoritative. Do not hard-prune DOM sections from
     * the content script and do not extract message ids from detached shells.
     */
    const staleSoftPrunedCount = state.softPrunedSections.length;
    const staleDeferredCount = getDeferredReactPruneSections().length;

    state.softPrunedSections = [];
    state.deferredReactPruneSections = [];
    updateHiddenCounts();

    if (staleSoftPrunedCount > 0 || staleDeferredCount > 0) {
        debugLog("Prune: cleared stale DOM-side prune buffers", {
            staleSoftPrunedCount,
            staleDeferredCount,
            totalHiddenCount: state.totalHiddenCount,
        });
    }

    return requestStorePruneWithBridge({
        historyKeptExchanges: state.settings.historyKeptExchanges,
        reason: "apply-store-pruned-limit",
    });
}

export function restoreOneExchangeFromSoftPruned({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!state.featureFlags.pruning || !state.softPrunedSections.length) {
        return { visibleSectionsChanged: false, restoredSectionsCount: 0 };
    }

    ensureObserverAttached();

    const container = getConversationContainer();
    if (!container) {
        console.warn("[Thread Optimizer] No conversation container found");
        return { visibleSectionsChanged: false, restoredSectionsCount: 0 };
    }

    const scrollContainer = getConversationScrollContainer();

    let visibleSectionsChanged = false;
    let restoredSectionsCount = 0;
    let anchorSection = null;
    let anchorTopBefore = null;
    let lastRestoredSection = null;

    withDomMutationGuard(() => {
        const restoreCount = Math.min(
            SECTIONS_PER_EXCHANGE,
            state.softPrunedSections.length
        );
        const sectionsToRestore = state.softPrunedSections.splice(
            state.softPrunedSections.length - restoreCount,
            restoreCount
        );

        anchorSection = getConversationSections()[0] ?? null;
        anchorTopBefore = anchorSection?.getBoundingClientRect().top ?? null;

        restoredSectionsCount = restoreSoftPrunedSections(
            sectionsToRestore,
            container,
            anchorSection,
            {
                onRestore: (section) => {
                    markSectionUnpruneable(section);
                    lastRestoredSection = section;
                },
            }
        );

        invalidateConversationDomCache();

        visibleSectionsChanged = restoredSectionsCount > 0;
        updateHiddenCounts();

        refreshPruneChrome({
            refreshObservedSections,
            visibleSectionsChanged,
        });

        debugLog("Prune: restored one exchange from soft-pruned buffer", {
            restoredSectionsCount,
            softPrunedSectionsRemaining: state.softPrunedSections.length,
            hardEvictedCount: state.hardEvictedCount,
            totalHiddenCount: state.totalHiddenCount,
        });
    });

    preserveScrollAfterRestore({
        visibleSectionsChanged,
        anchorSection,
        anchorTopBefore,
        lastRestoredSection,
        scrollContainer,
    });

    return { visibleSectionsChanged, restoredSectionsCount };
}

export function repruneOneExchangeFromVisibleProtected({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!state.featureFlags.pruning) {
        return { visibleSectionsChanged: false, reprunedSectionsCount: 0 };
    }

    const protectedVisibleSections = getProtectedVisibleSections();
    if (!protectedVisibleSections.length) {
        return { visibleSectionsChanged: false, reprunedSectionsCount: 0 };
    }

    ensureObserverAttached();

    const container = getConversationContainer();
    if (!container) {
        console.warn("[Thread Optimizer] No conversation container found");
        return { visibleSectionsChanged: false, reprunedSectionsCount: 0 };
    }

    const scrollContainer = getConversationScrollContainer();

    let visibleSectionsChanged = false;
    let reprunedSectionsCount = 0;
    let anchorSection = null;
    let anchorTopBefore = null;

    withDomMutationGuard(() => {
        const sectionsToReprune = protectedVisibleSections.slice(
            0,
            SECTIONS_PER_EXCHANGE
        );

        anchorSection =
            sectionsToReprune[sectionsToReprune.length - 1]?.nextElementSibling ??
            null;
        anchorTopBefore = anchorSection?.getBoundingClientRect().top ?? null;

        for (const section of sectionsToReprune) {
            clearSectionUnpruneable(section);
        }

        reprunedSectionsCount = softPruneSections(sectionsToReprune);
        invalidateConversationDomCache();

        state.softPrunedSections.push(...sectionsToReprune);

        visibleSectionsChanged = reprunedSectionsCount > 0;

        enforceSoftPrunedLimit();

        refreshPruneChrome({
            refreshObservedSections,
            visibleSectionsChanged,
        });

        debugLog("Prune: repruned one exchange from protected visible sections", {
            reprunedSectionsCount,
            softPrunedSections: state.softPrunedSections.length,
            protectedVisibleSectionsRemaining: getProtectedVisibleSections().length,
            hardEvictedCount: state.hardEvictedCount,
            totalHiddenCount: state.totalHiddenCount,
        });
    });

    preserveScrollAfterReprune({
        visibleSectionsChanged,
        anchorSection,
        anchorTopBefore,
        scrollContainer,
    });

    return { visibleSectionsChanged, reprunedSectionsCount };
}

export function restoreAllSections({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!state.featureFlags.pruning) {
        return { visibleSectionsChanged: false };
    }

    ensureObserverAttached();

    const container = getConversationContainer();
    if (!container) {
        console.warn("[Thread Optimizer] No conversation container found");
        return { visibleSectionsChanged: false };
    }

    let visibleSectionsChanged = false;

    withDomMutationGuard(() => {
        const restoredCount = state.softPrunedSections.length;
        const firstVisibleSectionBeforeRestore =
            getConversationSections()[0] ?? null;

        removePlaceholder();
        removeTopRestoreSentinel();
        removeBottomPruneSentinel();

        restoreSoftPrunedSections(
            state.softPrunedSections,
            container,
            firstVisibleSectionBeforeRestore
        );

        invalidateConversationDomCache();

        visibleSectionsChanged = restoredCount > 0;
        state.softPrunedSections = [];

        updateHiddenCounts();

        refreshPruneChrome({
            refreshObservedSections,
            visibleSectionsChanged,
        });

        debugLog("Prune: restored soft-pruned sections", {
            restoredCount,
            totalHiddenCount: state.totalHiddenCount,
            hardEvictedCount: state.hardEvictedCount,
            visibleSectionsChanged,
        });
    });

    return { visibleSectionsChanged };
}

/**
 * Main pruning pass.
 *
 * Keeps the latest exchange visible, keeps restored/protected sections visible,
 * preserves the latest incomplete assistant during reload/startup, soft-prunes
 * recoverable older sections, and React-prunes overflow beyond the configured
 * history buffer.
 */
export function pruneOldSections(
    historyKeptExchanges = state.settings.historyKeptExchanges,
    options = {},
    {
        ensureObserverAttached,
        withDomMutationGuard,
        refreshObservedSections,
    }
) {
    if (!state.featureFlags.pruning) {
        return { visibleSectionsChanged: false, placeholderChanged: false };
    }

    ensureObserverAttached();

    const { showPlaceholder = true } = options;

    const container = getConversationContainer();
    if (!container) {
        console.warn("[Thread Optimizer] No conversation container found");
        return {
            visibleSectionsChanged: false,
            placeholderChanged: false,
            initialPruneDeferred: true,
            reason: "no-conversation-container",
        };
    }

    const currentVisibleSections = getConversationSections();
    if (!currentVisibleSections.length) {
        console.warn("[Thread Optimizer] No sections available");
        return {
            visibleSectionsChanged: false,
            placeholderChanged: false,
            initialPruneDeferred: true,
            reason: "no-sections",
        };
    }

    const latestAssistantPruneDeferralReason =
        getLatestAssistantPruneDeferralReason(currentVisibleSections);

    if (latestAssistantPruneDeferralReason) {
        debugLog("Prune: deferred because latest assistant is unstable", {
            reason: latestAssistantPruneDeferralReason,
        });

        return {
            visibleSectionsChanged: false,
            placeholderChanged: false,
            initialPruneDeferred: true,
            reason: latestAssistantPruneDeferralReason,
        };
    }

    let placeholderChanged = false;
    let visibleSectionsChanged = false;

    withDomMutationGuard(() => {
        const previousHiddenCount = state.hiddenCount;
        const previousTotalHiddenCount = state.totalHiddenCount;
        const previousHardEvictedCount = state.hardEvictedCount;
        const staleSoftPrunedCount = state.softPrunedSections.length;
        const staleDeferredCount = getDeferredReactPruneSections().length;

        removePlaceholder();
        removeTopRestoreSentinel();
        removeBottomPruneSentinel();

        state.softPrunedSections = [];
        state.deferredReactPruneSections = [];

        const pruneResult = requestStorePruneWithBridge({
            historyKeptExchanges,
            reason: "prune-store-history",
        });

        updateHiddenCounts();
        invalidateConversationDomCache();

        placeholderChanged = refreshPruneChrome({
            showPlaceholder,
            refreshObservedSections,
            visibleSectionsChanged: false,
        });

        const countsChanged =
            state.hiddenCount !== previousHiddenCount ||
            state.totalHiddenCount !== previousTotalHiddenCount ||
            state.hardEvictedCount !== previousHardEvictedCount ||
            staleSoftPrunedCount > 0 ||
            staleDeferredCount > 0;

        visibleSectionsChanged = Boolean(pruneResult.posted);

        if (!visibleSectionsChanged && !placeholderChanged && !countsChanged) {
            debugLog("Prune: skipped no-op cycle", {
                visibleSections: currentVisibleSections.length,
                totalHiddenCount: state.totalHiddenCount,
                hardEvictedCount: state.hardEvictedCount,
                historyKeptExchanges,
                reason: pruneResult.reason,
            });
            return;
        }

        debugLog("Prune: store-native prune cycle completed", {
            visibleSections: currentVisibleSections.length,
            historyKeptExchanges,
            storePrunePosted: Boolean(pruneResult.posted),
            deferred: Boolean(pruneResult.deferred),
            staleSoftPrunedCount,
            staleDeferredCount,
            totalHiddenCount: state.totalHiddenCount,
            hardEvictedCount: state.hardEvictedCount,
            placeholderChanged,
            countsChanged,
            visibleSectionsChanged,
            showPlaceholder,
        });
    });

    return { visibleSectionsChanged, placeholderChanged };
}

/**
 * Runs the startup prune behind an optional temporary mask.
 *
 * The mask prevents old turns from flashing during page load. A follow-up
 * stabilization frame refreshes placeholder/sentinel/offscreen state after
 * the DOM has settled.
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
                { showPlaceholder: false }
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

            const placeholderChanged = refreshPruneChrome({
                refreshObservedSections,
                visibleSectionsChanged: false,
            });

            debugLog("Prune: initial prune completed", {
                ...result,
                placeholderChanged,
                useStartupMask,
            });

            if (!result?.visibleSectionsChanged) {
                refreshObservedSections();
            }
        } catch (error) {
            console.error("[Thread Optimizer] Initial prune failed", error);
        } finally {
            if (!useStartupMask) {
                const latestContainer = getConversationContainer();

                if (latestContainer) {
                    refreshPruneChrome({
                        refreshObservedSections,
                        visibleSectionsChanged: true,
                    });

                    debugLog(
                        "Prune: post-initial stabilization refresh completed without startup mask",
                        {
                            hasContainer: Boolean(latestContainer),
                            softPrunedSections: state.softPrunedSections.length,
                            totalHiddenCount: state.totalHiddenCount,
                            useStartupMask,
                        }
                    );
                }

                return;
            }

            requestAnimationFrame(() => {
                revealContainer(container);

                requestAnimationFrame(() => {
                    const latestContainer = getConversationContainer();

                    if (!latestContainer) {
                        removeStartupPruneMask?.();
                        return;
                    }

                    refreshPruneChrome({
                        refreshObservedSections,
                        visibleSectionsChanged: true,
                    });

                    removeStartupPruneMask?.();

                    debugLog("Prune: post-initial stabilization refresh completed", {
                        hasContainer: Boolean(latestContainer),
                        softPrunedSections: state.softPrunedSections.length,
                        totalHiddenCount: state.totalHiddenCount,
                        useStartupMask,
                    });
                });
            });
        }
    });
}
