import { state } from "./state.js";
import { debugLog, debugError } from "../core/logger.js";
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

function postToPageBridge(type, payload = {}) {
    return postThreadOptimizerBridgeMessage({
        type,
        ...payload,
    });
}

function getSafeHistoryKeptExchanges(value, fallback) {
    return Math.max(
        1,
        Math.floor(Number(value) || Number(fallback) || 1)
    );
}

function applySettingsFromMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "historyKeptExchanges")) {
        state.settings.historyKeptExchanges = getSafeHistoryKeptExchanges(
            message.historyKeptExchanges,
            state.settings.historyKeptExchanges
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
}

function syncPageBridgeRuntimeState() {
    postToPageBridge("thread-optimizer:set-pruning-state", {
        enabled: state.featureFlags.pruning === true,
        historyKeptExchanges: getSafeHistoryKeptExchanges(
            state.settings.historyKeptExchanges,
            1
        ),
    });

    postToPageBridge("thread-optimizer:set-initial-load-hiding", {
        enabled: state.featureFlags.pruning === true,
        historyKeptExchanges: getSafeHistoryKeptExchanges(
            state.settings.historyKeptExchanges,
            1
        ),
        debug: state.debugLoggingEnabled === true,
    });

    postToPageBridge("thread-optimizer:set-store-read-optimization", {
        enabled: state.featureFlags.storeReadOptimization,
        debug: state.debugLoggingEnabled,
    });
}

/**
 * Runtime messages are the popup/debug control plane.
 *
 * Most feature toggles also flow through storage.onChanged in index.js, but
 * popup-driven updates use this path so the active tab can react immediately.
 */
export function registerRuntimeMessageHandlers({
    pruneOldSections,
    scheduleAutoPrune,
    waitForContainerAndInitialPrune,
    refreshObservedSections,
    setOffscreenOptimizationEnabled,
    syncFeatureFlagsFromSettings,
}) {
    ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
        try {
            if (message.action === "prune-now") {
                const historyKeptExchanges = getSafeHistoryKeptExchanges(
                    message.historyKeptExchanges,
                    state.settings.historyKeptExchanges
                );

                state.settings.historyKeptExchanges = historyKeptExchanges;

                pruneOldSections(historyKeptExchanges);

                state.didInitialPrune = true;

                debugLog("Messages: handled prune-now", {
                    historyKeptExchanges,
                });

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "settings-updated") {
                const previousPruningEnabled =
                    state.featureFlags.pruning;

                const previousOffscreenEnabled =
                    state.featureFlags.offscreenOptimization;

                applySettingsFromMessage(message);

                syncCodeBlockScrollbarStyles();
                syncUserMessageClampStyles();

                state.debugLoggingEnabled = state.settings.enableDebugLogging;

                // Keep featureFlags as the canonical runtime view of settings.
                syncFeatureFlagsFromSettings();

                const pruningJustEnabled =
                    !previousPruningEnabled &&
                    state.featureFlags.pruning;

                syncPageBridgeRuntimeState();

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
                    if (
                        !state.didInitialPrune ||
                        pruningJustEnabled
                    ) {
                        // Runtime enable can happen after the DOM is already mounted,
                        // so prune directly instead of waiting for startup observers.
                        pruneOldSections(state.settings.historyKeptExchanges);

                        state.didInitialPrune = true;
                        refreshObservedSections();
                    } else {
                        scheduleAutoPrune("settings-updated");
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

            if (message.action === "debug-log-state") {
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getState?.() ?? null;

                console.log("[Long Chat Optimizer Debug] State", payload);

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-buckets") {
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getBuckets?.() ?? null;

                console.log("[Long Chat Optimizer Debug] Buckets", payload);

                sendResponse({ ok: true });
                return true;
            }

            if (message.action === "debug-log-logical") {
                const payload =
                    globalThis.__THREAD_OPTIMIZER_DEBUG__?.getLogicalSections?.() ??
                    null;

                console.log("[Long Chat Optimizer Debug] Logical sections", payload);

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
            debugError("Messages: handler failed", error, {
                action: message?.action,
            });

            sendResponse({ ok: false, error: String(error) });
            return true;
        }
    });
}