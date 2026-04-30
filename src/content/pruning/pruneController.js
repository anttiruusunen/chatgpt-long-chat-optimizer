import { state } from "../core/state.js";
import { getConversationContainer } from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import {
    pruneOldSections as pruneOldSectionsBase,
    restoreAllSections as restoreAllSectionsBase,
    runInitialPrune as runInitialPruneBase,
    enforceSoftPrunedLimit,
} from "./prune.js";
import {
    installStartupPruneMask,
    removeStartupPruneMask,
} from "./pruneUi.js";
import { clearCssVisibilityWindow } from "./cssVisibilityWindow.js";
import {
    scheduleConversationChromeSync,
    scheduleRefreshPostPruneState,
} from "../core/conversationMaintenance.js";
import { syncPruningStateToPageBridge } from "../core/pageBridgeSync.js";

export function createPruneController({
    ensureObserverAttached,
    waitForContainerAndInitialPrune,
    withDomMutationGuard,
}) {
    let isBootstrapInitialPruneScheduled = false;

    function getStartupMaskVisibleSectionsLimit() {
        const safeExchanges = Math.max(1, Number(state.settings.historyKeptExchanges) || 1);
        return safeExchanges * 2;
    }

    function applySoftPrunedLimitToCurrentState() {
        withDomMutationGuard(() => {
            enforceSoftPrunedLimit();

            debugLog("Prune controller: applied soft-pruned limit counts", {
                totalHiddenCount: state.hiddenCount,
                softPrunedSections: state.softPrunedSections.length,
                hardEvictedCount: state.hardEvictedCount,
                historyKeptExchanges: state.settings.historyKeptExchanges,
            });
        });

        scheduleConversationChromeSync({
            reason: "apply-soft-pruned-limit",
            includeStreaming: true,
        });
    }

    function restoreAllSections() {
        clearCssVisibilityWindow();

        const result = restoreAllSectionsBase({
            ensureObserverAttached,
            withDomMutationGuard,
            refreshObservedSections: scheduleRefreshPostPruneState,
        });

        scheduleConversationChromeSync({
            reason: "restore-all-sections",
            includeStreaming: true,
        });

        syncPruningStateToPageBridge();

        return result;
    }

    function pruneOldSections(historyKeptExchanges = state.settings.historyKeptExchanges, options = {}) {
        clearCssVisibilityWindow();

        const result = pruneOldSectionsBase(historyKeptExchanges, options, {
            ensureObserverAttached,
            withDomMutationGuard,
            refreshObservedSections: scheduleRefreshPostPruneState,
        });

        scheduleConversationChromeSync({
            reason: "prune-old-sections",
            includeStreaming: true,
        });

        syncPruningStateToPageBridge();

        return result;
    }

    function runInitialPrune(container, options = {}) {
        const {
            useStartupMask = true,
            postPruneRefreshDelayMs = 0,
        } = options;

        return runInitialPruneBase(
            container,
            {
                pruneOldSections,
                refreshObservedSections: () =>
                    scheduleRefreshPostPruneState({
                        delayMs: postPruneRefreshDelayMs,
                        reason: useStartupMask
                            ? "initial-prune-refresh"
                            : "navigation-initial-prune-refresh",
                    }),
                installStartupPruneMask: useStartupMask
                    ? () => {
                        installStartupPruneMask(container, getStartupMaskVisibleSectionsLimit());
                    }
                    : null,
                removeStartupPruneMask: useStartupMask
                    ? removeStartupPruneMask
                    : null,
            },
            {
                useStartupMask,
                postPruneRefreshDelayMs,
            }
        );
    }

    function bootstrapInitialPruneFromObservedMutation() {
        if (isBootstrapInitialPruneScheduled) {
            return;
        }

        if (!state.featureFlags.pruning || !state.settings.autoPrune || state.didInitialPrune) {
            return;
        }

        isBootstrapInitialPruneScheduled = true;

        requestAnimationFrame(() => {
            isBootstrapInitialPruneScheduled = false;

            if (!state.featureFlags.pruning || !state.settings.autoPrune || state.didInitialPrune) {
                return;
            }

            const container = getConversationContainer();
            if (!container) {
                waitForContainerAndInitialPrune();
                return;
            }

            debugLog("Prune controller: bootstrapping initial prune from observed mutation");
            runInitialPrune(container);
        });
    }

    function clearPendingAutoPrune() {
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
        }

        clearCssVisibilityWindow();
        state.isAutoPruneScheduled = false;
    }

    function scheduleAutoPrune() {
        if (!state.featureFlags.pruning) return;
        if (!state.settings.autoPrune) return;
        if (!state.didInitialPrune) return;
        if (state.isApplyingDomChanges) return;

        if (state.isAutoPruneScheduled) {
            debugLog("Prune controller: skipped duplicate auto-prune schedule");
            return;
        }

        state.isAutoPruneScheduled = true;
        scheduleConversationChromeSync({
            reason: "schedule-auto-prune",
        });

        state.debounceTimer = setTimeout(() => {
            try {
                if (!state.featureFlags.pruning || !state.settings.autoPrune) {
                    debugLog("Prune controller: skipped auto-prune because feature is disabled");
                    return;
                }

                if (state.isApplyingDomChanges) {
                    debugLog("Prune controller: skipped auto-prune because DOM guard is active");
                    return;
                }

                pruneOldSections(state.settings.historyKeptExchanges, { showPlaceholder: true });
            } finally {
                state.isAutoPruneScheduled = false;
                state.debounceTimer = null;
                scheduleConversationChromeSync({
                    reason: "auto-prune-finally",
                });
            }
        }, 300);

        debugLog("Prune controller: scheduled auto-prune", {
            historyKeptExchanges: state.settings.historyKeptExchanges,
        });
    }

    return {
        applySoftPrunedLimitToCurrentState,
        restoreAllSections,
        pruneOldSections,
        runInitialPrune,
        bootstrapInitialPruneFromObservedMutation,
        clearPendingAutoPrune,
        scheduleAutoPrune,
    };
}