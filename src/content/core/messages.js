import { state } from "./state.js";
import { debugLog } from "../core/logger.js";
import { ext } from "../../shared/ext.js";
import {
    syncCodeBlockScrollbarStyles,
    syncUserMessageClampStyles,
} from "../ui/qolStyles.js";
import { postThreadOptimizerBridgeMessage } from "../bridge/chatStoreBridgeClient.js";

function getBooleanMessageSetting(message, key, fallback) {
    return Object.prototype.hasOwnProperty.call(message, key)
        ? Boolean(message[key])
        : fallback;
}

function getHiddenExchangesCount() {
    return Math.floor((Number(state.hiddenCount) || 0) / 2);
}

function postToPageBridge(type, payload = {}) {
    return postThreadOptimizerBridgeMessage({
        type,
        ...payload,
    });
}

function applySettingsFromMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "historyKeptExchanges")) {
        state.settings.historyKeptExchanges = Math.max(
            1,
            Number(message.historyKeptExchanges) || state.settings.historyKeptExchanges
        );
    }

    state.settings.autoPrune = getBooleanMessageSetting(
        message,
        "autoPrune",
        state.settings.autoPrune
    );

    state.settings.enablePruning = getBooleanMessageSetting(
        message,
        "enablePruning",
        state.settings.enablePruning
    );

    state.settings.enableOffscreenOptimization = getBooleanMessageSetting(
        message,
        "enableOffscreenOptimization",
        state.settings.enableOffscreenOptimization
    );

    state.settings.enableLargeCodeBlockOptimization = getBooleanMessageSetting(
        message,
        "enableLargeCodeBlockOptimization",
        state.settings.enableLargeCodeBlockOptimization
    );

    state.settings.enableDebugLogging = getBooleanMessageSetting(
        message,
        "enableDebugLogging",
        state.settings.enableDebugLogging
    );

    state.settings.enableStoreReadOptimization = getBooleanMessageSetting(
        message,
        "enableStoreReadOptimization",
        state.settings.enableStoreReadOptimization
    );

    state.settings.enableCodeBlockScrollbars = getBooleanMessageSetting(
        message,
        "enableCodeBlockScrollbars",
        state.settings.enableCodeBlockScrollbars
    );

    state.settings.enableUserMessageClamp = getBooleanMessageSetting(
        message,
        "enableUserMessageClamp",
        state.settings.enableUserMessageClamp
    );

    state.settings.enableCodeBlockCollapse = getBooleanMessageSetting(
        message,
        "enableCodeBlockCollapse",
        state.settings.enableCodeBlockCollapse
    );
}

/**
 * Runtime messages are the popup/debug control plane.
 *
 * Most feature toggles also flow through storage.onChanged in index.js, but
 * popup-driven updates use this path so the active tab can react immediately.
 */
export function registerRuntimeMessageHandlers({
    pruneOldSections,
    restoreAllSections,
    scheduleAutoPrune,
    waitForContainerAndInitialPrune,
    refreshObservedSections,
    applySoftPrunedLimitToCurrentState,
    setOffscreenOptimizationEnabled,
    syncFeatureFlagsFromSettings,
}) {
    ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            if (message.action === "prune-now") {
                const historyKeptExchanges = Math.max(
                    1,
                    Number(message.historyKeptExchanges) ||
                        state.settings.historyKeptExchanges
                );

                state.settings.historyKeptExchanges = historyKeptExchanges;

                pruneOldSections(historyKeptExchanges, {
                    showPlaceholder: true,
                });

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
                const previousOffscreenEnabled =
                    state.featureFlags.offscreenOptimization;

                applySettingsFromMessage(message);

                syncCodeBlockScrollbarStyles();
                syncUserMessageClampStyles();

                state.debugLoggingEnabled = state.settings.enableDebugLogging;

                // Keep featureFlags as the canonical runtime view of settings.
                syncFeatureFlagsFromSettings();

                postToPageBridge("thread-optimizer:set-store-read-optimization", {
                    enabled: state.featureFlags.storeReadOptimization,
                    debug: state.debugLoggingEnabled,
                });

                applySoftPrunedLimitToCurrentState();

                if (
                    previousOffscreenEnabled !==
                    state.featureFlags.offscreenOptimization
                ) {
                    setOffscreenOptimizationEnabled(
                        state.featureFlags.offscreenOptimization
                    );
                } else if (state.featureFlags.offscreenOptimization) {
                    refreshObservedSections();
                }

                if (state.settings.autoPrune && state.featureFlags.pruning) {
                    if (!state.didInitialPrune) {
                        // Runtime enable can happen after the DOM is already mounted,
                        // so prune directly instead of waiting for startup observers.
                        pruneOldSections(
                            state.settings.historyKeptExchanges,
                            { showPlaceholder: true }
                        );

                        state.didInitialPrune = true;
                        refreshObservedSections();
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
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getState?.() ?? null;

                console.log("[Thread Optimizer Debug] State", payload);

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-buckets") {
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getBuckets?.() ?? null;

                console.log("[Thread Optimizer Debug] Buckets", payload);

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-logical") {
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getLogicalSections?.() ??
                    null;

                console.log("[Thread Optimizer Debug] Logical sections", payload);

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "log-debug-store-performance") {
                postToPageBridge("thread-optimizer:log-store-performance");

                debugLog("Messages: requested store performance debug log");

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