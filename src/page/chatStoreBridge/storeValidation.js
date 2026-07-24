import {
    findStoreNodeByMessageId,
    getNodeDirect,
    getStoreCurrentLeafId,
    getStoreNodeCount,
    getStoreNodeValues,
    isObjectLike,
    safeCall,
} from "./common.js";
import {
    getExpectedMinimumStoreNodeCount,
    getNewestVisibleMessageIdFromDom,
} from "./domState.js";

export const rejectedStores = new WeakSet();
export const rejectedStoreReasons = new Map();

export const STORE_CANDIDATE_MIN_SCORE = 80;

export function getStoreInfo(store) {
    if (!store) {
        return {
            found: false,
            nodeCount: null,
            rootId: null,
            currentLeafId: null,
            capabilities: null,
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

    let capabilities = null;

    try {
        capabilities = getStoreCapabilities(store).capabilities;
    } catch {}

    return {
        found: true,
        nodeCount: getStoreNodeCount(store),
        rootId,
        currentLeafId,
        capabilities,
    };
}

export function hasAnyStoreCandidateSignal(value) {
    if (!value || typeof value !== "object") return false;

    return (
        "nodes" in value ||
        "rootId" in value ||
        "currentLeafId" in value ||
        "getNodeIfExists" in value ||
        "getNode" in value ||
        "getMessage" in value ||
        "getMaybeMessage" in value ||
        "messageIdToExistingNodeId" in value ||
        "getNodeByIdOrMessageId" in value ||
        "deleteNode" in value ||
        "deleteClientOnlyMessage" in value ||
        "moveNode" in value ||
        "getBranch" in value ||
        "getBranchFromLeaf" in value ||
        "addMessage" in value ||
        "addOptimisticMessage" in value ||
        "addClientOnlyMessage" in value ||
        "prependNode" in value
    );
}

// Backwards-compatible export for older callers/tests.
// Do not use this as a hard method gate anymore.
export function hasAnyStoreMethodName(value) {
    return hasAnyStoreCandidateSignal(value);
}

function inspectStoreNodeShapes(store, sampleLimit = 32) {
    const nodes = getStoreNodeValues(store);
    const sampleNodes = nodes.slice(0, sampleLimit);

    let plausibleNodeShapeCount = 0;
    let messageNodeShapeCount = 0;
    let parentLinkedNodeShapeCount = 0;
    let childLinkedNodeShapeCount = 0;

    for (let i = 0; i < sampleNodes.length; i += 1) {
        const node = sampleNodes[i];

        if (!node || typeof node !== "object") {
            continue;
        }

        const hasId = typeof node.id === "string" && node.id.length > 0;
        const hasParent =
            "parentId" in node ||
            "parent" in node ||
            "parent_id" in node ||
            "parentNodeId" in node ||
            "parent_node_id" in node;

        const hasChildren = Array.isArray(node.children);

        const hasMessageLikeShape = Boolean(
            node.message ||
            node.author ||
            node.role ||
            node.metadata ||
            node.message?.author ||
            node.message?.metadata
        );

        if (hasId && (hasParent || hasChildren || hasMessageLikeShape)) {
            plausibleNodeShapeCount += 1;
        }

        if (hasId && hasParent) {
            parentLinkedNodeShapeCount += 1;
        }

        if (hasId && hasChildren) {
            childLinkedNodeShapeCount += 1;
        }

        if (hasId && hasMessageLikeShape) {
            messageNodeShapeCount += 1;
        }
    }

    return {
        sampleSize: sampleNodes.length,
        plausibleNodeShapeCount,
        messageNodeShapeCount,
        parentLinkedNodeShapeCount,
        childLinkedNodeShapeCount,

        plausibleNodeShapes: plausibleNodeShapeCount > 0,
        messageNodeShapes: messageNodeShapeCount > 0,
        parentLinkedNodeShapes: parentLinkedNodeShapeCount > 0,
        childLinkedNodeShapes: childLinkedNodeShapeCount > 0,
    };
}

export function getStoreCapabilities(store) {
    const nodeCount = getStoreNodeCount(store);
    const currentLeafId = getStoreCurrentLeafId(store);
    const currentLeafNode = currentLeafId
        ? getNodeDirect(store, currentLeafId)
        : null;

    let rootId = null;

    try {
        rootId = safeCall(store?.rootId);
    } catch {}

    const shape = inspectStoreNodeShapes(store);

    const deleteNode = typeof store?.deleteNode === "function";
    const deleteClientOnlyMessage =
        typeof store?.deleteClientOnlyMessage === "function";

    const capabilities = {
        nodes: nodeCount > 0,
        rootId: Boolean(rootId),
        currentLeafId: Boolean(currentLeafId),
        currentLeafNode: Boolean(currentLeafNode),

        plausibleNodeShapes: shape.plausibleNodeShapes,
        messageNodeShapes: shape.messageNodeShapes,
        parentLinkedNodeShapes: shape.parentLinkedNodeShapes,
        childLinkedNodeShapes: shape.childLinkedNodeShapes,

        getNodeIfExists: typeof store?.getNodeIfExists === "function",
        getNode: typeof store?.getNode === "function",
        getMessage: typeof store?.getMessage === "function",
        getMaybeMessage: typeof store?.getMaybeMessage === "function",
        getBranch: typeof store?.getBranch === "function",
        getBranchFromLeaf: typeof store?.getBranchFromLeaf === "function",
        getNodeByIdOrMessageId: typeof store?.getNodeByIdOrMessageId === "function",
        messageIdToExistingNodeId: typeof store?.messageIdToExistingNodeId === "function",

        deleteNode,
        deleteClientOnlyMessage,
        canDeleteNode: deleteNode || deleteClientOnlyMessage,

        moveNode: typeof store?.moveNode === "function",
        addMessage: typeof store?.addMessage === "function",
        addOptimisticMessage: typeof store?.addOptimisticMessage === "function",
        addClientOnlyMessage: typeof store?.addClientOnlyMessage === "function",
        prependNode: typeof store?.prependNode === "function",

        nodesFallbackMessageIdResolution: nodeCount > 0 && shape.messageNodeShapes,
    };

    return {
        capabilities,
        nodeCount,
        rootId,
        currentLeafId,
        hasCurrentLeafNode: Boolean(currentLeafNode),
        shape,
    };
}

export function looksLikeStore(value) {
    if (!isObjectLike(value)) return false;
    if (typeof value === "function") return false;
    if (rejectedStores.has(value)) return false;

    try {
        const inspection = getStoreCapabilities(value);

        return (
            inspection.capabilities.nodes &&
            inspection.capabilities.plausibleNodeShapes &&
            (
                inspection.hasCurrentLeafNode ||
                inspection.capabilities.messageNodeShapes ||
                inspection.capabilities.currentLeafId
            )
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
            resolver: "none",
        };
    }

    try {
        let nodeId = null;
        let node = null;
        let resolver = "none";

        if (typeof store.messageIdToExistingNodeId === "function") {
            nodeId = store.messageIdToExistingNodeId.call(store, newestMessageId);
            resolver = "messageIdToExistingNodeId";

            const nodeCache =
                window.__threadOptimizerChatStoreBridge?.__nodeObjectCacheApi;

            node = nodeId
                ? nodeCache
                    ? nodeCache.resolve(nodeId)
                    : getNodeDirect(store, nodeId)
                : null;
        }

        if (!node) {
            node = findStoreNodeByMessageId(store, newestMessageId);
            nodeId = node?.id ?? null;
            resolver = "nodes-fallback";
        }

        if (!nodeId) {
            return {
                ok: false,
                reason: "message id did not resolve",
                newestMessageId,
                nodeId: null,
                resolver,
            };
        }

        if (!node) {
            return {
                ok: false,
                reason: "resolved node id not found in store",
                newestMessageId,
                nodeId,
                resolver,
            };
        }

        return {
            ok: true,
            newestMessageId,
            nodeId,
            node,
            resolver,
        };
    } catch (error) {
        return {
            ok: false,
            reason: String(error?.message || error),
            newestMessageId,
            nodeId: null,
            resolver: "error",
        };
    }
}

export function scoreStoreCandidate(store) {
    const inspection = getStoreCapabilities(store);
    const {
        capabilities,
        nodeCount,
        currentLeafId,
        hasCurrentLeafNode,
        shape,
    } = inspection;

    const visibleNewest = candidateStoreCanResolveVisibleNewestNode(store);

    let score = 0;

    if (capabilities.nodes) score += 30;
    if (capabilities.plausibleNodeShapes) score += 35;
    if (capabilities.messageNodeShapes) score += 20;
    if (capabilities.parentLinkedNodeShapes) score += 15;
    if (capabilities.childLinkedNodeShapes) score += 10;

    if (capabilities.rootId) score += 15;
    if (capabilities.currentLeafId) score += 20;
    if (hasCurrentLeafNode) score += 50;

    if (capabilities.getNodeIfExists) score += 20;
    if (capabilities.getNode) score += 15;
    if (capabilities.getMessage) score += 10;
    if (capabilities.getMaybeMessage) score += 10;
    if (capabilities.getNodeByIdOrMessageId) score += 20;
    if (capabilities.messageIdToExistingNodeId) score += 20;
    if (capabilities.getBranch) score += 20;
    if (capabilities.getBranchFromLeaf) score += 15;

    if (capabilities.deleteNode) score += 30;
    if (capabilities.deleteClientOnlyMessage) score += 25;
    if (capabilities.moveNode) score += 10;
    if (capabilities.addMessage) score += 10;
    if (capabilities.addOptimisticMessage) score += 10;
    if (capabilities.addClientOnlyMessage) score += 10;
    if (capabilities.prependNode) score += 10;

    if (visibleNewest.ok) score += 1_000_000;

    score += Math.min(nodeCount, 50_000);

    return {
        score,
        capabilities,
        nodeCount,
        currentLeafId,
        hasCurrentLeafNode,
        visibleNewest,
        shape,
    };
}

export function validateStoreCandidate(store) {
    if (!isObjectLike(store) || typeof store === "function") {
        return {
            ok: false,
            reason: "not an object-like store candidate",
        };
    }

    if (rejectedStores.has(store)) {
        return {
            ok: false,
            reason: "previously rejected store candidate",
        };
    }

    try {
        const scored = scoreStoreCandidate(store);
        const minimumNodeCount = getExpectedMinimumStoreNodeCount();

        if (
            scored.nodeCount < minimumNodeCount &&
            !scored.visibleNewest.ok
        ) {
            return {
                ok: false,
                reason: `node count too small: ${scored.nodeCount} < ${minimumNodeCount}`,
                scored,
            };
        }

        const hasStrongTopology =
            scored.capabilities.nodes &&
            scored.capabilities.plausibleNodeShapes &&
            (
                scored.hasCurrentLeafNode ||
                scored.visibleNewest.ok ||
                (
                    scored.capabilities.currentLeafId &&
                    scored.capabilities.messageNodeShapes
                )
            );

        if (!hasStrongTopology) {
            return {
                ok: false,
                reason: "insufficient conversation topology evidence",
                scored,
            };
        }

        if (scored.score < STORE_CANDIDATE_MIN_SCORE) {
            return {
                ok: false,
                reason: `store candidate score too low: ${scored.score}`,
                scored,
            };
        }

        return {
            ok: true,
            info: getStoreInfo(store),
            nodeCount: scored.nodeCount,
            scored,
            capabilities: scored.capabilities,
        };
    } catch (error) {
        return {
            ok: false,
            reason: String(error?.message || error),
        };
    }
}