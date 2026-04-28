import { state } from "./state.js";

export function syncPruningStateToPageBridge(retries = 10) {
    if (typeof window === "undefined") return;

    const bridge = window.__threadOptimizerChatStoreBridge;

    if (bridge?.__installed) {
        window.postMessage(
            {
                source: "thread-optimizer",
                type: "thread-optimizer:set-pruning-state",
                enabled: state.featureFlags.pruning === true,
                prunedTurnCount: state.featureFlags.pruning
                    ? state.hiddenCount || 0
                    : 0,
            },
            window.location.origin
        );
        return;
    }

    if (retries > 0) {
        setTimeout(() => {
            syncPruningStateToPageBridge(retries - 1);
        }, 200);
    }
}

export function syncStoreReadOptimizationToPageWithRetry(retries = 10) {
    if (typeof window === "undefined") {
        return;
    }

    const bridge = window.__threadOptimizerChatStoreBridge;

    if (bridge?.__installed) {
        window.postMessage(
            {
                source: "thread-optimizer",
                type: "thread-optimizer:set-store-read-optimization",
                enabled: state.featureFlags.storeReadOptimization,
                debug: state.debugLoggingEnabled,
            },
            window.location.origin
        );
        return;
    }

    if (retries > 0) {
        setTimeout(() => {
            syncStoreReadOptimizationToPageWithRetry(retries - 1);
        }, 200);
    }
}