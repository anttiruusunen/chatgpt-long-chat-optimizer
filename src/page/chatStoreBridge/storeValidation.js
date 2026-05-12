import {
    getNodeDirect,
    getStoreCurrentLeafId,
    getStoreNodeCount,
    isObjectLike,
    safeCall,
} from "./common.js";
import {
    getExpectedMinimumStoreNodeCount,
    getNewestVisibleMessageIdFromDom,
} from "./domState.js";

export const rejectedStores = new WeakSet();
export const rejectedStoreReasons = new Map();

export function getStoreInfo(store) {
    if (!store) {
        return {
            found: false,
            nodeCount: null,
            rootId: null,
            currentLeafId: null,
        };
    }

    let rootId = null;
    let currentLeafId = null;

    try {
        rootId = safeCall(store.rootId);
    } catch {}

    try {
        currentLeafId = safeCall(store.currentLeafId);
    } catch {}

    return {
        found: true,
        nodeCount: getStoreNodeCount(store),
        rootId,
        currentLeafId,
    };
}

export function hasAnyStoreMethodName(value) {
    return (
        value &&
        typeof value === "object" &&
        (
            "getNodeIfExists" in value ||
            "messageIdToExistingNodeId" in value ||
            "deleteNode" in value
        )
    );
}

export function looksLikeStore(value) {
    if (!isObjectLike(value)) return false;
    if (typeof value === "function") return false;
    if (rejectedStores.has(value)) return false;

    try {
        return (
            typeof value.deleteNode === "function" &&
            typeof value.getNodeIfExists === "function" &&
            typeof value.messageIdToExistingNodeId === "function"
        );
    } catch {
        return false;
    }
}

export function rejectStore(store, reason) {
    const reasonText = String(reason || "unknown");

    const isTemporaryHydrationReject =
        reasonText.includes("node count too small");

    if (isObjectLike(store) && !isTemporaryHydrationReject) {
        rejectedStores.add(store);
    }

    const reasonKey = reasonText;
    const previousCount = rejectedStoreReasons.get(reasonKey) || 0;
    rejectedStoreReasons.set(reasonKey, previousCount + 1);

    if (previousCount > 0) return;

    console.debug("[thread-optimizer bridge] rejected store candidate", {
        reason,
        info: getStoreInfo(store),
    });
}

export function candidateStoreCanResolveVisibleNewestNode(store) {
    const newestMessageId = getNewestVisibleMessageIdFromDom();

    if (!newestMessageId) {
        return {
            ok: false,
            reason: "no visible message id found",
            newestMessageId: null,
            nodeId: null,
        };
    }

    try {
        const nodeId = store.messageIdToExistingNodeId?.call(
            store,
            newestMessageId
        );

        if (!nodeId) {
            return {
                ok: false,
                reason: "message id did not resolve",
                newestMessageId,
                nodeId: null,
            };
        }

        const nodeCache = window.__threadOptimizerChatStoreBridge?.__nodeObjectCacheApi;

        const node = nodeCache
            ? nodeCache.resolve(nodeId)
            : getNodeDirect(store, nodeId);

        if (!node) {
            return {
                ok: false,
                reason: "resolved node id not found in store",
                newestMessageId,
                nodeId,
            };
        }

        return {
            ok: true,
            newestMessageId,
            nodeId,
            node,
        };
    } catch (error) {
        return {
            ok: false,
            reason: String(error?.message || error),
            newestMessageId,
            nodeId: null,
        };
    }
}

export function scoreStoreCandidate(store) {
    const nodeCount = getStoreNodeCount(store);
    const currentLeafId = getStoreCurrentLeafId(store);
    const hasCurrentLeafNode = Boolean(
        currentLeafId && getNodeDirect(store, currentLeafId)
    );

    const visibleNewest = candidateStoreCanResolveVisibleNewestNode(store);

    let score = 0;

    if (visibleNewest.ok) score += 1000000;
    if (hasCurrentLeafNode) score += 100000;
    score += Math.min(nodeCount, 50000);

    return {
        score,
        nodeCount,
        currentLeafId,
        hasCurrentLeafNode,
        visibleNewest,
    };
}

export function validateStoreCandidate(store) {
    if (!looksLikeStore(store)) {
        return {
            ok: false,
            reason: "does not expose required methods",
        };
    }

    try {
        const info = getStoreInfo(store);
        const nodeCount = getStoreNodeCount(store);
        const minimumNodeCount = getExpectedMinimumStoreNodeCount();

        if (nodeCount < minimumNodeCount) {
            return {
                ok: false,
                reason: `node count too small: ${nodeCount} < ${minimumNodeCount}`,
            };
        }

        return {
            ok: true,
            info,
            nodeCount,
        };
    } catch (error) {
        return {
            ok: false,
            reason: String(error?.message || error),
        };
    }
}