import { debugLog } from "../core/logger";
import { getChatStorePageBridgeToken } from "./bridgeBootstrap.js";

const RECORD_SOURCE = "thread-optimizer";
const STORE_PRUNE_REQUEST_TYPE = "thread-optimizer:prune-store-history";
const STORE_PRUNE_COMPLETED_TYPE = "thread-optimizer:store-prune-completed";
const VISIBLE_MESSAGES_READY_TYPE = "thread-optimizer:visible-messages-ready";

let nextStorePruneRequestId = 1;
const storePruneCompletionListeners = new Set();

function createStorePruneRequestId() {
    const id = nextStorePruneRequestId;
    nextStorePruneRequestId += 1;

    return `store-prune-${Date.now()}-${id}`;
}

function getTrustedBridgeEventData(event) {
    if (event.source !== window) {
        return null;
    }

    const data = event.data;

    if (!data || typeof data !== "object") {
        return null;
    }

    if (data.source !== RECORD_SOURCE) {
        return null;
    }

    if (data.token !== getChatStorePageBridgeToken()) {
        return null;
    }

    return data;
}

function handleStorePruneCompletionMessage(event) {
    const data = getTrustedBridgeEventData(event);

    if (!data || data.type !== STORE_PRUNE_COMPLETED_TYPE) {
        return;
    }

    for (const listener of storePruneCompletionListeners) {
        try {
            listener(data);
        } catch (error) {
            debugLog("[Long Chat Optimizer] store prune completion listener failed", {
                error: String(error?.message || error),
            });
        }
    }
}

window.addEventListener("message", handleStorePruneCompletionMessage);

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
    requestId = createStorePruneRequestId(),
} = {}) {
    const keepCount = Math.max(1, Math.floor(Number(historyKeptExchanges) || 1));

    const posted = postThreadOptimizerBridgeMessage({
        type: STORE_PRUNE_REQUEST_TYPE,
        requestId,
        historyKeptExchanges: keepCount,
        reason,
    });

    return {
        posted,
        requestId,
        historyKeptExchanges: keepCount,
        reason: posted ? null : "failed to post bridge message",
    };
}

export function onStoreHistoryPruneCompleted(listener) {
    if (typeof listener !== "function") {
        return () => {};
    }

    storePruneCompletionListeners.add(listener);

    return () => {
        storePruneCompletionListeners.delete(listener);
    };
}

export function notifyVisibleMessagesReadyForStoreBridge() {
    return postThreadOptimizerBridgeMessage({
        type: VISIBLE_MESSAGES_READY_TYPE,
    });
}