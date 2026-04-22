import { state } from "./state.js";
import { debugLog } from "../core/logger.js";
import { ext } from "../../shared/ext.js";

function getHiddenExchangesCount() {
    return Math.floor((Number(state.hiddenCount) || 0) / 2);
}

export function registerRuntimeMessageHandlers({
    pruneOldSections,
    restoreAllSections,
    scheduleAutoPrune,
    waitForContainerAndInitialPrune,
    refreshObservedSections,
    applySoftPrunedLimitToCurrentState,
    setOffscreenOptimizationEnabled,
    setStreamingSectionHidingEnabled,
    syncFeatureFlagsFromSettings,
}) {
    ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            if (message.action === "prune-now") {
                const historyKeptExchanges = Math.max(
                    1,
                    Number(message.historyKeptExchanges) || state.settings.historyKeptExchanges
                );

                state.settings.historyKeptExchanges = historyKeptExchanges;
                pruneOldSections(historyKeptExchanges, { showPlaceholder: true });
                state.didInitialPrune = true;

                debugLog("Messages: handled prune-now", {
                    historyKeptExchanges,
                });

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "restore-all") {
                restoreAllSections();
                debugLog("Messages: handled restore-all");
                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "settings-updated") {
                const previousOffscreenEnabled = state.featureFlags.offscreenOptimization;
                const previousStreamingSectionHidingEnabled = state.featureFlags.streamingSectionHiding;

                state.settings.historyKeptExchanges = Math.max(
                    1,
                    Number(message.historyKeptExchanges) || state.settings.historyKeptExchanges
                );
                state.settings.autoPrune = Boolean(message.autoPrune);

                state.settings.enablePruning = Boolean(message.enablePruning);
                state.settings.enableOffscreenOptimization = Boolean(message.enableOffscreenOptimization);
                state.settings.enableLargeCodeBlockOptimization = Boolean(message.enableLargeCodeBlockOptimization);
                state.settings.enableStreamingSectionHiding = Boolean(message.enableStreamingSectionHiding);
                state.settings.enableDebugLogging = Boolean(message.enableDebugLogging);

                state.debugLoggingEnabled = state.settings.enableDebugLogging;

                syncFeatureFlagsFromSettings();
                applySoftPrunedLimitToCurrentState();

                if (previousOffscreenEnabled !== state.featureFlags.offscreenOptimization) {
                    setOffscreenOptimizationEnabled(state.featureFlags.offscreenOptimization);
                } else if (state.featureFlags.offscreenOptimization) {
                    refreshObservedSections();
                }

                if (previousStreamingSectionHidingEnabled !== state.featureFlags.streamingSectionHiding) {
                    setStreamingSectionHidingEnabled(state.featureFlags.streamingSectionHiding);
                }

                if (state.settings.autoPrune && state.featureFlags.pruning) {
                    if (!state.didInitialPrune) {
                        waitForContainerAndInitialPrune();
                    } else {
                        scheduleAutoPrune();
                    }
                } else {
                    refreshObservedSections();
                }

                debugLog("Messages: handled settings-updated", {
                    historyKeptExchanges: state.settings.historyKeptExchanges,
                    autoPrune: state.settings.autoPrune,
                    featureFlags: { ...state.featureFlags },
                    debugLoggingEnabled: state.debugLoggingEnabled,
                });

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "get-popup-state") {
                sendResponse({
                    ok: true,
                    hiddenExchanges: getHiddenExchangesCount(),
                    hiddenSections: state.hiddenCount,
                    lastReplyDurationMs: state.replyTiming.lastDurationMs || 0,
                    replyPending: Boolean(state.replyTiming.pending),
                    debugLoggingEnabled: Boolean(state.debugLoggingEnabled),
                });
                return true;
            }

            if (message.action === "debug-log-state") {
                const payload = globalThis.__THREAD_OPTIMIZER_DEBUG__?.getState?.() ?? null;
                console.log("[Thread Optimizer Debug] State", payload);
                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-buckets") {
                const payload = globalThis.__THREAD_OPTIMIZER_DEBUG__?.getBuckets?.() ?? null;
                console.log("[Thread Optimizer Debug] Buckets", payload);
                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-logical") {
                const payload = globalThis.__THREAD_OPTIMIZER_DEBUG__?.getLogicalSections?.() ?? null;
                console.log("[Thread Optimizer Debug] Logical sections", payload);
                sendResponse({ ok: true });
                return true;
            }

            sendResponse({ ok: false, error: "Unknown action" });
            return true;
        } catch (error) {
            console.error("[Thread Optimizer]", error);
            sendResponse({ ok: false, error: String(error) });
            return true;
        }
    });
}