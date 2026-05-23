const INITIAL_LOAD_HIDING_LOG_PREFIX = "[thread-optimizer initial-load-hiding]";

const DEFAULT_ENABLED = false;
const DEFAULT_HISTORY_KEPT_EXCHANGES = 10;
const SETTINGS_WAIT_TIMEOUT_MS = 1200;

const CONVERSATION_URL_PATTERN =
    /\/backend-api\/conversation\/[^/?#]+(?:[?#].*)?$/;

const state = {
    installed: false,
    enabled: DEFAULT_ENABLED,
    settingsReady: false,
    settingsWaiters: new Set(),
    debug: false,
    historyKeptExchanges: DEFAULT_HISTORY_KEPT_EXCHANGES,
    originalFetch: null,
    stats: {
        intercepted: 0,
        skipped: 0,
        trimmed: 0,
        failed: 0,
        waitedForSettings: 0,
        settingsWaitTimedOut: 0,
        lastReason: null,
        lastOriginalNodeCount: 0,
        lastTrimmedNodeCount: 0,
        lastDeletedNodeCount: 0,
    },
};

function debugLog(message, details = null) {
    if (!state.debug) {
        return;
    }

    if (details) {
        console.debug(INITIAL_LOAD_HIDING_LOG_PREFIX, message, details);
    } else {
        console.debug(INITIAL_LOAD_HIDING_LOG_PREFIX, message);
    }
}

function resolveSettingsWaiters() {
    const waiters = Array.from(state.settingsWaiters);

    state.settingsWaiters.clear();

    for (const resolve of waiters) {
        resolve(true);
    }
}

function waitForInitialLoadHidingSettings(timeoutMs = SETTINGS_WAIT_TIMEOUT_MS) {
    if (state.settingsReady) {
        return Promise.resolve(true);
    }

    state.stats.waitedForSettings += 1;

    return new Promise((resolve) => {
        let settled = false;

        const finish = (ready) => {
            if (settled) {
                return;
            }

            settled = true;
            state.settingsWaiters.delete(finish);

            if (!ready) {
                state.stats.settingsWaitTimedOut += 1;
            }

            resolve(ready);
        };

        state.settingsWaiters.add(finish);

        window.setTimeout(() => {
            finish(false);
        }, timeoutMs);
    });
}

function normalizeHistoryKeptExchanges(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return DEFAULT_HISTORY_KEPT_EXCHANGES;
    }

    return Math.max(1, Math.floor(number));
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getRequestMethod(input, init) {
    if (init?.method) {
        return String(init.method).toUpperCase();
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
        return String(input.method || "GET").toUpperCase();
    }

    return "GET";
}

function getRequestUrl(input) {
    try {
        if (typeof input === "string") {
            return input;
        }

        if (input instanceof URL) {
            return input.href;
        }

        if (typeof Request !== "undefined" && input instanceof Request) {
            return input.url;
        }
    } catch {
        return "";
    }

    return "";
}

function shouldInspectFetch(input, init) {
    if (getRequestMethod(input, init) !== "GET") {
        return false;
    }

    const url = getRequestUrl(input);

    if (!url) {
        return false;
    }

    return CONVERSATION_URL_PATTERN.test(url);
}

function getNodeRole(node) {
    return node?.message?.author?.role ?? node?.message?.role ?? null;
}

function isExchangeBoundaryRole(role) {
    return role === "user";
}

function cloneNode(node) {
    if (!isPlainObject(node)) {
        return node;
    }

    return {
        ...node,
        children: Array.isArray(node.children)
            ? [...node.children]
            : node.children,
    };
}

function findRootNodeId(mapping) {
    if (!isPlainObject(mapping)) {
        return null;
    }

    if (mapping["client-created-root"]) {
        return "client-created-root";
    }

    for (const [id, node] of Object.entries(mapping)) {
        if (node?.parent == null) {
            return id;
        }
    }

    return null;
}

function getActiveBranchOldestFirst(payload) {
    const mapping = payload?.mapping;
    const currentNodeId = payload?.current_node;

    if (!isPlainObject(mapping) || typeof currentNodeId !== "string") {
        return null;
    }

    const branchNewestFirst = [];
    const visited = new Set();

    let nodeId = currentNodeId;

    while (nodeId) {
        if (visited.has(nodeId)) {
            return null;
        }

        visited.add(nodeId);

        const node = mapping[nodeId];

        if (!isPlainObject(node)) {
            return null;
        }

        branchNewestFirst.push(node);

        if (node.parent == null) {
            break;
        }

        if (typeof node.parent !== "string") {
            return null;
        }

        nodeId = node.parent;
    }

    if (branchNewestFirst.length === 0) {
        return null;
    }

    return branchNewestFirst.reverse();
}

function findSuffixStartIndexForRecentExchanges(branchOldestFirst, keepExchanges) {
    let exchangeCount = 0;

    for (let i = branchOldestFirst.length - 1; i >= 0; i -= 1) {
        const role = getNodeRole(branchOldestFirst[i]);

        if (!isExchangeBoundaryRole(role)) {
            continue;
        }

        exchangeCount += 1;

        if (exchangeCount >= keepExchanges) {
            return i;
        }
    }

    return 0;
}

function buildTrimmedMapping(payload, branchOldestFirst, suffixStartIndex) {
    const originalMapping = payload.mapping;
    const rootNodeId = findRootNodeId(originalMapping);

    if (!rootNodeId || !originalMapping[rootNodeId]) {
        return null;
    }

    const suffixNodes = branchOldestFirst.slice(suffixStartIndex);

    if (suffixNodes.length === 0) {
        return null;
    }

    const keepIds = new Set([
        rootNodeId,
        ...suffixNodes.map((node) => node?.id).filter(Boolean),
    ]);

    if (!keepIds.has(payload.current_node)) {
        return null;
    }

    const trimmedMapping = {};

    for (const id of keepIds) {
        const originalNode = originalMapping[id];

        if (!isPlainObject(originalNode)) {
            return null;
        }

        trimmedMapping[id] = cloneNode(originalNode);
    }

    const firstKeptNodeId = suffixNodes[0]?.id;

    if (!firstKeptNodeId || !trimmedMapping[firstKeptNodeId]) {
        return null;
    }

    for (const [id, node] of Object.entries(trimmedMapping)) {
        if (Array.isArray(node.children)) {
            node.children = node.children.filter((childId) =>
                keepIds.has(childId)
            );
        }

        if (id !== rootNodeId && node.parent && !keepIds.has(node.parent)) {
            node.parent = rootNodeId;
        }
    }

    const root = trimmedMapping[rootNodeId];

    if (Array.isArray(root.children)) {
        root.children = root.children.filter((childId) => keepIds.has(childId));

        if (!root.children.includes(firstKeptNodeId)) {
            root.children = [firstKeptNodeId];
        }
    } else {
        root.children = [firstKeptNodeId];
    }

    trimmedMapping[firstKeptNodeId].parent = rootNodeId;

    return trimmedMapping;
}

function validateTrimmedPayload(payload) {
    const mapping = payload?.mapping;
    const currentNodeId = payload?.current_node;

    if (!isPlainObject(mapping) || typeof currentNodeId !== "string") {
        return false;
    }

    if (!mapping[currentNodeId]) {
        return false;
    }

    for (const [id, node] of Object.entries(mapping)) {
        if (!isPlainObject(node)) {
            return false;
        }

        if (node.id !== id) {
            return false;
        }

        if (node.parent != null && !mapping[node.parent]) {
            return false;
        }

        if (Array.isArray(node.children)) {
            for (const childId of node.children) {
                if (!mapping[childId]) {
                    return false;
                }
            }
        }
    }

    return true;
}

export function trimConversationPayloadForInitialLoadHiding(
    payload,
    {
        historyKeptExchanges = state.historyKeptExchanges,
    } = {}
) {
    if (!isPlainObject(payload)) {
        return {
            ok: false,
            reason: "payload not object",
            payload,
        };
    }

    if (!isPlainObject(payload.mapping) || typeof payload.current_node !== "string") {
        return {
            ok: false,
            reason: "payload does not match conversation mapping shape",
            payload,
        };
    }

    const keepExchanges = normalizeHistoryKeptExchanges(historyKeptExchanges);
    const branchOldestFirst = getActiveBranchOldestFirst(payload);

    if (!branchOldestFirst) {
        return {
            ok: false,
            reason: "active branch unavailable",
            payload,
        };
    }

    const suffixStartIndex = findSuffixStartIndexForRecentExchanges(
        branchOldestFirst,
        keepExchanges
    );

    if (suffixStartIndex <= 0) {
        return {
            ok: false,
            reason: "nothing to trim",
            payload,
        };
    }

    const trimmedMapping = buildTrimmedMapping(
        payload,
        branchOldestFirst,
        suffixStartIndex
    );

    if (!trimmedMapping) {
        return {
            ok: false,
            reason: "failed to build trimmed mapping",
            payload,
        };
    }

    const nextPayload = {
        ...payload,
        mapping: trimmedMapping,
    };

    if (!validateTrimmedPayload(nextPayload)) {
        return {
            ok: false,
            reason: "trimmed payload validation failed",
            payload,
        };
    }

    const originalNodeCount = Object.keys(payload.mapping).length;
    const trimmedNodeCount = Object.keys(trimmedMapping).length;

    if (trimmedNodeCount >= originalNodeCount) {
        return {
            ok: false,
            reason: "trimmed payload did not reduce node count",
            payload,
        };
    }

    return {
        ok: true,
        reason: "trimmed",
        payload: nextPayload,
        originalNodeCount,
        trimmedNodeCount,
        deletedNodeCount: originalNodeCount - trimmedNodeCount,
        branchNodeCount: branchOldestFirst.length,
        suffixStartIndex,
        historyKeptExchanges: keepExchanges,
    };
}

function createJsonResponse(originalResponse, payload) {
    const headers = new Headers(originalResponse.headers);

    headers.set("content-type", "application/json; charset=utf-8");
    headers.delete("content-length");
    headers.delete("content-encoding");

    return new Response(JSON.stringify(payload), {
        status: originalResponse.status,
        statusText: originalResponse.statusText,
        headers,
    });
}

async function maybeTrimConversationResponse(response) {
    if (!response?.ok) {
        return response;
    }

    const settingsReady = await waitForInitialLoadHidingSettings();

    if (!settingsReady || !state.enabled) {
        state.stats.skipped += 1;
        state.stats.lastReason = settingsReady
            ? "initial-load hiding disabled"
            : "settings wait timed out";
        return response;
    }

    const contentType = response.headers?.get?.("content-type") || "";

    if (contentType && !contentType.toLowerCase().includes("json")) {
        state.stats.skipped += 1;
        state.stats.lastReason = "non-json response";
        return response;
    }

    let payload;

    try {
        payload = await response.clone().json();
    } catch {
        state.stats.skipped += 1;
        state.stats.lastReason = "response json parse failed";
        return response;
    }

    const result = trimConversationPayloadForInitialLoadHiding(payload);

    state.stats.lastReason = result.reason;

    if (!result.ok) {
        state.stats.skipped += 1;
        debugLog("skipped conversation response", {
            reason: result.reason,
        });
        return response;
    }

    state.stats.trimmed += 1;
    state.stats.lastOriginalNodeCount = result.originalNodeCount;
    state.stats.lastTrimmedNodeCount = result.trimmedNodeCount;
    state.stats.lastDeletedNodeCount = result.deletedNodeCount;

    debugLog("trimmed conversation response", {
        originalNodeCount: result.originalNodeCount,
        trimmedNodeCount: result.trimmedNodeCount,
        deletedNodeCount: result.deletedNodeCount,
        historyKeptExchanges: result.historyKeptExchanges,
    });

    return createJsonResponse(response, result.payload);
}

export function setInitialLoadHidingState({
    enabled = state.enabled,
    historyKeptExchanges = state.historyKeptExchanges,
    debug = state.debug,
} = {}) {
    state.enabled = Boolean(enabled);
    state.historyKeptExchanges =
        normalizeHistoryKeptExchanges(historyKeptExchanges);
    state.debug = Boolean(debug);
    state.settingsReady = true;

    resolveSettingsWaiters();

    debugLog("state updated", {
        enabled: state.enabled,
        historyKeptExchanges: state.historyKeptExchanges,
    });

    return getInitialLoadHidingState();
}

export function getInitialLoadHidingState() {
    return {
        installed: state.installed,
        enabled: state.enabled,
        settingsReady: state.settingsReady,
        debug: state.debug,
        historyKeptExchanges: state.historyKeptExchanges,
        stats: {
            ...state.stats,
        },
    };
}

export function installInitialLoadHiding({
    enabled = state.enabled,
    historyKeptExchanges = state.historyKeptExchanges,
    debug = state.debug,
} = {}) {
    state.enabled = Boolean(enabled);
    state.historyKeptExchanges =
        normalizeHistoryKeptExchanges(historyKeptExchanges);
    state.debug = Boolean(debug);

    if (state.installed) {
        return getInitialLoadHidingState();
    }

    if (typeof window === "undefined" || typeof window.fetch !== "function") {
        return {
            ...getInitialLoadHidingState(),
            installed: false,
            reason: "fetch unavailable",
        };
    }

    state.originalFetch = window.fetch;

    window.fetch = async function threadOptimizerInitialLoadFetch(input, init) {
        const response = await state.originalFetch.call(window, input, init);

        if (!shouldInspectFetch(input, init)) {
            return response;
        }

        state.stats.intercepted += 1;

        try {
            return await maybeTrimConversationResponse(response);
        } catch (error) {
            state.stats.failed += 1;
            state.stats.lastReason = String(error?.message || error);

            debugLog("failed to trim conversation response", {
                error: state.stats.lastReason,
            });

            return response;
        }
    };

    state.installed = true;

    debugLog("fetch interceptor installed", {
        enabled: state.enabled,
        historyKeptExchanges: state.historyKeptExchanges,
    });

    return getInitialLoadHidingState();
}

export function resetInitialLoadHidingForTests() {
    if (state.installed && state.originalFetch) {
        window.fetch = state.originalFetch;
    }

    state.installed = false;
    state.enabled = DEFAULT_ENABLED;
    state.settingsReady = false;
    state.settingsWaiters.clear();
    state.debug = false;
    state.historyKeptExchanges = DEFAULT_HISTORY_KEPT_EXCHANGES;
    state.originalFetch = null;
    state.stats = {
        intercepted: 0,
        skipped: 0,
        trimmed: 0,
        failed: 0,
        waitedForSettings: 0,
        settingsWaitTimedOut: 0,
        lastReason: null,
        lastOriginalNodeCount: 0,
        lastTrimmedNodeCount: 0,
        lastDeletedNodeCount: 0,
    };
}