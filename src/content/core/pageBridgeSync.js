import { state } from "./state.js";
import { postThreadOptimizerBridgeMessage } from "../bridge/chatStoreBridgeClient.js";

const BRIDGE_SYNC_RETRY_DELAY_MS = 200;
const STORE_READ_OPTIMIZATION_MAX_SYNC_MS = 5000;

function getHistoryKeptExchangesForBridge() {
    return Math.max(
        1,
        Math.floor(Number(state.settings?.historyKeptExchanges) || 1)
    );
}

/**
 * Sends current pruning state to the page bridge once it is installed.
 *
 * The page bridge loads asynchronously because it must run in page context,
 * so startup sync uses a short retry loop.
 */
export function syncPruningStateToPageBridge(retries = 10) {
    if (typeof window === "undefined") {
        return;
    }

    const bridge = window.__threadOptimizerChatStoreBridge;

    if (bridge?.__installed) {
        postThreadOptimizerBridgeMessage({
            type: "thread-optimizer:set-pruning-state",
            enabled: state.featureFlags.pruning === true,
            historyKeptExchanges: getHistoryKeptExchangesForBridge(),
        });

        return;
    }

    if (retries > 0) {
        setTimeout(() => {
            syncPruningStateToPageBridge(retries - 1);
        }, BRIDGE_SYNC_RETRY_DELAY_MS);
    }
}

/**
 * Sends store-read optimization settings to the page bridge.
 *
 * This uses a time cap rather than retry count alone so a missing/failed page
 * bridge cannot retry indefinitely.
 */
export function syncStoreReadOptimizationToPageWithRetry(
    retries = 10,
    totalTimeMs = 0,
    hasPostedWithoutBridge = false
) {
    if (typeof window === "undefined") {
        return;
    }

    const bridge = window.__threadOptimizerChatStoreBridge;

    if (bridge?.__installed || !hasPostedWithoutBridge) {
        postThreadOptimizerBridgeMessage({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: state.featureFlags.storeReadOptimization,
            debug: state.debugLoggingEnabled,
        });

        if (bridge?.__installed) {
            return;
        }

        hasPostedWithoutBridge = true;
    }

    if (retries > 0 && totalTimeMs < STORE_READ_OPTIMIZATION_MAX_SYNC_MS) {
        setTimeout(() => {
            syncStoreReadOptimizationToPageWithRetry(
                retries - 1,
                totalTimeMs + BRIDGE_SYNC_RETRY_DELAY_MS,
                hasPostedWithoutBridge
            );
        }, BRIDGE_SYNC_RETRY_DELAY_MS);
    }
}