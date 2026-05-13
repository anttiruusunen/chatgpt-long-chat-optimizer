import { debugLog } from "../core/logger";
import { getChatStorePageBridgeToken } from "./bridgeBootstrap.js";

const RECORD_SOURCE = "thread-optimizer";
const STORE_PRUNE_REQUEST_TYPE = "thread-optimizer:prune-store-history";
const VISIBLE_MESSAGES_READY_TYPE = "thread-optimizer:visible-messages-ready";

/**
 * Send a message to the page-context bridge.
 *
 * Uses a per-page token to avoid collisions with other scripts.
 */
export function postThreadOptimizerBridgeMessage(message) {
    const token = getChatStorePageBridgeToken();

    if (!token) {
        debugLog("[Long Chat Optimizer] page bridge token unavailable");
        return false;
    }

    if (!message || typeof message !== "object") {
        return false;
    }

    // file:// fixtures have origin "null", which breaks strict targetOrigin
    const targetOrigin =
        window.location.origin && window.location.origin !== "null"
            ? window.location.origin
            : "*";

    window.postMessage(
        {
            ...message,
            source: RECORD_SOURCE,
            token,
        },
        targetOrigin
    );

    return true;
}

export function requestStoreHistoryPrune({
    historyKeptExchanges = 1,
    reason = "content-prune",
} = {}) {
    const keepCount = Math.max(1, Math.floor(Number(historyKeptExchanges) || 1));

    const posted = postThreadOptimizerBridgeMessage({
        type: STORE_PRUNE_REQUEST_TYPE,
        historyKeptExchanges: keepCount,
        reason,
    });

    return {
        posted,
        historyKeptExchanges: keepCount,
        reason: posted ? null : "failed to post bridge message",
    };
}

export function notifyVisibleMessagesReadyForStoreBridge() {
    return postThreadOptimizerBridgeMessage({
        type: VISIBLE_MESSAGES_READY_TYPE,
    });
}
