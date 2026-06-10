import {
    getNodeDirectFresh,
    getStoreCurrentLeafId,
} from "./common.js";

export function getStoreRootId(store) {
    try {
        const rootId = typeof store?.rootId === "function"
            ? store.rootId()
            : store?.rootId;

        return typeof rootId === "string" && rootId ? rootId : null;
    } catch {
        return null;
    }
}

export function getNodeParentId(node) {
    if (!node || typeof node !== "object") return null;

    return (
        node.parent ||
        node.parentId ||
        node.parent_id ||
        node.parentNodeId ||
        node.parent_node_id ||
        node.message?.parent ||
        node.message?.parentId ||
        node.message?.parent_id ||
        node.message?.parentNodeId ||
        node.message?.parent_node_id ||
        node.metadata?.parent ||
        node.metadata?.parentId ||
        node.metadata?.parent_id ||
        node.message?.metadata?.parent ||
        node.message?.metadata?.parentId ||
        node.message?.metadata?.parent_id ||
        null
    );
}

export function summarizeStoreNode(node) {
    if (!node || typeof node !== "object") {
        return null;
    }

    return {
        id: node.id ?? null,
        parentId: getNodeParentId(node),
        role:
            node.message?.author?.role ||
            node.message?.role ||
            node.author?.role ||
            node.role ||
            null,
        messageId:
            node.message?.id ||
            node.message?.message_id ||
            node.message?.metadata?.message_id ||
            null,
        childCount: Array.isArray(node.children) ? node.children.length : 0,
        status: node.message?.status ?? node.status ?? null,
    };
}

export function getStoreNodeAuthorRole(node) {
    if (!node || typeof node !== "object") return null;

    return (
        node.message?.author?.role ||
        node.message?.role ||
        node.author?.role ||
        node.role ||
        node.metadata?.author_role ||
        node.message?.metadata?.author_role ||
        null
    );
}

export function collectRecentExchangeKeepNodeIdsFromActiveBranch(
    store,
    {
        historyKeptExchanges = 1,
        maxDepth = 10000,
    } = {}
) {
    const keepNodeIds = new Set();
    const currentLeafId = getStoreCurrentLeafId(store);

    let keptExchangeCount = 0;
    let walkedNodeCount = 0;
    let stopReason = "unknown";

    if (!currentLeafId) {
        return {
            keepNodeIds,
            currentLeafId: null,
            keptExchangeCount,
            walkedNodeCount,
            stopReason: "missing current leaf",
        };
    }

    let node = getNodeDirectFresh(store, currentLeafId);
    const seen = new Set();

    while (node?.id && walkedNodeCount < maxDepth) {
        if (seen.has(node.id)) {
            stopReason = "cycle detected";
            break;
        }

        seen.add(node.id);
        keepNodeIds.add(node.id);
        walkedNodeCount += 1;

        const role = getStoreNodeAuthorRole(node);

        if (role === "user") {
            keptExchangeCount += 1;

            if (keptExchangeCount >= historyKeptExchanges) {
                stopReason = "kept requested exchanges";
                break;
            }
        }

        const parentId = getNodeParentId(node);

        if (!parentId) {
            stopReason = "reached root";
            break;
        }

        node = getNodeDirectFresh(store, parentId);
    }

    if (walkedNodeCount >= maxDepth) {
        stopReason = "max depth reached";
    }

    return {
        keepNodeIds,
        currentLeafId,
        keptExchangeCount,
        walkedNodeCount,
        stopReason,
    };
}

export function getActiveStoreBranchNewestFirst(store, { maxDepth = 10000 } = {}) {
    const currentLeafId = getStoreCurrentLeafId(store);
    const nodes = [];
    const seen = new Set();

    let node = getNodeDirectFresh(store, currentLeafId);

    for (let depth = 0; node?.id && depth < maxDepth; depth += 1) {
        if (seen.has(node.id)) {
            break;
        }

        seen.add(node.id);
        nodes.push(node);

        const parentId = getNodeParentId(node);
        if (!parentId) break;

        node = getNodeDirectFresh(store, parentId);
    }

    return {
        currentLeafId,
        nodes,
        truncated: nodes.length >= maxDepth,
    };
}

export function getStoreDeleteNodeMethod(store) {
    if (typeof store?.deleteNode === "function") {
        return {
            name: "deleteNode",
            fn: store.deleteNode,
            mode: "delete-node",
        };
    }

    if (typeof store?.deleteClientOnlyMessage === "function") {
        return {
            name: "deleteClientOnlyMessage",
            fn: store.deleteClientOnlyMessage,
            mode: "splice-node",
        };
    }

    return null;
}

export function deleteStoreNodeFresh(store, nodeId, { reason = "store-prune" } = {}) {
    const beforeNode = getNodeDirectFresh(store, nodeId);
    const beforeSummary = summarizeStoreNode(beforeNode);

    if (!beforeNode?.id) {
        return {
            ok: false,
            nodeId,
            reason: "node not found",
            beforeSummary,
            afterSummary: null,
            deleteMethod: null,
        };
    }

    const deleteMethod = getStoreDeleteNodeMethod(store);

    if (!deleteMethod) {
        return {
            ok: false,
            nodeId,
            reason: "delete method unavailable",
            beforeSummary,
            afterSummary: summarizeStoreNode(getNodeDirectFresh(store, nodeId)),
            deleteMethod: null,
        };
    }

    try {
        deleteMethod.fn.call(store, nodeId);
    } catch (error) {
        return {
            ok: false,
            nodeId,
            reason: `${deleteMethod.name}: ${String(error?.message || error)}`,
            beforeSummary,
            afterSummary: summarizeStoreNode(getNodeDirectFresh(store, nodeId)),
            deleteMethod: deleteMethod.name,
        };
    }

    const afterNode = getNodeDirectFresh(store, nodeId);
    const afterSummary = summarizeStoreNode(afterNode);

    if (afterNode?.id) {
        return {
            ok: false,
            nodeId,
            reason: "node still exists after delete",
            beforeSummary,
            afterSummary,
            deleteMethod: deleteMethod.name,
        };
    }

    return {
        ok: true,
        nodeId,
        reason,
        beforeSummary,
        afterSummary,
        deleteMethod: deleteMethod.name,
    };
}