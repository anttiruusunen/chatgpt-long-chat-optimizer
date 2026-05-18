import { state } from "../core/state.js";
import { getConversationContainer } from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import {
    pruneOldSections as pruneOldSectionsBase,
    runInitialPrune as runInitialPruneBase,
} from "./prune.js";
import {
    scheduleConversationChromeSync,
    scheduleRefreshPostPruneState,
} from "../core/conversationMaintenance.js";
import { syncPruningStateToPageBridge } from "../core/pageBridgeSync.js";
import { onStoreHistoryPruneCompleted } from "../bridge/chatStoreBridgeClient.js";
import {
    showInitialPruneOverlay,
    hideInitialPruneOverlay,
} from "../ui/pruneOverlay.js";

const AUTO_PRUNE_DEBOUNCE_MS = 300;
const PENDING_AUTO_PRUNE_CHECK_MS = 5000;

function getSafeHistoryKeptExchanges(value) {
    return Math.max(1, Math.floor(Number(value) || 1));
}

function isPruneDeferred(result) {
    return Boolean(result?.pruneDeferred || result?.deferred);
}

export function createPruneController({
    ensureObserverAttached,
    waitForContainerAndInitialPrune,
    withDomMutationGuard,
}) {
    let isBootstrapInitialPruneScheduled = false;
    let pendingDeferredAutoPruneTimer = null;
    let pendingDeferredAutoPruneReason = null;
    let pendingDeferredAutoPruneLastResult = null;

    let activeInitialPruneRequestId = null;
    let activeInitialPruneFinishedCallback = null;
    let removeStorePruneCompletionListener = null;

    function clearInitialPruneOverlay(reason = "initial-prune-complete") {
        activeInitialPruneRequestId = null;
        activeInitialPruneFinishedCallback = null;
        hideInitialPruneOverlay({ reason });
    }

    function ensureStorePruneCompletionListener() {
        if (removeStorePruneCompletionListener) {
            return;
        }

        removeStorePruneCompletionListener = onStoreHistoryPruneCompleted(
            ({ requestId, result } = {}) => {
                const completedRequestId = requestId || result?.requestId;

                if (
                    !completedRequestId ||
                    completedRequestId !== activeInitialPruneRequestId
                ) {
                    return;
                }

                debugLog("Prune controller: initial store prune completed", {
                    requestId: completedRequestId,
                    result,
                });

                activeInitialPruneFinishedCallback?.({
                    reason: "store-prune-completed",
                    result: {
                        ...(result || {}),
                        requestId: completedRequestId,
                        posted: true,
                        deferred: false,
                        completed: true,
                    },
                });

                clearInitialPruneOverlay("store-prune-completed");
            }
        );
    }

    function trackInitialStorePruneOverlay(result) {
        if (result?.deferred) {
            clearInitialPruneOverlay("initial-prune-deferred");
            return result;
        }

        if (!result?.posted || !result?.requestId) {
            clearInitialPruneOverlay("initial-prune-not-posted");
            return result;
        }

        activeInitialPruneRequestId = result.requestId;
        ensureStorePruneCompletionListener();

        debugLog("Prune controller: initial store prune overlay waiting for bridge completion", {
            requestId: activeInitialPruneRequestId,
        });

        return result;
    }

    function clearPendingDeferredAutoPrune() {
        if (pendingDeferredAutoPruneTimer) {
            clearTimeout(pendingDeferredAutoPruneTimer);
            pendingDeferredAutoPruneTimer = null;
        }

        pendingDeferredAutoPruneReason = null;
        pendingDeferredAutoPruneLastResult = null;
    }

    function schedulePendingDeferredAutoPrune(reason, pruneResult = null) {
        if (!state.featureFlags.pruning) return;
        if (!state.settings.autoPrune) return;
        if (!state.didInitialPrune) return;

        pendingDeferredAutoPruneReason = reason;
        pendingDeferredAutoPruneLastResult = pruneResult;

        if (pendingDeferredAutoPruneTimer) {
            debugLog("Prune controller: deferred auto-prune already pending", {
                reason,
                deferredReason: pruneResult?.reason,
                delayMs: PENDING_AUTO_PRUNE_CHECK_MS,
            });
            return;
        }

        pendingDeferredAutoPruneTimer = setTimeout(() => {
            pendingDeferredAutoPruneTimer = null;

            if (!state.featureFlags.pruning) {
                clearPendingDeferredAutoPrune();
                return;
            }

            if (!state.settings.autoPrune) {
                clearPendingDeferredAutoPrune();
                return;
            }

            if (!state.didInitialPrune) {
                clearPendingDeferredAutoPrune();
                return;
            }

            if (state.isApplyingDomChanges) {
                schedulePendingDeferredAutoPrune(
                    pendingDeferredAutoPruneReason || reason,
                    pendingDeferredAutoPruneLastResult
                );
                return;
            }

            debugLog("Prune controller: checking pending deferred auto-prune", {
                reason: pendingDeferredAutoPruneReason || reason,
                deferredReason: pendingDeferredAutoPruneLastResult?.reason,
            });

            scheduleAutoPrune(
                `${pendingDeferredAutoPruneReason || reason}:pending-deferred-check`
            );
        }, PENDING_AUTO_PRUNE_CHECK_MS);

        debugLog("Prune controller: scheduled pending deferred auto-prune check", {
            reason,
            deferredReason: pruneResult?.reason,
            delayMs: PENDING_AUTO_PRUNE_CHECK_MS,
        });
    }

    function syncAfterPrune(reason) {
        scheduleConversationChromeSync({
            reason,
            includeStreaming: true,
        });

        syncPruningStateToPageBridge();
    }

    function pruneOldSections(
        historyKeptExchanges = state.settings.historyKeptExchanges,
        options = {}
    ) {
        const runPrune = () =>
            pruneOldSectionsBase(
                getSafeHistoryKeptExchanges(historyKeptExchanges),
                options,
                {
                    ensureObserverAttached,
                    refreshObservedSections: scheduleRefreshPostPruneState,
                }
            );

        const result =
            typeof withDomMutationGuard === "function"
                ? withDomMutationGuard(runPrune)
                : runPrune();

        syncAfterPrune("prune-old-sections");

        return result;
    }

    function runInitialPrune(container, options = {}) {
        const { postPruneRefreshDelayMs = 0 } = options;

        const externalOnPruneResult =
            typeof options.onPruneResult === "function"
                ? options.onPruneResult
                : null;

        const externalOnPruneFinished =
            typeof options.onPruneFinished === "function"
                ? options.onPruneFinished
                : null;

        let latestInitialPruneResult = null;

        runInitialPruneBase(container, {
            pruneOldSections,
            refreshObservedSections: () =>
                scheduleRefreshPostPruneState({
                    delayMs: postPruneRefreshDelayMs,
                    reason:
                        postPruneRefreshDelayMs > 0
                            ? "navigation-initial-prune-refresh"
                            : "initial-prune-refresh",
                }),
            onPruneStarted: () => {
                showInitialPruneOverlay({
                    reason: options.reason || "initial-prune",
                });
            },
            onPruneResult: (result) => {
                latestInitialPruneResult = result;
                trackInitialStorePruneOverlay(result);

                externalOnPruneResult?.(result);

                if (result?.posted && result?.requestId && !result?.deferred) {
                    activeInitialPruneFinishedCallback = externalOnPruneFinished;
                }
            },
            onPruneFinished: ({ reason, result } = {}) => {
                const finalResult = result || latestInitialPruneResult;

                if (
                    finalResult?.posted &&
                    finalResult?.requestId &&
                    !finalResult?.deferred
                ) {
                    return;
                }

                externalOnPruneFinished?.({
                    reason: reason || "initial-prune-finished",
                    result: finalResult,
                });

                clearInitialPruneOverlay(reason || "initial-prune-finished");
            },
        });

        return latestInitialPruneResult;
    }

    function bootstrapInitialPruneFromObservedMutation() {
        if (isBootstrapInitialPruneScheduled) {
            return;
        }

        if (
            !state.featureFlags.pruning ||
            !state.settings.autoPrune ||
            state.didInitialPrune
        ) {
            return;
        }

        isBootstrapInitialPruneScheduled = true;

        requestAnimationFrame(() => {
            isBootstrapInitialPruneScheduled = false;

            if (
                !state.featureFlags.pruning ||
                !state.settings.autoPrune ||
                state.didInitialPrune
            ) {
                return;
            }

            const container = getConversationContainer();

            if (!container) {
                waitForContainerAndInitialPrune();
                return;
            }

            debugLog(
                "Prune controller: bootstrapping initial prune from observed mutation"
            );

            waitForContainerAndInitialPrune({
                requireConversationTurns: true,
            });
        });
    }

    function clearPendingAutoPrune() {
        if (state.debounceTimer) {
            clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
        }

        clearPendingDeferredAutoPrune();

        state.isAutoPruneScheduled = false;
    }

    function scheduleAutoPrune(reason = "auto-prune") {
        if (!state.featureFlags.pruning) return;
        if (!state.settings.autoPrune) return;
        if (!state.didInitialPrune) return;
        if (state.isApplyingDomChanges) return;

        if (state.isAutoPruneScheduled) {
            debugLog("Prune controller: skipped duplicate auto-prune schedule", {
                reason,
            });
            return;
        }

        state.isAutoPruneScheduled = true;

        scheduleConversationChromeSync({
            reason: "schedule-auto-prune",
        });

        state.debounceTimer = setTimeout(() => {
            try {
                if (!state.featureFlags.pruning || !state.settings.autoPrune) {
                    debugLog(
                        "Prune controller: skipped auto-prune because feature is disabled",
                        { reason }
                    );
                    clearPendingDeferredAutoPrune();
                    return;
                }

                if (state.isApplyingDomChanges) {
                    debugLog(
                        "Prune controller: skipped auto-prune because DOM guard is active",
                        { reason }
                    );
                    schedulePendingDeferredAutoPrune(reason);
                    return;
                }

                const pruneResult = pruneOldSections(
                    state.settings.historyKeptExchanges
                );

                debugLog("Prune controller: auto-prune result", {
                    reason,
                    pruneDeferred: Boolean(pruneResult?.pruneDeferred),
                    deferred: Boolean(pruneResult?.deferred),
                    resultReason: pruneResult?.reason,
                    posted: Boolean(pruneResult?.posted),
                });

                if (isPruneDeferred(pruneResult)) {
                    schedulePendingDeferredAutoPrune(reason, pruneResult);
                    return;
                }

                clearPendingDeferredAutoPrune();
            } finally {
                state.isAutoPruneScheduled = false;
                state.debounceTimer = null;

                scheduleConversationChromeSync({
                    reason: "auto-prune-finally",
                });
            }
        }, AUTO_PRUNE_DEBOUNCE_MS);

        debugLog("Prune controller: scheduled auto-prune", {
            reason,
            historyKeptExchanges: state.settings.historyKeptExchanges,
        });
    }

    return {
        pruneOldSections,
        runInitialPrune,
        bootstrapInitialPruneFromObservedMutation,
        clearPendingAutoPrune,
        scheduleAutoPrune,
    };
}