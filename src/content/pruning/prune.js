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
    pruneSectionsWithReactStoreBridge,
} from "../bridge/chatStoreBridgeClient.js";
import { isIncompleteAssistantSection } from "../streaming/assistantSignals.js";

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

function getLatestIncompleteAssistantSection(sections) {
    const latestSection = sections[sections.length - 1];

    if (
        latestSection?.getAttribute("data-turn") === "assistant" &&
        isIncompleteAssistantSection(latestSection)
    ) {
        return latestSection;
    }

    return null;
}

/**
 * Permanently prunes sections that exceed the recoverable soft-prune buffer.
 *
 * Important:
 * This no longer hard-removes DOM nodes. It sends message ids to the page
 * bridge, which deletes the matching ChatGPT store nodes via deleteNode().
 * React then owns DOM reconciliation.
 */
function reactPruneSectionsWithBridge(
    sections,
    {
        reason = "react-prune-overflow",
    } = {}
) {
    const candidates = sections.filter(
        (section) => section instanceof HTMLElement
    );

    if (candidates.length === 0) {
        return {
            prunedCount: 0,
            posted: false,
            messageIds: [],
            reason: "no candidate sections",
        };
    }

    const result = pruneSectionsWithReactStoreBridge(candidates, {
        reason,
    });

    const prunedCount = result?.posted
        ? result.messageIds?.length || 0
        : 0;

    debugLog("Prune: sent sections to React store prune", {
        sections: sections.length,
        candidates: candidates.length,
        prunedCount,
        posted: Boolean(result?.posted),
        messageIds: result?.messageIds || [],
        reason: result?.reason || reason,
    });

    return {
        ...result,
        prunedCount,
    };
}

export function enforceSoftPrunedLimit() {
    const maxSoftPrunedSections = getSoftPrunedSectionsLimit();

    if (state.softPrunedSections.length > maxSoftPrunedSections) {
        const overflowCount =
            state.softPrunedSections.length - maxSoftPrunedSections;
        const overflowSections = state.softPrunedSections.splice(0, overflowCount);
        const pruneResult = reactPruneSectionsWithBridge(overflowSections, {
            reason: "soft-pruned-overflow",
        });

        state.hardEvictedCount += pruneResult.prunedCount || 0;

        debugLog("Prune: React-pruned soft-pruned overflow sections", {
            overflowCount,
            softPrunedRemaining: state.softPrunedSections.length,
            maxSoftPrunedSections,
            reactPrunedCount: pruneResult.prunedCount || 0,
            hardEvictedCount: state.hardEvictedCount,
            totalHiddenCount: state.totalHiddenCount,
            posted: Boolean(pruneResult.posted),
        });
    }

    updateHiddenCounts();
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
        return { visibleSectionsChanged: false, placeholderChanged: false };
    }

    const currentVisibleSections = getConversationSections();
    if (!currentVisibleSections.length) {
        console.warn("[Thread Optimizer] No sections available");
        return { visibleSectionsChanged: false, placeholderChanged: false };
    }

    const detachedSoftPrunedSections = state.softPrunedSections.filter(
        (section) =>
            section instanceof Element &&
            !getConversationTurnRoot(section)?.isConnected
    );

    const logicalSections = detachedSoftPrunedSections.concat(currentVisibleSections);

    const visibleSectionsLimit = getVisibleSectionsLimit();
    const softPrunedSectionsLimit =
        getSoftPrunedSectionsLimit(historyKeptExchanges);

    const latestVisibleSections =
        currentVisibleSections.slice(-visibleSectionsLimit);
    const protectedVisibleSections = getProtectedVisibleSections();
    const incompleteLatestAssistantSection =
        getLatestIncompleteAssistantSection(currentVisibleSections);

    const targetVisibleSet = new Set([
        ...latestVisibleSections,
        ...protectedVisibleSections,
        ...(incompleteLatestAssistantSection
            ? [incompleteLatestAssistantSection]
            : []),
    ]);

    const pruneableLogicalSections = logicalSections.filter(
        (section) => !targetVisibleSet.has(section)
    );

    const evictCutoff = Math.max(
        0,
        pruneableLogicalSections.length - softPrunedSectionsLimit
    );

    const sectionsToReactPruneNow = pruneableLogicalSections.slice(0, evictCutoff);
    const sectionsToSoftPrune = pruneableLogicalSections.slice(evictCutoff);
    const sectionsToKeepVisible = logicalSections.filter((section) =>
        targetVisibleSet.has(section)
    );

    let visibleSectionsChanged = false;
    let placeholderChanged = false;

    withDomMutationGuard(() => {
        const previousHiddenCount = state.hiddenCount;
        const previousTotalHiddenCount = state.totalHiddenCount;
        const previousHardEvictedCount = state.hardEvictedCount;
        const previousSoftPrunedSections = state.softPrunedSections;

        removePlaceholder();
        removeTopRestoreSentinel();
        removeBottomPruneSentinel();

        const reactPruneResult = reactPruneSectionsWithBridge(
            sectionsToReactPruneNow,
            {
                reason: "prune-old-sections",
            }
        );

        const softPrunedCount = softPruneSections(sectionsToSoftPrune);

        const sectionsToRestore = sectionsToKeepVisible.filter((section) => {
            const turnRoot = getConversationTurnRoot(section);
            return !turnRoot?.isConnected;
        });

        const restoredCount = restoreSoftPrunedSections(
            sectionsToRestore,
            container
        );

        invalidateConversationDomCache();

        state.softPrunedSections = [...sectionsToSoftPrune];
        state.hardEvictedCount += reactPruneResult.prunedCount || 0;

        updateHiddenCounts();

        const countsChanged =
            state.hiddenCount !== previousHiddenCount ||
            state.totalHiddenCount !== previousTotalHiddenCount ||
            state.hardEvictedCount !== previousHardEvictedCount ||
            previousSoftPrunedSections.length !== state.softPrunedSections.length ||
            previousSoftPrunedSections.some(
                (section, index) => state.softPrunedSections[index] !== section
            );

        visibleSectionsChanged =
            (reactPruneResult.prunedCount || 0) > 0 ||
            softPrunedCount > 0 ||
            restoredCount > 0;

        placeholderChanged = refreshPruneChrome({
            showPlaceholder,
            refreshObservedSections,
            visibleSectionsChanged,
        });

        const domChanged = visibleSectionsChanged || placeholderChanged;

        if (!domChanged && !countsChanged) {
            debugLog("Prune: skipped no-op cycle", {
                visibleSections: currentVisibleSections.length,
                protectedVisibleSections: protectedVisibleSections.length,
                latestVisibleSections: latestVisibleSections.length,
                softPrunedSections: state.softPrunedSections.length,
                totalHiddenCount: state.totalHiddenCount,
                hardEvictedCount: state.hardEvictedCount,
            });
            return;
        }

        debugLog("Prune: prune cycle completed", {
            visibleSections: currentVisibleSections.length,
            protectedVisibleSections: protectedVisibleSections.length,
            latestVisibleSections: latestVisibleSections.length,
            reactPrunedSections: reactPruneResult.prunedCount || 0,
            reactPrunePosted: Boolean(reactPruneResult.posted),
            newlySoftPrunedSections: softPrunedCount,
            restoredSections: restoredCount,
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