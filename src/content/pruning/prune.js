import {
    state,
    PRUNED_ATTR,
    UNPRUNEABLE_ATTR,
} from "../core/state.js";
import {
    getConversationContainer,
    getConversationSections,
    getConversationScrollContainer,
    getConversationTurnRoot,
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
    hasProtectedVisibleSections,
    markSectionUnpruneable,
    clearSectionUnpruneable,
    removeTopRestoreSentinel,
    removeBottomPruneSentinel,
} from "./pruneSentinels.js";
import {
    hardEvictSection,
    hardEvictSections,
    softPruneSection,
    softPruneSections,
    restoreSoftPrunedSection,
    restoreSoftPrunedSections,
} from "./pruneDom.js";
import {
    preserveScrollAfterRestore,
    preserveScrollAfterReprune,
} from "./pruneScroll.js";

const VISIBLE_EXCHANGES = 1;
const SECTIONS_PER_EXCHANGE = 2;

function getVisibleSectionsLimit() {
    return VISIBLE_EXCHANGES * SECTIONS_PER_EXCHANGE;
}

function getRecoverableSectionsLimit(historyKeptExchanges = state.settings.historyKeptExchanges) {
    const safeExchanges = Math.max(1, Number(historyKeptExchanges) || 1);
    return safeExchanges * SECTIONS_PER_EXCHANGE;
}

function getSoftPrunedSectionsLimit(historyKeptExchanges = state.settings.historyKeptExchanges) {
    return Math.max(0, getRecoverableSectionsLimit(historyKeptExchanges) - getVisibleSectionsLimit());
}

function updateHiddenCounts() {
    state.totalHiddenCount = state.softPrunedSections.length + state.hardEvictedCount;
    state.hiddenCount = state.totalHiddenCount;
    state.isPruned = state.hiddenCount > 0;
}

export function enforceSoftPrunedLimit() {
    const maxSoftPrunedSections = getSoftPrunedSectionsLimit();

    if (maxSoftPrunedSections != null && state.softPrunedSections.length > maxSoftPrunedSections) {
        const overflowCount = state.softPrunedSections.length - maxSoftPrunedSections;
        const evicted = state.softPrunedSections.splice(0, overflowCount);
        const evictedCount = hardEvictSections(evicted);
        state.hardEvictedCount += evictedCount;

        debugLog("Prune: evicted soft-pruned sections from memory", {
            overflowCount,
            softPrunedRemaining: state.softPrunedSections.length,
            maxSoftPrunedSections,
            hardEvictedCount: state.hardEvictedCount,
        });
    }

    updateHiddenCounts();
}

export function restoreOneExchangeFromSoftPruned({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!state.featureFlags.pruning) {
        return { visibleSectionsChanged: false, restoredSectionsCount: 0 };
    }

    if (!state.softPrunedSections.length) {
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
        const restoreCount = Math.min(SECTIONS_PER_EXCHANGE, state.softPrunedSections.length);
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
        visibleSectionsChanged = restoredSectionsCount > 0;

        updateHiddenCounts();

        const nextVisibleSections = getConversationSections();
        const nextFirstVisibleSection = nextVisibleSections[0] ?? null;
        const nextLastVisibleSection = nextVisibleSections[nextVisibleSections.length - 1] ?? null;

        ensurePlaceholderState(nextFirstVisibleSection);
        ensureTopRestoreSentinelState(nextFirstVisibleSection);
        ensureBottomPruneSentinelState(nextLastVisibleSection);

        if (visibleSectionsChanged) {
            refreshObservedSections();
        }

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
        const sectionsToReprune = protectedVisibleSections.slice(0, SECTIONS_PER_EXCHANGE);

        anchorSection = sectionsToReprune[sectionsToReprune.length - 1]?.nextElementSibling ?? null;
        anchorTopBefore = anchorSection?.getBoundingClientRect().top ?? null;

        for (const section of sectionsToReprune) {
            clearSectionUnpruneable(section);
        }

        reprunedSectionsCount = softPruneSections(sectionsToReprune);
        state.softPrunedSections.push(...sectionsToReprune);
        visibleSectionsChanged = reprunedSectionsCount > 0;

        enforceSoftPrunedLimit();

        const nextVisibleSections = getConversationSections();
        const nextFirstVisibleSection = nextVisibleSections[0] ?? null;
        const nextLastVisibleSection = nextVisibleSections[nextVisibleSections.length - 1] ?? null;

        ensurePlaceholderState(nextFirstVisibleSection);
        ensureTopRestoreSentinelState(nextFirstVisibleSection);
        ensureBottomPruneSentinelState(nextLastVisibleSection);

        if (visibleSectionsChanged) {
            refreshObservedSections();
        }

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
    if (!state.featureFlags.pruning) return { visibleSectionsChanged: false };

    ensureObserverAttached();

    const container = getConversationContainer();
    if (!container) {
        console.warn("[Thread Optimizer] No conversation container found");
        return { visibleSectionsChanged: false };
    }

    let visibleSectionsChanged = false;

    withDomMutationGuard(() => {
        const restoredCount = state.softPrunedSections.length;
        const firstVisibleSection = getConversationSections()[0] ?? null;

        removePlaceholder();
        removeTopRestoreSentinel();
        removeBottomPruneSentinel();

        restoreSoftPrunedSections(
            state.softPrunedSections,
            container,
            firstVisibleSection
        );

        visibleSectionsChanged = restoredCount > 0;
        state.softPrunedSections = [];

        updateHiddenCounts();

        const nextVisibleSections = getConversationSections();
        const nextFirstVisibleSection = nextVisibleSections[0] ?? null;
        const nextLastVisibleSection = nextVisibleSections[nextVisibleSections.length - 1] ?? null;

        ensurePlaceholderState(nextFirstVisibleSection);
        ensureTopRestoreSentinelState(nextFirstVisibleSection);
        ensureBottomPruneSentinelState(nextLastVisibleSection);

        if (visibleSectionsChanged) {
            refreshObservedSections();
        }

        debugLog("Prune: restored soft-pruned sections", {
            restoredCount,
            totalHiddenCount: state.totalHiddenCount,
            hardEvictedCount: state.hardEvictedCount,
            visibleSectionsChanged,
        });
    });

    return { visibleSectionsChanged };
}

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

    const logicalSections = [
        ...state.softPrunedSections.filter(
            (section) => section instanceof Element && !getConversationTurnRoot(section)?.isConnected
        ),
        ...currentVisibleSections,
    ];

    const visibleSectionsLimit = getVisibleSectionsLimit();
    const softPrunedSectionsLimit = getSoftPrunedSectionsLimit(historyKeptExchanges);

    const latestVisibleSections = currentVisibleSections.slice(-visibleSectionsLimit);
    const protectedVisibleSections = getProtectedVisibleSections();

    const targetVisibleSet = new Set([
        ...latestVisibleSections,
        ...protectedVisibleSections,
    ]);

    const pruneableLogicalSections = logicalSections.filter(
        (section) => !targetVisibleSet.has(section)
    );

    const evictCutoff = Math.max(0, pruneableLogicalSections.length - softPrunedSectionsLimit);
    const sectionsToEvictNow = pruneableLogicalSections.slice(0, evictCutoff);
    const sectionsToSoftPrune = pruneableLogicalSections.slice(evictCutoff);
    const sectionsToKeepVisible = logicalSections.filter(
        (section) => targetVisibleSet.has(section)
    );

    let visibleSectionsChanged = false;
    let placeholderChanged = false;

    withDomMutationGuard(() => {
        const previousHiddenCount = state.hiddenCount;
        const previousTotalHiddenCount = state.totalHiddenCount;
        const previousHardEvictedCount = state.hardEvictedCount;
        const previousSoftPrunedSections = state.softPrunedSections;

        let evictedCount = 0;
        let softPrunedCount = 0;
        let restoredCount = 0;

        removePlaceholder();
        removeTopRestoreSentinel();
        removeBottomPruneSentinel();

        evictedCount = hardEvictSections(sectionsToEvictNow);
        softPrunedCount = softPruneSections(sectionsToSoftPrune);

        const sectionsToRestore = sectionsToKeepVisible.filter((section) => {
            const turnRoot = getConversationTurnRoot(section);
            return !turnRoot?.isConnected;
        });

        restoredCount = restoreSoftPrunedSections(sectionsToRestore, container);

        state.softPrunedSections = [...sectionsToSoftPrune];
        state.hardEvictedCount += evictedCount;
        updateHiddenCounts();

        const countsChanged =
            state.hiddenCount !== previousHiddenCount ||
            state.totalHiddenCount !== previousTotalHiddenCount ||
            state.hardEvictedCount !== previousHardEvictedCount ||
            previousSoftPrunedSections.length !== state.softPrunedSections.length ||
            previousSoftPrunedSections.some(
                (section, index) => state.softPrunedSections[index] !== section
            );

        visibleSectionsChanged = evictedCount > 0 || softPrunedCount > 0 || restoredCount > 0;

        const nextVisibleSections = getConversationSections();
        const firstVisibleSection = nextVisibleSections[0] ?? null;
        const lastVisibleSection = nextVisibleSections[nextVisibleSections.length - 1] ?? null;

        placeholderChanged = showPlaceholder ? ensurePlaceholderState(firstVisibleSection) : false;
        ensureTopRestoreSentinelState(firstVisibleSection);
        ensureBottomPruneSentinelState(lastVisibleSection);

        const domChanged = visibleSectionsChanged || placeholderChanged;

        if (!domChanged && !countsChanged) {
            debugLog("Prune: skipped no-op cycle", {
                visibleSections: currentVisibleSections.length,
                protectedVisibleSections: protectedVisibleSections.length,
                latestVisibleSections: latestVisibleSections.length,
                softPrunedSections: state.softPrunedSections.length,
                totalHiddenCount: state.hiddenCount,
                hardEvictedCount: state.hardEvictedCount,
            });
            return;
        }

        if (visibleSectionsChanged) {
            refreshObservedSections();
        }

        debugLog("Prune: prune cycle completed", {
            visibleSections: currentVisibleSections.length,
            protectedVisibleSections: protectedVisibleSections.length,
            latestVisibleSections: latestVisibleSections.length,
            evictedSections: evictedCount,
            newlySoftPrunedSections: softPrunedCount,
            restoredSections: restoredCount,
            totalHiddenCount: state.hiddenCount,
            hardEvictedCount: state.hardEvictedCount,
            placeholderChanged,
            countsChanged,
            visibleSectionsChanged,
            showPlaceholder,
        });
    });

    return { visibleSectionsChanged, placeholderChanged };
}

export function runInitialPrune(
    container,
    {
        pruneOldSections,
        refreshObservedSections,
        installStartupPruneMask,
        removeStartupPruneMask,
    }
) {
    if (!state.featureFlags.pruning) return;
    if (!state.settings.autoPrune || state.didInitialPrune) {
        return;
    }

    installStartupPruneMask?.();
    hideContainer(container);

    requestAnimationFrame(() => {
        try {
            const result = pruneOldSections(state.settings.historyKeptExchanges, { showPlaceholder: false });

            state.didInitialPrune = true;

            const visibleSections = getConversationSections();
            const firstVisibleSection = visibleSections[0] ?? null;
            const lastVisibleSection = visibleSections[visibleSections.length - 1] ?? null;

            const placeholderChanged = ensurePlaceholderState(firstVisibleSection);
            ensureTopRestoreSentinelState(firstVisibleSection);
            ensureBottomPruneSentinelState(lastVisibleSection);

            debugLog("Prune: initial prune completed", {
                ...result,
                placeholderChanged,
            });

            if (!result?.visibleSectionsChanged) {
                refreshObservedSections();
            }
        } catch (error) {
            console.error("[Thread Optimizer] Initial prune failed", error);
        } finally {
            requestAnimationFrame(() => {
                revealContainer(container);

                requestAnimationFrame(() => {
                    const latestContainer = getConversationContainer();
                    if (!latestContainer) {
                        removeStartupPruneMask?.();
                        return;
                    }

                    const latestVisibleSections = getConversationSections();
                    const latestFirstVisibleSection = latestVisibleSections[0] ?? null;
                    const latestLastVisibleSection =
                        latestVisibleSections[latestVisibleSections.length - 1] ?? null;

                    ensurePlaceholderState(latestFirstVisibleSection);
                    ensureTopRestoreSentinelState(latestFirstVisibleSection);
                    ensureBottomPruneSentinelState(latestLastVisibleSection);
                    refreshObservedSections();
                    removeStartupPruneMask?.();

                    debugLog("Prune: post-initial stabilization refresh completed", {
                        hasContainer: Boolean(latestContainer),
                        hasFirstVisibleSection: Boolean(latestFirstVisibleSection),
                        hasLastVisibleSection: Boolean(latestLastVisibleSection),
                        softPrunedSections: state.softPrunedSections.length,
                    });
                });
            });
        }
    });
}