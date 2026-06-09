import { GLOBAL_KEY } from "./config.js";

export const CACHE_MISS = Symbol("threadOptimizerCacheMiss");

export function clearBridgeSlots(bridge, slots) {
    for (let i = 0; i < slots.length; i += 1) {
        bridge[slots[i]] = null;
    }
}

export function isObjectLike(value) {
    return value !== null && (typeof value === "object" || typeof value === "function");
}

export function safeCall(value) {
    try {
        return typeof value === "function" ? value() : value;
    } catch {
        return null;
    }
}

export function unavailable(reason) {
    return { ok: false, reason };
}

export function alreadyInstalled(stats = null) {
    return stats
        ? { ok: true, alreadyInstalled: true, stats }
        : { ok: true, alreadyInstalled: true };
}

export function getBridge() {
    return window[GLOBAL_KEY] || null;
}

export function getStoreCurrentLeafId(store) {
    try {
        return typeof store?.currentLeafId === "function"
            ? store.currentLeafId()
            : store?.currentLeafId ?? null;
    } catch {
        return null;
    }
}

export function getStoreNodeValues(store) {
    try {
        const nodes = store?.nodes;

        if (nodes instanceof Map) {
            return Array.from(nodes.values());
        }

        if (Array.isArray(nodes)) {
            return nodes;
        }

        if (nodes && typeof nodes === "object") {
            return Object.values(nodes);
        }
    } catch {}

    return [];
}

export function findStoreNodeByMessageId(store, messageId) {
    if (!store || !messageId) {
        return null;
    }

    const directNode = getNodeDirectFresh(store, messageId);

    if (directNode?.id) {
        return directNode;
    }

    const nodes = getStoreNodeValues(store);

    for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];

        const candidateMessageId =
            node?.message?.id ||
            node?.message?.message_id ||
            node?.message?.metadata?.message_id ||
            null;

        if (candidateMessageId === messageId) {
            return node;
        }
    }

    return null;
}

export function getStoreNodeCount(store) {
    return getStoreNodeValues(store).length;
}

export function getNodeDirectFresh(store, nodeId) {
    if (!store || !nodeId) return null;

    const nodes = store.nodes;
    if (!nodes) return null;

    if (nodes instanceof Map) {
        return nodes.get(nodeId) ?? null;
    }

    if (Array.isArray(nodes)) {
        for (let i = 0; i < nodes.length; i += 1) {
            const candidate = nodes[i];
            if (candidate?.id === nodeId) return candidate;
        }

        return null;
    }

    if (typeof nodes === "object") {
        return nodes[nodeId] ?? null;
    }

    return null;
}

export function getNodeDirect(store, nodeId) {
    if (!store || !nodeId) return null;

    const bridge = getBridge();
    const directIndex = bridge?.__nodeIdDirectIndex;

    if (directIndex instanceof Map) {
        const indexed = directIndex.get(nodeId);
        if (indexed !== undefined) return indexed ?? null;
    }

    const nodes = store.nodes;
    if (!nodes) return null;

    let node = null;

    if (Array.isArray(nodes)) {
        if (
            bridge &&
            (
                bridge.__nodeIdDirectIndexSource !== nodes ||
                !(bridge.__nodeIdDirectIndex instanceof Map)
            )
        ) {
            const index = new Map();

            for (let i = 0; i < nodes.length; i += 1) {
                const candidate = nodes[i];
                if (candidate?.id) index.set(candidate.id, candidate);
            }

            bridge.__nodeIdDirectIndex = index;
            bridge.__nodeIdDirectIndexSource = nodes;
        }

        node = bridge?.__nodeIdDirectIndex instanceof Map
            ? bridge.__nodeIdDirectIndex.get(nodeId) ?? null
            : nodes.find((candidate) => candidate?.id === nodeId) ?? null;
    } else if (nodes instanceof Map) {
        node = nodes.get(nodeId) ?? null;
    } else if (typeof nodes === "object") {
        node = nodes[nodeId] ?? null;
    }

    if (node && bridge?.__nodeIdDirectIndex instanceof Map) {
        bridge.__nodeIdDirectIndex.set(nodeId, node);
    }

    return node;
}