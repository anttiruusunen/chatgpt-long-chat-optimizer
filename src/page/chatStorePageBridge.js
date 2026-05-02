(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";

    function waitForBridge(timeout = 5000, interval = 50) {
        return new Promise(resolve => {
            const start = Date.now();
            const timer = setInterval(() => {
                if (window.__threadOptimizerChatStoreBridge) {
                    clearInterval(timer);
                    resolve(window.__threadOptimizerChatStoreBridge);
                } else if (Date.now() - start > timeout) {
                    clearInterval(timer);
                    resolve(null);
                }
            }, interval);
        });
    }

    async function installBridgeSafely() {
        const currentScript = document.currentScript;
        const token = currentScript?.getAttribute("data-thread-optimizer-chat-store-page-bridge-token");

        if (!token) {
            console.warn("[thread-optimizer bridge] no token found, bridge install skipped");
            return;
        }

        const bridge = await waitForBridge();
        if (!bridge) {
            console.warn("[thread-optimizer bridge] bridge object never initialized, install skipped");
            return;
        }

        if (!bridge.__installed && typeof bridge.install === "function") {
            bridge.install(token);
        }
    }

    installBridgeSafely();

    const BRIDGE_VERSION = 8;

    const MAX_FIBERS = 4000;
    const MAX_OBJECTS = 15000;
    const DISCOVERY_RETRY_MS = 1200;
    const MAX_DISCOVERY_RUNS = 30;
    const DEFAULT_CACHE_MAX_SIZE = 5000;
    const PROMOTION_INTERVAL_MS = 10000;
    const PROMOTION_INITIAL_DELAY_MS = 8000;

    const DISCOVERY_LOG_PREFIX = "[thread-optimizer bridge init]";

    const PAGE_SCRIPT_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";
    const TRUSTED_SOURCE = "thread-optimizer";

    const MESSAGE_TYPES = new Set([
        "thread-optimizer:set-pruning-state",
        "thread-optimizer:record-pruned-message-id",
        "thread-optimizer:log-store-performance",
        "thread-optimizer:set-store-read-optimization",
    ]);

    function getBridgeTokenFromCurrentScript() {
        const script = document.currentScript;

        if (!(script instanceof HTMLScriptElement)) {
            return null;
        }

        const token = script.getAttribute(PAGE_SCRIPT_TOKEN_ATTR);

        if (typeof token !== "string") {
            return null;
        }

        const normalized = token.trim();

        if (!/^[a-f0-9]{32}$/i.test(normalized)) {
            return null;
        }

        return normalized;
    }

    const BRIDGE_TOKEN = getBridgeTokenFromCurrentScript();

    if (!BRIDGE_TOKEN) {
        console.warn("[thread-optimizer bridge] blocked install because bridge token is missing");
        return;
    }

    const ENABLE_DEBUG = false;
    const ENABLE_STORE_PROFILER = ENABLE_DEBUG;
    const ENABLE_BRANCH_CALLSITE_STATS = ENABLE_DEBUG;
    const ENABLE_CACHE_PROFILING = ENABLE_DEBUG;
    const ENABLE_NODE_CALLSITE_STATS = ENABLE_DEBUG;

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    const CACHE_MISS = Symbol("threadOptimizerCacheMiss");

    function createPersistentCache({ maxSize, stats, profiled = false }) {
        const cache = new Map();

        function clear(reason) {
            if (cache.size !== 0) {
                cache.clear();
                if (profiled && stats && "cached" in stats) stats.cached = 0;
            }

            if (profiled && stats) {
                stats.frameClears += 1;
                stats.lastClearReason = reason;
            }
        }

        const get = profiled
            ? function getProfiled(key) {
                const value = cache.get(key);

                if (value !== undefined) {
                    stats.hits += 1;
                    return value === CACHE_MISS ? null : value;
                }

                stats.misses += 1;
                return undefined;
            }
            : function getProduction(key) {
                const value = cache.get(key);
                return value === undefined
                    ? undefined
                    : value === CACHE_MISS
                        ? null
                        : value;
            };

        const set = profiled
            ? function setProfiled(key, value) {
                cache.set(key, value === null ? CACHE_MISS : value);

                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                    stats.evictions += 1;
                }

                stats.cached = cache.size;
            }
            : function setProduction(key, value) {
                cache.set(key, value === null ? CACHE_MISS : value);

                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                }
            };

        return { get, set, clear, cache };
    }

    function getVisibleConversationTurnCount() {
        try {
            return document.querySelectorAll(
                'section[data-testid^="conversation-turn-"], section[data-turn]'
            ).length;
        } catch {
            return 0;
        }
    }

    function getEstimatedConversationTurnCount() {
        const visibleTurns = getVisibleConversationTurnCount();
        const bridge = window[GLOBAL_KEY];

        const pruningEnabled =
            bridge?.__knownPruningEnabled === true;

        const prunedTurns =
            pruningEnabled && Number.isFinite(bridge?.__knownPrunedTurnCount)
                ? bridge.__knownPrunedTurnCount
                : 0;

        return visibleTurns + prunedTurns;
    }

    function getExpectedMinimumStoreNodeCount() {
        const estimatedTurns = getEstimatedConversationTurnCount();

        if (estimatedTurns <= 2) return 1;

        return Math.max(3, Math.floor(estimatedTurns * 0.25));
    }

    function isStoreGoodEnough(store) {
        const nodeCount = getStoreNodeCount(store);
        const minimum = getExpectedMinimumStoreNodeCount();

        return nodeCount >= minimum;
    }

    const FRAME_CACHE_SLOTS = [
        ["__existingNodeFrameCache", "__existingNodeFrameCacheStats"],
        ["__findNodeFromLeafFrameCache", "__findNodeFromLeafFrameCacheStats"],
        ["__getLeafFromNodeFrameCache", "__getLeafFromNodeFrameCacheStats"],
        ["__branchCache", "__branchCacheStats"],
        ["__resolvedNodeFrameCache", "__resolvedNodeFrameCacheStats"],
        ["__getDisplayTurnsCache", "__getDisplayTurnsCacheStats"],
    ];

    function resetFrameCacheStats(stats, cache) {
        if (!stats) return;

        if ("hits" in stats) stats.hits = 0;
        if ("misses" in stats) stats.misses = 0;

        stats.cached = cache?.size ?? 0;

        if ("evictions" in stats) stats.evictions = 0;
        if ("frameClears" in stats) stats.frameClears = 0;

        stats.lastClearReason = null;
    }

    function uninstallMethodFrameCache({
        bridge,
        originalSlot,
        installedFlag,
    }) {
        if (!bridge[installedFlag]) {
            return { ok: true, alreadyUninstalled: true };
        }

        const originals = bridge[originalSlot];

        if (bridge.__store && originals) {
            for (const [name, fn] of Object.entries(originals)) {
                bridge.__store[name] = fn;
            }
        }

        bridge[installedFlag] = false;
        bridge[originalSlot] = null;

        return { ok: true, uninstalled: true };
    }

    function isObjectLike(value) {
        return value !== null && (typeof value === "object" || typeof value === "function");
    }

    function getNodeDirect(store, nodeId) {
        if (!store || !nodeId) return null;

        const bridge = window[GLOBAL_KEY];
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
                bridge.__nodeIdDirectIndexSource !== nodes ||
                !(bridge.__nodeIdDirectIndex instanceof Map)
            ) {
                const index = new Map();

                for (let i = 0; i < nodes.length; i += 1) {
                    const candidate = nodes[i];
                    if (candidate?.id) index.set(candidate.id, candidate);
                }

                bridge.__nodeIdDirectIndex = index;
                bridge.__nodeIdDirectIndexSource = nodes;
            }

            node = bridge.__nodeIdDirectIndex.get(nodeId) ?? null;
        } else if (nodes.get) {
            node = nodes.get(nodeId) ?? null;
        } else {
            node = nodes[nodeId] ?? null;
        }

        if (node && bridge?.__nodeIdDirectIndex instanceof Map) {
            bridge.__nodeIdDirectIndex.set(nodeId, node);
        }

        return node;
    }

    const objectToString = Object.prototype.toString;

    function shouldSkipObjectGraphValue(value) {
        const type = typeof value;
        if (value === null || (type !== "object" && type !== "function")) return true;

        try {
            if (
                value instanceof Node ||
                value instanceof Window ||
                value instanceof Document ||
                value instanceof Event ||
                value instanceof EventTarget ||
                value instanceof Animation ||
                value instanceof FontFace ||
                value instanceof ReadableStream ||
                value instanceof WritableStream ||
                value instanceof TransformStream ||
                value instanceof WritableStreamDefaultWriter ||
                value instanceof ViewTransition
            ) {
                return true;
            }
        } catch {}

        const tag = objectToString.call(value);

        return (
            tag.includes("Window") ||
            tag.includes("Document") ||
            tag.includes("Event") ||
            tag.includes("Stream") ||
            tag.includes("Animation") ||
            tag.includes("Transition") ||
            tag.includes("FontFace") ||
            tag.includes("GPU")
        );
    }

    function createCurrentLeafIdReader(store) {
        const currentLeafId = store?.currentLeafId;

        if (typeof currentLeafId === "function") {
            return function readCurrentLeafIdFromFunction() {
                return currentLeafId.call(store);
            };
        }

        return function readCurrentLeafIdFromValue() {
            return currentLeafId;
        };
    }

    function safeCall(value) {
        try {
            return typeof value === "function" ? value() : value;
        } catch {
            return null;
        }
    }

    function getStoreInfo(store) {
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

    const rejectedStores = new WeakSet();
    const rejectedStoreReasons = new Map();

    function hasAnyStoreMethodName(value) {
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

    function looksLikeStore(value) {
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

    function rejectStore(store, reason) {
        const reasonText = String(reason || "unknown");

        // Temporary during page hydration. Do NOT permanently reject this object;
        // it may become the real hydrated store later.
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

    function getStoreNodeCount(store) {
        try {
            const nodes = store.nodes;
            if (nodes instanceof Map) return nodes.size;
            if (Array.isArray(nodes)) return nodes.length;
            if (nodes && typeof nodes === "object") return Object.keys(nodes).length;
        } catch {}

        return 0;
    }

    function validateStoreCandidate(store) {
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

    function getFiberRoots() {
        const roots = [];
        const seenRoots = new WeakSet();

        const pushRoot = (value) => {
            if (!isObjectLike(value)) return;
            if (seenRoots.has(value)) return;

            seenRoots.add(value);
            roots.push(value);
        };

        const rootCandidates = [
            document.querySelector("main"),
            document.querySelector('[role="main"]'),
            document.querySelector('[data-testid="conversation"]'),
            document.querySelector('[data-testid^="conversation-turn-"]')?.closest("main"),
            document.querySelector("#__next"),
            document.body,
        ].filter(Boolean);

        const seenElements = new WeakSet();

        for (const rootEl of rootCandidates) {
            const all = [rootEl, ...rootEl.querySelectorAll("*")];

            for (let i = 0; i < all.length; i += 1) {
                const el = all[i];

                if (!el || el.nodeType !== 1) continue;
                if (seenElements.has(el)) continue;
                seenElements.add(el);

                const keys = Object.keys(el);

                for (let j = 0; j < keys.length; j += 1) {
                    const key = keys[j];

                    if (
                        key.charCodeAt(0) !== 95 ||
                        (
                            !key.startsWith("__reactFiber$") &&
                            !key.startsWith("__reactContainer$") &&
                            !key.startsWith("__reactInternalInstance$")
                        )
                    ) {
                        continue;
                    }

                    pushRoot(el[key]);
                }
            }
        }

        return roots;
    }

    function getGraphKeys(value) {
        const keys = Object.keys(value);

        if (
            keys.length > 0 ||
            value == null ||
            typeof value !== "object"
        ) {
            return keys;
        }

        const proto = Object.getPrototypeOf(value);
        if (!proto || proto === Object.prototype || proto === Array.prototype) {
            return keys;
        }

        return keys.concat(Object.getOwnPropertyNames(proto));
    }

    function scanObjectGraphForStore(root, limits, budget = null) {
        const seen = new WeakSet();
        const queue = [root];
        let visitedObjects = 0;
        const objectBudget = budget ?? { visitedObjects: 0 };
        let bestStore = null;
        let bestNodeCount = -1;

        for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
            const current = queue[queueIndex];

            if (shouldSkipObjectGraphValue(current)) continue;
            if (seen.has(current)) continue;

            seen.add(current);
            visitedObjects += 1;
            objectBudget.visitedObjects += 1;

            if (objectBudget.visitedObjects > limits.maxObjects) break;

            if (hasAnyStoreMethodName(current) && looksLikeStore(current)) {
                const validation = validateStoreCandidate(current);

                if (validation.ok) {
                    const nodeCount = validation.nodeCount ?? getStoreNodeCount(current);

                    if (nodeCount > bestNodeCount) {
                        bestStore = current;
                        bestNodeCount = nodeCount;
                    }

                    continue;
                }

                rejectStore(current, validation.reason);
            }

            let keys;
            try {
                keys = getGraphKeys(current);
            } catch {
                continue;
            }

            const proto = Object.getPrototypeOf(current);

            for (let i = 0; i < keys.length; i += 1) {
                const key = keys[i];

                if (key === "return") continue;

                switch (key) {
                    case "window":
                    case "self":
                    case "globalThis":
                    case "ownerDocument":
                    case "document":
                    case "parentNode":
                    case "parentElement":
                    case "nextSibling":
                    case "previousSibling":
                    case "committed":
                    case "loaded":
                    case "userChoice":
                    case "finished":
                    case "ready":
                    case "lost":
                        continue;
                }

                let child;
                try {
                    const descriptor =
                        Object.getOwnPropertyDescriptor(current, key) ||
                        (proto ? Object.getOwnPropertyDescriptor(proto, key) : null);

                    if (
                        descriptor?.get &&
                        key !== "nodes" &&
                        key !== "rootId" &&
                        key !== "currentLeafId"
                    ) {
                        continue;
                    }

                    child = current[key];
                } catch {
                    continue;
                }

                if (isObjectLike(child)) {
                    queue.push(child);
                }
            }
        }

        return {
            store: bestStore,
            visitedObjects,
        };
    }

    function discoverStoreFromFiberRoot(root, limits) {
        const seenFibers = new WeakSet();
        const fiberQueue = [root];
        const objectBudget = { visitedObjects: 0 };

        let visitedFibers = 0;
        let visitedObjects = 0;
        let bestStore = null;
        let bestNodeCount = -1;

        for (let queueIndex = 0; queueIndex < fiberQueue.length; queueIndex += 1) {
            const fiber = fiberQueue[queueIndex];

            if (!isObjectLike(fiber)) continue;
            if (seenFibers.has(fiber)) continue;

            seenFibers.add(fiber);
            visitedFibers += 1;

            if (visitedFibers > limits.maxFibers) break;

            const candidates = [
                fiber,
                fiber.stateNode,
                fiber.memoizedState,
                fiber.memoizedProps,
                fiber.pendingProps,
                fiber.updateQueue,
                fiber.dependencies,
                fiber.child,
                fiber.sibling,
            ];

            for (let i = 0; i < candidates.length; i += 1) {
                const candidate = candidates[i];
                if (!isObjectLike(candidate)) continue;

                if (hasAnyStoreMethodName(candidate) && looksLikeStore(candidate)) {
                    const validation = validateStoreCandidate(candidate);

                    if (validation.ok) {
                        const nodeCount = validation.nodeCount ?? getStoreNodeCount(candidate);

                        if (nodeCount > bestNodeCount) {
                            bestStore = candidate;
                            bestNodeCount = nodeCount;
                        }

                        continue;
                    }

                    rejectStore(candidate, validation.reason);
                }

                const shouldDeepScan =
                    candidate === fiber.stateNode ||
                    candidate === fiber.memoizedState ||
                    candidate === fiber.memoizedProps ||
                    candidate === fiber.pendingProps ||
                    candidate === fiber.updateQueue ||
                    candidate === fiber.dependencies;

                if (shouldDeepScan) {
                    const scanned = scanObjectGraphForStore(candidate, limits, objectBudget);
                    visitedObjects += scanned.visitedObjects;

                    if (scanned.store) {
                        const nodeCount = getStoreNodeCount(scanned.store);

                        if (nodeCount > bestNodeCount) {
                            bestStore = scanned.store;
                            bestNodeCount = nodeCount;
                        }
                    }

                    if (objectBudget.visitedObjects > limits.maxObjects) {
                        return {
                            store: bestStore,
                            visitedFibers,
                            visitedObjects: objectBudget.visitedObjects,
                        };
                    }
                }
            }

            if (fiber.child) fiberQueue.push(fiber.child);
            if (fiber.sibling) fiberQueue.push(fiber.sibling);
            if (fiber.return) fiberQueue.push(fiber.return);
        }

        return {
            store: bestStore,
            visitedFibers,
            visitedObjects,
        };
    }

    function createEmptyMethodProfile() {
        return {
            calls: 0,
            totalMs: 0,
            maxMs: 0,
            lastMs: 0,
            errors: 0,
            recentArgs: [],
        };
    }

    function normalizeStack(stack) {
        if (!stack || typeof stack !== "string") {
            return "unknown";
        }

        return stack
            .split("\n")
            .slice(2, 8)
            .map((line) =>
                line
                    .trim()
                    .replace(window.location.origin, "")
                    .replace(/:\d+:\d+/g, ":<line>:<col>")
            )
            .join("\n");
    }

    function resolveNodeCore(bridge, id) {
        const store = bridge.__store;
        if (!store || !id) return null;

        const index = bridge.__messageIdIndex;
        const directIndex = bridge.__nodeIdDirectIndex;

        try {
            if (index) {
                const indexedNodeId = index.get(id);

                if (indexedNodeId !== undefined) {
                    const indexedNode =
                        directIndex instanceof Map
                            ? directIndex.get(indexedNodeId)
                            : undefined;

                    if (indexedNode !== undefined) {
                        return indexedNode ?? null;
                    }

                    const node = getNodeDirect(store, indexedNodeId);

                    if (node && directIndex instanceof Map) {
                        directIndex.set(indexedNodeId, node);
                    }

                    return node;
                }
            }

            const resolver = store.messageIdToExistingNodeId;
            if (typeof resolver !== "function") return null;

            const nodeId = resolver.call(store, id);
            if (!nodeId) return null;

            const node = getNodeDirect(store, nodeId);

            if (node) {
                if (index) {
                    index.set(id, nodeId);
                    index.set(nodeId, nodeId);

                    const messageId =
                        node.message?.id ||
                        node.message?.message_id ||
                        node.message?.metadata?.message_id ||
                        null;

                    if (messageId) {
                        index.set(messageId, nodeId);
                    }
                }

                if (directIndex instanceof Map) {
                    directIndex.set(nodeId, node);
                }
            }

            return node || null;
        } catch {
            return null;
        }
    }

    const bridge = {
        __installed: true,
        __version: BRIDGE_VERSION,

        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,
        __found: false,
        __messageIdResolveWarningShown: false,

        __anchorCount: 0,
        __discoveryRuns: 0,
        __visitedFibers: 0,
        __visitedObjects: 0,

        __prunedMessageIds: [],
        __knownPruningEnabled: false,
        __knownPrunedTurnCount: 0,

        __storeReadOptimizationRequested: true,
        __storeReadOptimizationDebug: false,

        __storeProfile: null,
        __storeProfilerInstalled: false,
        __storeProfilerOriginals: null,

        __messageIdIndexInstalled: false,
        __messageIdIndexOriginal: null,
        __messageIdIndex: null,
        __messageIdIndexStats: null,

        __existingNodeFrameCacheInstalled: false,
        __existingNodeFrameCacheOriginal: null,
        __existingNodeFrameCache: null,
        __existingNodeFrameCacheStats: null,
        __existingNodeFrameCacheMode: null,
        __existingNodeFrameCacheApi: null,
        __liveNodeCacheId: null,
        __liveNodeCacheValue: null,
        __liveNodeCacheDirty: true,

        __findNodeFromLeafFrameCacheInstalled: false,
        __findNodeFromLeafFrameCacheOriginal: null,
        __findNodeFromLeafFrameCache: null,
        __findNodeFromLeafFrameCacheStats: null,
        __findNodeFromLeafCacheController: null,

        __getLeafFromNodeFrameCacheInstalled: false,
        __getLeafFromNodeFrameCacheOriginal: null,
        __getLeafFromNodeFrameCache: null,
        __getLeafFromNodeFrameCacheStats: null,

        __branchCacheInstalled: false,
        __branchCacheOriginals: null,
        __branchCache: null,
        __branchCacheStats: null,
        __branchCacheLastInstallResult: null,
        __branchCacheClearScheduled: false,

        __storeValidationFailed: false,

        __branchCallSiteStats: null,
        __branchCallSiteCaptureStacks: false,

        __discoveryInProgress: false,
        __initTiming: {
            installedAt: performance.now(),
            firstDiscoveryStartedAt: null,
            firstDiscoveryCompletedAt: null,
            lastDiscoveryMs: 0,
            lastApplyOptimizationMs: 0,
        },

        __indexRefreshHooksInstalled: false,
        __indexRefreshHookOriginals: null,

        __storePromotionStableCount: 0,
        __storePromotionLocked: false,
        __lastPromotionAttemptAt: 0,
        __promotionTimer: null,

        __nodeIdDirectIndex: null,
        __nodeIdDirectIndexSource: null,
        __confirmedExistingNodeIds: null,

        __prunedMessageIdSet: new Set(),
        __prunedLeafIdSet: new Set(),
        __liveNodeReadFrame: 0,
        __liveNodeCacheFrame: -1,

        __lastLiveFindFrame: -1,
        __lastLiveFindLeafId: null,
        __lastLiveFindPredicateSource: null,
        __lastLiveFindValue: null,

        status() {
            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(this.__store),
                found: this.__found,
                debug: ENABLE_DEBUG,
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                discoveryRuns: this.__discoveryRuns,
                anchorCount: this.__anchorCount,
                visitedFibers: this.__visitedFibers,
                visitedObjects: this.__visitedObjects,
                storeValidationFailed: this.__storeValidationFailed,
                storeProfilerInstalled: this.__storeProfilerInstalled,
                methods: {
                    deleteNode: Boolean(this.__store && typeof this.__store.deleteNode === "function"),
                    getNodeIfExists: Boolean(this.__store && typeof this.__store.getNodeIfExists === "function"),
                    messageIdToExistingNodeId: Boolean(
                        this.__store && typeof this.__store.messageIdToExistingNodeId === "function"
                    ),
                    getBranch: Boolean(this.__store && typeof this.__store.getBranch === "function"),
                    getBranchFromLeaf: Boolean(this.__store && typeof this.__store.getBranchFromLeaf === "function"),
                },
                ...getStoreInfo(this.__store),
            };
        },

        hasStore() {
            return Boolean(this.__store);
        },

        getStore() {
            return this.__store;
        },

        clearStore() {
            this.disableStoreReadOptimization?.({ debug: false });

            this.__store = null;
            this.__registeredAt = null;
            this.__meta = null;
            this.__found = false;
            this.__storeValidationFailed = false;
        },

        resetInstalledStoreEnhancements() {
            this.__storeProfilerInstalled = false;
            this.__storeProfilerOriginals = null;
            this.__storeProfile = null;

            this.__messageIdIndexInstalled = false;
            this.__messageIdIndexOriginal = null;
            this.__messageIdIndex = null;

            this.__existingNodeFrameCacheInstalled = false;
            this.__existingNodeFrameCacheOriginal = null;
            this.__existingNodeFrameCache = null;
            this.__existingNodeFrameCacheStats = null;
            this.__existingNodeFrameCacheMode = null;
            this.__existingNodeFrameCacheApi = null;

            this.__findNodeFromLeafFrameCacheInstalled = false;
            this.__findNodeFromLeafFrameCacheOriginal = null;
            this.__findNodeFromLeafFrameCache = null;
            this.__findNodeFromLeafFrameCacheStats = null;
            this.__findNodeFromLeafCacheController = null;

            this.__getLeafFromNodeFrameCacheInstalled = false;
            this.__getLeafFromNodeFrameCacheOriginal = null;
            this.__getLeafFromNodeFrameCache = null;
            this.__getLeafFromNodeFrameCacheStats = null;

            this.__branchCacheInstalled = false;
            this.__branchCacheOriginals = null;
            this.__branchCache = null;
            this.__branchCacheStats = null;
            this.__branchCacheClearScheduled = false;

            this.__resolvedNodeFrameCacheInstalled = false;
            this.__resolvedNodeFrameCache = null;
            this.__resolvedNodeFrameCacheStats = null;
            this.__resolvedNodeFrameCacheClearScheduled = false;
            this.__resolveNodeFast = null;

            this.__getDisplayTurnsCacheInstalled = false;
            this.__getDisplayTurnsCache = null;
            this.__getDisplayTurnsCacheStats = null;
            this.__getDisplayTurnsCacheOriginal = null;

            this.__indexRefreshHooksInstalled = false;
            this.__indexRefreshHookOriginals = null;

            this.__nodeIdDirectIndex = null;
            this.__nodeIdDirectIndexSource = null;
            this.__confirmedExistingNodeIds = null;

            this.__liveNodeCacheId = null;
            this.__liveNodeCacheValue = null;
            this.__liveNodeCacheDirty = true;

            this.__lastLiveFindFrame = -1;
            this.__lastLiveFindLeafId = null;
            this.__lastLiveFindPredicateSource = null;
            this.__lastLiveFindValue = null;
        },

        registerStore(store, meta = null) {
            const validation = validateStoreCandidate(store);

            if (!validation.ok) {
                rejectStore(store, validation.reason);
                this.__lastError = `registerStore rejected candidate: ${validation.reason}`;
                return false;
            }

            const currentNodeCount = getStoreNodeCount(this.__store);
            const nextNodeCount = validation.nodeCount ?? getStoreNodeCount(store);

            if (this.__store && nextNodeCount < currentNodeCount) {
                console.debug("[thread-optimizer bridge] ignored smaller store candidate", {
                    currentNodeCount,
                    nextNodeCount,
                });
                return false;
            }

            this.disableStoreReadOptimization?.({ debug: false });
            this.resetInstalledStoreEnhancements();
            this.__store = store;

            this.__registeredAt = Date.now();
            this.__lastError = null;
            this.__meta = {
                ...meta,
                validation,
            };
            this.__found = true;
            this.__storeValidationFailed = false;

            console.log("[thread-optimizer bridge] store registered", {
                nodeCount: getStoreNodeCount(this.__store),
                status: this.status(),
            });

            if (this.__storeReadOptimizationRequested) {
                const result = this.applyStoreReadOptimization({
                    debug: this.__storeReadOptimizationDebug,
                    clearStats: true,
                });

                if (this.__storeReadOptimizationDebug) {
                    console.log("[thread-optimizer bridge] re-applied store read optimization after store registration", result);
                }
            }

            return true;
        },

        resolveNodeIdFromMessageId(id) {
            if (!this.__store) {
                this.__lastError = "store not registered";
                return null;
            }

            try {
                const node = this.__resolveNodeFast?.(id);
                this.__lastError = null;
                return node ? node.id ?? null : null;
            } catch (error) {
                this.__lastError = String(error?.message || error);

                // Known ChatGPT internal signal issue. Do not warn repeatedly.
                if (!this.__messageIdResolveWarningShown) {
                    this.__messageIdResolveWarningShown = true;
                    console.debug("[thread-optimizer bridge] messageId resolver fallback unavailable", {
                        error: this.__lastError,
                    });
                }

                return null;
            }
        },

        getNodeByMessageId(id) {
            if (!this.__store) {
                this.__lastError = "store not registered";
                return null;
            }

            try {
                const node = this.__resolveNodeFast?.(id) ?? null;
                this.__lastError = null;
                return node;
            } catch (error) {
                this.__lastError = String(error?.message || error);
                console.warn("[thread-optimizer bridge] getNodeByMessageId failed", error);
                return null;
            }
        },

        inspectMessageById(messageId) {
            const nodeId = this.resolveNodeIdFromMessageId(messageId);
            const node = nodeId ? this.getNodeByMessageId(messageId) : null;

            return {
                messageId,
                nodeId,
                exists: Boolean(node),
                nodeType: node === null ? null : typeof node,
                nodeKeys: node && typeof node === "object"
                    ? Object.keys(node).slice(0, 40)
                    : [],
                node,
            };
        },

        recordPrunedMessageId(messageId) {
            if (typeof messageId !== "string" || messageId.trim() === "") {
                this.__lastError = "record blocked: invalid message id";

                return {
                    recorded: false,
                    reason: this.__lastError,
                    messageId,
                };
            }

            const normalizedMessageId = messageId.trim();

            if (!this.__prunedMessageIds.includes(normalizedMessageId)) {
                this.__prunedMessageIds.push(normalizedMessageId);
            }

            this.__prunedMessageIdSet.add(normalizedMessageId);
            this.__prunedLeafIdSet ??= new Set();

            if (this.__storeValidationFailed || !this.__store) {
                return {
                    recorded: true,
                    resolved: false,
                    reason: this.__storeValidationFailed
                        ? "store validation failed"
                        : "store not registered",
                    messageId: normalizedMessageId,
                    count: this.__prunedMessageIds.length,
                };
            }

            const node = getNodeDirect(this.__store, normalizedMessageId);

            if (node?.id) {
                this.__prunedMessageIdSet.add(node.id);

                try {
                    const leaf = this.__store.getLeafFromNode?.(node.id);
                    const leafId = typeof leaf === "string" ? leaf : leaf?.id ?? null;

                    if (leafId) {
                        this.__prunedLeafIdSet.add(leafId);
                    }
                } catch {}
            }

            const inspection = this.inspectMessageById(normalizedMessageId);

            if (inspection.nodeId) {
                this.__prunedMessageIdSet.add(inspection.nodeId);
            }

            return {
                recorded: true,
                resolved: Boolean(inspection.nodeId && inspection.exists),
                messageId: normalizedMessageId,
                nodeId: inspection.nodeId,
                count: this.__prunedMessageIds.length,
                inspection,
            };
        },

        setKnownPruningState({ enabled, prunedTurnCount } = {}) {
            this.__knownPruningEnabled = Boolean(enabled);

            if (Number.isFinite(prunedTurnCount) && prunedTurnCount >= 0) {
                this.__knownPrunedTurnCount = prunedTurnCount;
            }

            return {
                ok: true,
                enabled: this.__knownPruningEnabled,
                prunedTurnCount: this.__knownPrunedTurnCount,
                visibleTurnCount: getVisibleConversationTurnCount(),
                estimatedTurnCount: getEstimatedConversationTurnCount(),
                minimumNodeCount: getExpectedMinimumStoreNodeCount(),
            };
        },

        getPrunedMessageIds() {
            return [...this.__prunedMessageIds];
        },

        clearPrunedMessageIds() {
            this.__prunedMessageIds = [];
            this.__lastError = null;
            this.__prunedMessageIdSet.clear();
            this.__prunedLeafIdSet.clear();
            return true;
        },

        discoverNow() {
            if (this.__discoveryInProgress) {
                return false;
            }

            this.__discoveryInProgress = true;

            const startedAt = performance.now();

            if (this.__initTiming.firstDiscoveryStartedAt == null) {
                this.__initTiming.firstDiscoveryStartedAt = startedAt;
            }

            try {
                this.__discoveryRuns += 1;

                const roots = getFiberRoots();
                this.__anchorCount = roots.length;

                const discoveryRun = this.__discoveryRuns;
                const limits = {
                    maxFibers: MAX_FIBERS,
                    maxObjects: MAX_OBJECTS,
                    maxRoots: 200,
                };

                let totalVisitedFibers = 0;
                let totalVisitedObjects = 0;

                for (let i = 0; i < Math.min(roots.length, limits.maxRoots); i += 1) {
                    const result = discoverStoreFromFiberRoot(roots[i], limits);

                    totalVisitedFibers += result.visitedFibers;
                    totalVisitedObjects += result.visitedObjects;

                    if (result.store) {
                        this.__visitedFibers = totalVisitedFibers;
                        this.__visitedObjects = totalVisitedObjects;

                        return this.registerStore(result.store, {
                            source: "react-fiber-scan",
                            discoveryRun,
                            limits,
                        });
                    }
                }

                this.__visitedFibers = totalVisitedFibers;
                this.__visitedObjects = totalVisitedObjects;

                return false;
            } finally {
                const elapsed = performance.now() - startedAt;

                this.__discoveryInProgress = false;
                this.__initTiming.lastDiscoveryMs = elapsed;
                this.__initTiming.firstDiscoveryCompletedAt ??= performance.now();

                if (this.__found || this.__discoveryRuns === 1 || this.__discoveryRuns % 5 === 0) {
                    console.log(DISCOVERY_LOG_PREFIX, "discovery completed", {
                        found: this.__found,
                        elapsedMs: Math.round(elapsed * 10) / 10,
                        discoveryRuns: this.__discoveryRuns,
                        anchorCount: this.__anchorCount,
                        visitedFibers: this.__visitedFibers,
                        visitedObjects: this.__visitedObjects,
                    });
                }
            }
        },

        retryDiscovery() {
            this.clearStore();
            this.__lastError = null;
            return this.discoverNow();
        },

        promoteStoreDiscovery() {
            // Match the manual fix that works: detach the root-only store first,
            // then rediscover against the hydrated page.
            this.clearStore();
            this.__lastError = null;

            window.setTimeout(() => {
                this.discoverNow();
            }, 0);

            return true;
        },

        maybePromoteStore(reason = "unknown") {
            if (this.__storePromotionLocked) return true;

            const currentNodeCount = getStoreNodeCount(this.__store);

            if (currentNodeCount > 1) {
                this.__storePromotionLocked = true;

                if (this.__promotionTimer) {
                    clearInterval(this.__promotionTimer);
                    this.__promotionTimer = null;
                }

                return true;
            }

            // Never lock onto the bootstrap/root-only store.
            // Keep trying lightweight promotion until a real hydrated store appears.
            if (this.__store && currentNodeCount <= 1) {
                const now = Date.now();

                // Give ChatGPT time to hydrate the real conversation store before rescanning.
                if (performance.now() - this.__initTiming.installedAt < PROMOTION_INITIAL_DELAY_MS) {
                    return false;
                }

                if (now - this.__lastPromotionAttemptAt < PROMOTION_INTERVAL_MS) return false;

                this.__lastPromotionAttemptAt = now;
                this.promoteStoreDiscovery();
                return true;
            }

            if (this.__store && isStoreGoodEnough(this.__store)) {
                this.__storePromotionStableCount += 1;

                if (this.__storePromotionStableCount >= 3) {
                    this.__storePromotionLocked = true;
                    if (this.__promotionTimer) clearInterval(this.__promotionTimer);
                    this.__promotionTimer = null;
                }

                return true;
            }

            const now = Date.now();
            if (now - this.__lastPromotionAttemptAt < 3000) return false;

            this.__lastPromotionAttemptAt = now;
            this.promoteStoreDiscovery();
            return true;
        },

        startDiscoveryLoop() {
            let attempts = 0;

            const tick = () => {
                attempts += 1;

                try {
                    if (!this.__store) {
                        this.retryDiscovery();
                    }
                } catch (error) {
                    this.__lastError = String(error?.message || error);
                    console.debug("[thread-optimizer bridge] discovery loop failed", error);
                }

                if (this.__store) {
                    console.log(DISCOVERY_LOG_PREFIX, "startup completed", this.getInitTiming());

                    if (!this.__promotionTimer) {
                        this.__promotionTimer = window.setInterval(() => {
                            this.maybePromoteStore("startup-promotion");
                        }, PROMOTION_INTERVAL_MS);
                    }

                    return;
                }

                if (attempts >= MAX_DISCOVERY_RUNS) return;

                window.setTimeout(tick, DISCOVERY_RETRY_MS);
            };

            tick();
        },

        installStoreProfiler() {
            if (!this.__store) {
                return {
                    ok: false,
                    reason: "store not registered",
                };
            }

            if (this.__storeProfilerInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    profile: this.getStoreProfile(),
                };
            }

            const EXCLUDED_PROFILE_METHODS = new Set([
                "constructor",
            ]);

            const methodNames = Array.from(
                new Set([
                    ...Object.keys(this.__store),
                    ...Object.getOwnPropertyNames(Object.getPrototypeOf(this.__store) || {}),
                ])
            ).filter((methodName) => {
                if (EXCLUDED_PROFILE_METHODS.has(methodName)) return false;
                return typeof this.__store[methodName] === "function";
            });

            this.__storeProfile = {
                installedAt: Date.now(),
                clearedAt: null,
                methods: {},
            };

            this.__storeProfilerOriginals = {};

            for (const methodName of methodNames) {
                const original = this.__store[methodName];

                if (typeof original !== "function") continue;

                this.__storeProfile.methods[methodName] = createEmptyMethodProfile();
                this.__storeProfilerOriginals[methodName] = original;

                const bridgeRef = this;

                this.__store[methodName] = function profiledStoreMethod(...args) {
                    const startedAt = performance.now();

                    try {
                        return original.apply(bridgeRef.__store, args);
                    } catch (error) {
                        const methodProfile = bridgeRef.__storeProfile?.methods?.[methodName];
                        if (methodProfile) methodProfile.errors += 1;
                        throw error;
                    } finally {
                        const elapsed = performance.now() - startedAt;
                        const methodProfile = bridgeRef.__storeProfile?.methods?.[methodName];

                        if (methodProfile) {
                            methodProfile.calls += 1;
                            methodProfile.totalMs += elapsed;
                            methodProfile.lastMs = elapsed;
                            methodProfile.maxMs = Math.max(methodProfile.maxMs, elapsed);

                            methodProfile.recentArgs.push(
                                args.map((arg) => {
                                    if (
                                        typeof arg === "string" ||
                                        typeof arg === "number" ||
                                        typeof arg === "boolean" ||
                                        arg === null
                                    ) {
                                        return arg;
                                    }

                                    return typeof arg;
                                })
                            );

                            if (methodProfile.recentArgs.length > 20) {
                                methodProfile.recentArgs.shift();
                            }
                        }
                    }
                };
            }

            this.__storeProfilerInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: Object.keys(this.__storeProfile.methods),
            };
        },

        uninstallStoreProfiler() {
            if (!this.__storeProfilerInstalled || !this.__storeProfilerOriginals) {
                return {
                    ok: true,
                    alreadyUninstalled: true,
                };
            }

            if (this.__store) {
                for (const [methodName, original] of Object.entries(this.__storeProfilerOriginals)) {
                    this.__store[methodName] = original;
                }
            }

            this.__storeProfilerInstalled = false;
            this.__storeProfilerOriginals = null;

            return {
                ok: true,
                uninstalled: true,
            };
        },

        clearStoreProfile() {
            if (!this.__storeProfile) {
                return {
                    ok: true,
                    cleared: false,
                    reason: "profiler not installed",
                };
            }

            for (const methodProfile of Object.values(this.__storeProfile.methods)) {
                methodProfile.calls = 0;
                methodProfile.totalMs = 0;
                methodProfile.maxMs = 0;
                methodProfile.lastMs = 0;
                methodProfile.errors = 0;
                methodProfile.recentArgs = [];
            }

            this.__storeProfile.clearedAt = Date.now();

            return {
                ok: true,
                cleared: true,
            };
        },

        getStoreProfile() {
            if (!this.__storeProfile) {
                return {
                    installed: false,
                    reason: "profiler not installed",
                };
            }

            const methods = {};

            for (const [methodName, profile] of Object.entries(this.__storeProfile.methods)) {
                methods[methodName] = {
                    ...profile,
                    avgMs: profile.calls > 0 ? profile.totalMs / profile.calls : 0,
                };
            }

            const topByCalls = Object.entries(methods)
                .map(([methodName, profile]) => ({ methodName, ...profile }))
                .sort((a, b) => b.calls - a.calls)
                .slice(0, 30);

            const topByTotalMs = Object.entries(methods)
                .map(([methodName, profile]) => ({ methodName, ...profile }))
                .sort((a, b) => b.totalMs - a.totalMs)
                .slice(0, 30);

            return {
                installed: this.__storeProfilerInstalled,
                installedAt: this.__storeProfile.installedAt,
                clearedAt: this.__storeProfile.clearedAt ?? null,
                methods,
                topByCalls,
                topByTotalMs,
            };
        },

        buildMessageIdIndex() {
            if (!this.__store) {
                return {
                    ok: false,
                    reason: "store not registered",
                };
            }

            const index = new Map();
            const nodesValue = this.__store.nodes;

            const addNode = (node) => {
                if (!node || typeof node !== "object") return;

                const nodeId = node.id;
                if (!nodeId) return;

                index.set(nodeId, nodeId);

                const messageId =
                    node.message?.id ||
                    node.message?.message_id ||
                    node.message?.metadata?.message_id ||
                    null;

                if (messageId) {
                    index.set(messageId, nodeId);
                }
            };

            if (nodesValue instanceof Map) {
                for (const node of nodesValue.values()) addNode(node);
            } else if (Array.isArray(nodesValue)) {
                for (const node of nodesValue) addNode(node);
            } else if (nodesValue && typeof nodesValue === "object") {
                for (const node of Object.values(nodesValue)) addNode(node);
            }

            this.__messageIdIndex = index;

            if (!this.__messageIdIndexStats) {
                this.__messageIdIndexStats = {
                    hits: 0,
                    misses: 0,
                    fallbackHits: 0,
                    rebuilds: 0,
                    lastRebuiltAt: null,
                    missSinceRebuild: 0,
                    rebuildSkips: 0,
                };
            }

            this.__messageIdIndexStats.rebuilds += 1;
            this.__messageIdIndexStats.lastRebuiltAt = Date.now();

            return {
                ok: true,
                size: index.size,
                rebuilds: this.__messageIdIndexStats.rebuilds,
            };
        },

        installMessageIdIndex({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) {
                return {
                    ok: false,
                    reason: "store not registered",
                };
            }

            if (this.__messageIdIndexInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.getMessageIdIndexStats(),
                };
            }

            const buildResult = this.buildMessageIdIndex();
            if (!buildResult.ok) return buildResult;

            const original = this.__store.messageIdToExistingNodeId;

            if (typeof original !== "function") {
                return {
                    ok: false,
                    reason: "messageIdToExistingNodeId is not a function",
                };
            }

            this.__messageIdIndexOriginal = original;

            const bridgeRef = this;

            if (profiled) {
                this.__store.messageIdToExistingNodeId = function indexedMessageIdToExistingNodeIdProfiled(messageId) {
                    const index = bridgeRef.__messageIdIndex;
                    const stats = bridgeRef.__messageIdIndexStats;

                    if (index) {
                        const indexed = index.get(messageId);

                        if (indexed !== undefined) {
                            stats.hits += 1;
                            return indexed;
                        }
                    }

                    stats.missSinceRebuild += 1;

                    if (stats.missSinceRebuild >= 150) {
                        stats.missSinceRebuild = 0;

                        bridgeRef.maybeRebuildMessageIdIndex({
                            minIntervalMs: 1000,
                        });

                        const rebuiltIndex = bridgeRef.__messageIdIndex;
                        const rebuilt = rebuiltIndex?.get(messageId);

                        if (rebuilt !== undefined) {
                            stats.hits += 1;
                            return rebuilt;
                        }
                    } else {
                        stats.rebuildSkips += 1;
                    }

                    stats.misses += 1;

                    const result = original.call(bridgeRef.__store, messageId);

                    if (result) {
                        stats.fallbackHits += 1;
                        bridgeRef.__messageIdIndex?.set(messageId, result);
                    }

                    return result ?? null;
                };
            } else {
                const store = this.__store;
                const getIndex = () => bridgeRef.__messageIdIndex;
                const maybeRebuildMessageIdIndex = bridgeRef.maybeRebuildMessageIdIndex;
                let missSinceRebuild = 0;

                store.messageIdToExistingNodeId = function indexedMessageIdToExistingNodeIdProduction(messageId) {
                    const index = getIndex();

                    if (index) {
                        const indexed = index.get(messageId);
                        if (indexed !== undefined) return indexed;
                    }

                    missSinceRebuild += 1;

                    if (missSinceRebuild >= 150) {
                        missSinceRebuild = 0;

                        maybeRebuildMessageIdIndex.call(bridgeRef, {
                            minIntervalMs: 1000,
                        });

                        const rebuilt = getIndex()?.get(messageId);
                        if (rebuilt !== undefined) return rebuilt;
                    }

                    const result = original.call(store, messageId);

                    if (result) {
                        getIndex()?.set(messageId, result);
                    }

                    return result ?? null;
                };
            }

            this.__messageIdIndexInstalled = true;

            return {
                ok: true,
                installed: true,
                indexSize: this.__messageIdIndex.size,
                profiled,
            };
        },

        uninstallMessageIdIndex() {
            if (!this.__messageIdIndexInstalled) {
                return {
                    ok: true,
                    alreadyUninstalled: true,
                };
            }

            if (this.__store && this.__messageIdIndexOriginal) {
                this.__store.messageIdToExistingNodeId = this.__messageIdIndexOriginal;
            }

            this.__messageIdIndexInstalled = false;
            this.__messageIdIndexOriginal = null;

            return {
                ok: true,
                uninstalled: true,
            };
        },

        getMessageIdIndexStats() {
            return {
                installed: this.__messageIdIndexInstalled,
                size: this.__messageIdIndex?.size ?? 0,
                stats: this.__messageIdIndexStats,
            };
        },

        __nodeReadProfile: null,

        startNodeReadProfile() {
            this.__nodeReadProfile = {
                startedAt: Date.now(),
                total: 0,
                currentLeaf: 0,
                inProgress: 0,
                pruned: 0,
                other: 0,
                byId: new Map(),
            };

            return { ok: true };
        },

        recordNodeReadProfile(id, result) {
            const profile = this.__nodeReadProfile;
            if (!profile) return;

            profile.total += 1;

            const store = this.__store;
            const leafId =
                typeof store?.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store?.currentLeafId;

            const isCurrentLeaf = id === leafId;
            const isInProgress = result?.message?.status === "in_progress";
            const isPruned = this.__prunedMessageIdSet?.has(id);

            if (isCurrentLeaf) profile.currentLeaf += 1;
            else if (isInProgress) profile.inProgress += 1;
            else if (isPruned) profile.pruned += 1;
            else profile.other += 1;

            const entry = profile.byId.get(id) || {
                id,
                calls: 0,
                currentLeaf: false,
                inProgress: false,
                pruned: false,
                role: null,
                status: null,
            };

            entry.calls += 1;
            entry.currentLeaf ||= isCurrentLeaf;
            entry.inProgress ||= isInProgress;
            entry.pruned ||= isPruned;
            entry.role ||= result?.message?.author?.role ?? null;
            entry.status ||= result?.message?.status ?? null;

            profile.byId.set(id, entry);
        },

        getNodeReadProfile() {
            const profile = this.__nodeReadProfile;
            if (!profile) return { ok: false, reason: "profile not started" };

            const topIds = Array.from(profile.byId.values())
                .sort((a, b) => b.calls - a.calls)
                .slice(0, 30);

            return {
                ok: true,
                elapsedMs: Date.now() - profile.startedAt,
                total: profile.total,
                currentLeaf: profile.currentLeaf,
                inProgress: profile.inProgress,
                pruned: profile.pruned,
                other: profile.other,
                topIds,
            };
        },

        stopNodeReadProfile() {
            const result = this.getNodeReadProfile();
            this.__nodeReadProfile = null;
            return result;
        },

        installLiveGetNodeIfExistsWrapper(original, cacheApi) {
            const store = this.__store;
            const get = cacheApi.get;
            const set = cacheApi.set;

            this.__store.getNodeIfExists = function cachedGetNodeIfExistsLive(id) {
                const cached = get(id);
                if (cached !== undefined) return cached;

                const result = original.call(store, id);
                if (result && result.message.status !== "in_progress") {
                    set(id, result);
                }

                return result ?? null;
            };

            this.__existingNodeFrameCacheMode = "live";
        },

        installLiveGetNodeIfExistsWrapperProfiled(original, cacheApi) {
            const bridgeRef = this;
            const stats = this.__existingNodeFrameCacheStats;
            const store = this.__store;
            const getCurrentLeafId = createCurrentLeafIdReader(store);
            const get = cacheApi.get;
            const set = cacheApi.set;

            this.__store.getNodeIfExists = function cachedGetNodeIfExistsLiveProfiled(id) {
                if (ENABLE_NODE_CALLSITE_STATS) {
                    bridgeRef.__nodeCallSiteStats ??= {
                        total: 0,
                        callSites: {},
                        max: 50,
                    };

                    const stats = bridgeRef.__nodeCallSiteStats;

                    stats.total += 1;

                    const stack = normalizeStack(new Error().stack);

                    const existing = stats.callSites[stack];

                    if (existing) {
                        existing.calls += 1;
                        existing.lastId = id;
                    } else {
                        const keys = Object.keys(stats.callSites);

                        if (keys.length >= stats.max) {
                            const lowest = keys.reduce((a, b) =>
                                stats.callSites[a].calls < stats.callSites[b].calls ? a : b
                            );
                            delete stats.callSites[lowest];
                        }

                        stats.callSites[stack] = {
                            calls: 1,
                            firstId: id,
                            lastId: id,
                        };
                    }
                }
                const leafId = getCurrentLeafId();
                const frame = bridgeRef.__liveNodeReadFrame || 0;

                // 🔴 ACTIVE LEAF
                if (id === leafId) {
                    if (
                        bridgeRef.__liveNodeCacheId === id &&
                        bridgeRef.__liveNodeCacheFrame === frame
                    ) {
                        stats.activeCached += 1;
                        return bridgeRef.__liveNodeCacheValue;
                    }

                    stats.activeOriginal += 1;

                    const result = original.call(store, id) ?? null;

                    bridgeRef.__liveNodeCacheId = id;
                    bridgeRef.__liveNodeCacheValue = result;
                    bridgeRef.__liveNodeCacheFrame = frame;

                    return result;
                }

                // 🟢 NORMAL PATH
                const cached = get(id);
                if (cached !== undefined) {
                    stats.normalCached += 1;
                    return cached;
                }

                stats.normalOriginal += 1;

                const result = original.call(store, id) ?? null;

                if (result?.message?.status !== "in_progress" && result != null) {
                    set(id, result);
                }

                return result;
            };

            this.__existingNodeFrameCacheMode = "live";
        },

        enableLiveNodeCachePolicy() {
            if (this.__existingNodeFrameCacheMode === "live") {
                return { ok: true, alreadyLive: true };
            }

            const original = this.__existingNodeFrameCacheOriginal?.getNodeIfExists;
            const cacheApi = this.__existingNodeFrameCacheApi;

            if (!this.__store || typeof original !== "function" || !cacheApi) {
                return { ok: false, reason: "node cache not installed" };
            }

            if (ENABLE_CACHE_PROFILING) {
                this.installLiveGetNodeIfExistsWrapperProfiled(original, cacheApi);
            } else {
                this.installLiveGetNodeIfExistsWrapper(original, cacheApi);
            }

            return { ok: true, mode: "live" };
        },

        prewarmExistingNodeFrameCache(cacheApi) {
            const nodes = this.__store?.nodes;
            if (!nodes) return { ok: false, reason: "nodes unavailable" };

            const add = (node) => {
                if (
                    node?.id &&
                    node.message?.status !== "in_progress"
                ) {
                    cacheApi.set(node.id, node);
                }
            };

            if (nodes instanceof Map) {
                for (const node of nodes.values()) add(node);
            } else if (Array.isArray(nodes)) {
                for (const node of nodes) add(node);
            } else if (typeof nodes === "object") {
                for (const node of Object.values(nodes)) add(node);
            }

            return {
                ok: true,
                size: cacheApi.cache?.size ?? null,
            };
        },

        installExistingNodeFrameCache({
            maxSize = DEFAULT_CACHE_MAX_SIZE,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) return { ok: false, reason: "store not registered" };

            if (this.__existingNodeFrameCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__existingNodeFrameCacheStats,
                };
            }

            const original = this.__store.getNodeIfExists;
            if (typeof original !== "function") {
                return { ok: false, reason: "getNodeIfExists unavailable" };
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    hintHits: 0,
                    hintConfirmed: 0,
                    confirmedFastHits: 0,
                    fallbackHits: 0,
                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    activeOriginal: 0,
                    activeCached: 0,
                    normalOriginal: 0,
                    normalCached: 0,
                    maxSize,
                    mode: "profiled:persistent+confirmed-direct-index",
                    lastClearReason: null,
                }
                : {
                    cached: 0,
                    evictions: 0,
                    maxSize,
                    mode: "production:persistent+confirmed-direct-index",
                    lastClearReason: null,
                };

            const frameCache = createPersistentCache({
                maxSize,
                stats,
                profiled,
            });

            this.__confirmedExistingNodeIds ??= new Set();
            this.__existingNodeFrameCacheApi = frameCache;
            this.__existingNodeFrameCache = frameCache.cache;
            this.__existingNodeFrameCacheStats = stats;
            this.__existingNodeFrameCacheOriginal = { getNodeIfExists: original };

            const bridgeRef = this;
            const store = this.__store;
            const directIndex = this.__nodeIdDirectIndex;
            const confirmedExistingNodeIds = this.__confirmedExistingNodeIds;

            if (profiled) {
                this.__store.getNodeIfExists = function cachedGetNodeIfExistsProfiled(id) {
                    const cached = frameCache.get(id);
                    if (cached !== undefined) return cached;

                    const hinted =
                        directIndex instanceof Map
                            ? directIndex.get(id)
                            : undefined;

                    if (
                        hinted !== undefined &&
                        confirmedExistingNodeIds.has(id)
                    ) {
                        stats.confirmedFastHits += 1;
                        frameCache.set(id, hinted);
                        return hinted;
                    }

                    const result = original.call(store, id);

                    if (hinted !== undefined) {
                        stats.hintHits += 1;

                        if (result === hinted) {
                            stats.hintConfirmed += 1;
                            confirmedExistingNodeIds.add(id);
                        }
                    }

                    if (result != null) {
                        stats.fallbackHits += 1;
                        frameCache.set(id, result);

                        if (result.id && directIndex instanceof Map) {
                            directIndex.set(result.id, result);
                        }
                    }

                    return result ?? null;
                };
            } else {
                this.prewarmExistingNodeFrameCache?.(frameCache);
                this.installLiveGetNodeIfExistsWrapper(original, frameCache);
            }

            this.__existingNodeFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: ["getNodeIfExists"],
                profiled,
            };
        },

        uninstallExistingNodeFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__existingNodeFrameCacheOriginal",
                installedFlag: "__existingNodeFrameCacheInstalled",
            });
        },

        getExistingNodeFrameCacheStats() {
            return {
                installed: Boolean(this.__existingNodeFrameCacheInstalled),
                size: this.__existingNodeFrameCache?.size ?? 0,
                stats: this.__existingNodeFrameCacheStats ?? null,
            };
        },

        installFindNodeFromLeafFrameCache({
            maxSize = 10000,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) {
                return { ok: false, reason: "store not registered" };
            }

            if (this.__findNodeFromLeafFrameCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__findNodeFromLeafFrameCacheStats,
                };
            }

            const original = this.__store.findNodeFromLeaf;
            if (typeof original !== "function") {
                return { ok: false, reason: "findNodeFromLeaf unavailable" };
            }

            const stats = profiled
                ? {
                    calls: 0,
                    misses: 0,
                    fallbackCalls: 0,

                    sourceKeyMisses: 0,
                    sourceKeyMismatches: 0,
                    sourceKeyFastHits: 0,
                    sourceKeyTrusted: 0,

                    liveHits: 0,
                    liveMisses: 0,
                    normalHits: 0,
                    normalMisses: 0,

                    __liveFindFrame: -1,
                    __liveFindLeafId: null,
                    __liveFindCache: null,

                    cached: 0,
                    evictions: 0,
                    maxSize,
                    mode: "profiled:predicate-source+leaf-nested-confirmed-fast-path",
                    lastClearReason: null,
                }
                : {
                    cached: 0,
                    evictions: 0,
                    maxSize,
                    mode: "production:predicate-source+leaf-nested-confirmed-fast-path",
                    lastClearReason: null,
                };

            const sourceCache = new Map();
            const insertionOrder = [];
            const predicateSourceByFn = new WeakMap();

            function getPredicateSource(predicateFn) {
                let source = predicateSourceByFn.get(predicateFn);

                if (source === undefined) {
                    source = String(predicateFn).slice(0, 500);
                    predicateSourceByFn.set(predicateFn, source);
                }

                return source;
            }

            const bridgeRef = this;
            const store = this.__store;
            const getCurrentLeafId = createCurrentLeafIdReader(store);

            this.__findNodeFromLeafFrameCache = sourceCache;
            this.__findNodeFromLeafFrameCacheStats = stats;
            this.__findNodeFromLeafFrameCacheOriginal = { findNodeFromLeaf: original };

            if (profiled) {
                this.__store.findNodeFromLeaf = function cachedFindNodeFromLeafProfiled(predicateFn, ...rest) {
                    stats.calls += 1;

                    const leafId = rest[0];

                    if (typeof predicateFn !== "function" || !leafId) {
                        stats.fallbackCalls += 1;
                        return original.call(store, predicateFn, ...rest);
                    }

                    const predicateSource = getPredicateSource(predicateFn);
                    const currentLeafId = getCurrentLeafId();

                    if (leafId === currentLeafId) {
                        const frame = bridgeRef.__liveNodeReadFrame || 0;

                        if (
                            bridgeRef.__liveFindFrame !== frame ||
                            bridgeRef.__liveFindLeafId !== leafId
                        ) {
                            bridgeRef.__liveFindFrame = frame;
                            bridgeRef.__liveFindLeafId = leafId;
                            bridgeRef.__liveFindCache = new Map();
                        }

                        const liveCache = bridgeRef.__liveFindCache;
                        const cached = liveCache.get(predicateSource);

                        if (cached !== undefined) {
                            stats.sourceKeyFastHits += 1;
                            stats.liveHits += 1;
                            return cached === CACHE_MISS ? null : cached;
                        }

                        stats.sourceKeyMisses += 1;
                        stats.misses += 1;
                        stats.liveMisses += 1;

                        const result = original.call(store, predicateFn, ...rest);
                        liveCache.set(predicateSource, result ?? CACHE_MISS);
                        return result ?? null;
                    }

                    const key = leafId + "|" + predicateSource;

                    const cached = sourceCache.get(key);
                    if (cached !== undefined) {
                        stats.sourceKeyFastHits += 1;
                        stats.normalHits += 1;
                        return cached === CACHE_MISS ? null : cached;
                    }

                    stats.sourceKeyMisses += 1;
                    stats.misses += 1;
                    stats.normalMisses += 1;

                    const result = original.call(store, predicateFn, ...rest);
                    const cachedResult = result ?? CACHE_MISS;

                    sourceCache.set(key, cachedResult);
                    insertionOrder.push(key);
                    stats.cached += 1;

                    if (stats.cached > maxSize) {
                        const oldest = insertionOrder.shift();
                        if (oldest !== undefined && sourceCache.delete(oldest)) {
                            stats.cached -= 1;
                            stats.evictions += 1;
                        }
                    }

                    return result ?? null;
                };
            } else {
                let cachedCount = 0;

                this.__store.findNodeFromLeaf = function cachedFindNodeFromLeafProduction(predicateFn, ...rest) {
                    const leafId = rest[0];

                    if (typeof predicateFn !== "function" || !leafId) {
                        return original.call(store, predicateFn, ...rest);
                    }

                    const predicateSource = getPredicateSource(predicateFn);
                    const currentLeafId = getCurrentLeafId();

                    if (leafId === currentLeafId) {
                        const frame = bridgeRef.__liveNodeReadFrame || 0;

                        if (
                            bridgeRef.__liveFindFrame !== frame ||
                            bridgeRef.__liveFindLeafId !== leafId
                        ) {
                            bridgeRef.__liveFindFrame = frame;
                            bridgeRef.__liveFindLeafId = leafId;
                            bridgeRef.__liveFindCache = new Map();
                        }

                        const liveCache = bridgeRef.__liveFindCache;
                        const cached = liveCache.get(predicateSource);

                        if (cached !== undefined) {
                            return cached === CACHE_MISS ? null : cached;
                        }

                        const result = original.call(store, predicateFn, ...rest);
                        liveCache.set(predicateSource, result ?? CACHE_MISS);
                        return result ?? null;
                    }

                    const key = leafId + "|" + predicateSource;

                    const cached = sourceCache.get(key);
                    if (cached !== undefined) {
                        return cached === CACHE_MISS ? null : cached;
                    }

                    const result = original.call(store, predicateFn, ...rest);

                    sourceCache.set(key, result ?? CACHE_MISS);
                    insertionOrder.push(key);
                    cachedCount += 1;

                    if (cachedCount > maxSize) {
                        const oldest = insertionOrder.shift();
                        if (oldest !== undefined && sourceCache.delete(oldest)) {
                            cachedCount -= 1;
                        }
                    }

                    return result ?? null;
                };
            }

            this.__findNodeFromLeafFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: ["findNodeFromLeaf"],
                profiled,
            };
        },

        uninstallFindNodeFromLeafFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__findNodeFromLeafFrameCacheOriginal",
                installedFlag: "__findNodeFromLeafFrameCacheInstalled",
            });
        },

        getFindNodeFromLeafFrameCacheStats() {
            return {
                installed: Boolean(this.__findNodeFromLeafFrameCacheInstalled),
                size: this.__findNodeFromLeafFrameCache?.size ?? 0,
                stats: this.__findNodeFromLeafFrameCacheStats ?? null,
            };
        },

        installGetLeafFromNodeFrameCache({
            maxSize = DEFAULT_CACHE_MAX_SIZE,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) {
                return { ok: false, reason: "store not registered" };
            }

            if (this.__getLeafFromNodeFrameCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__getLeafFromNodeFrameCacheStats,
                };
            }

            const original = this.__store.getLeafFromNode;
            if (typeof original !== "function") {
                return { ok: false, reason: "getLeafFromNode unavailable" };
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    maxSize,
                    mode: "profiled:persistent",
                    lastClearReason: null,
                }
                : {
                    maxSize,
                    mode: "production:persistent",
                    lastClearReason: null,
                };

            const frameCache = createPersistentCache({
                maxSize,
                stats,
                profiled,
            });

            this.__getLeafFromNodeFrameCache = frameCache.cache;
            this.__getLeafFromNodeFrameCacheStats = stats;
            this.__getLeafFromNodeFrameCacheOriginal = { getLeafFromNode: original };

            const store = this.__store;
            const get = frameCache.get;
            const set = frameCache.set;

            store.getLeafFromNode = function cachedGetLeafFromNode(id) {
                const key =
                    typeof id === "string" ||
                    typeof id === "number" ||
                    typeof id === "boolean" ||
                    id == null
                        ? id
                        : id.id ?? id.nodeId ?? id.message?.id ?? id;

                const cached = get(key);
                if (cached !== undefined) return cached;

                const result = original.call(store, id);

                set(key, result ?? null);
                return result ?? null;
            };

            this.__getLeafFromNodeFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: ["getLeafFromNode"],
                profiled,
            };
        },
        uninstallGetLeafFromNodeFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__getLeafFromNodeFrameCacheOriginal",
                installedFlag: "__getLeafFromNodeFrameCacheInstalled",
            });
        },

        getGetLeafFromNodeFrameCacheStats() {
            return {
                installed: Boolean(this.__getLeafFromNodeFrameCacheInstalled),
                size: this.__getLeafFromNodeFrameCache?.size ?? 0,
                stats: this.__getLeafFromNodeFrameCacheStats ?? null,
            };
        },

        recordBranchCallSite(methodName, args) {
            if (!ENABLE_BRANCH_CALLSITE_STATS) return;
            const stats = this.__branchCallSiteStats ??= {
                installed: true,
                totalCalls: 0,
                methods: {},
                callSites: {},
                maxCallSites: 80,
            };

            stats.totalCalls += 1;
            stats.methods[methodName] = (stats.methods[methodName] || 0) + 1;

            let stackKey = "stack capture disabled";

            if (ENABLE_BRANCH_CALLSITE_STATS && this.__branchCallSiteCaptureStacks) {
                stackKey = normalizeStack(new Error().stack);
            }

            const firstArg = args[0];

            const argSummary = {
                firstArg:
                    typeof firstArg === "string" ||
                    typeof firstArg === "number" ||
                    typeof firstArg === "boolean" ||
                    firstArg == null
                        ? firstArg
                        : typeof firstArg,
                argCount: args.length,
            };

            const existing = stats.callSites[stackKey];

            if (existing) {
                existing.calls += 1;
                existing.methods[methodName] = (existing.methods[methodName] || 0) + 1;
                existing.lastArgs = argSummary;
                existing.lastSeenAt = Date.now();
                return;
            }

            const keys = Object.keys(stats.callSites);

            if (keys.length >= stats.maxCallSites) {
                const lowestKey = keys.reduce((lowest, key) => {
                    return stats.callSites[key].calls < stats.callSites[lowest].calls
                        ? key
                        : lowest;
                }, keys[0]);

                delete stats.callSites[lowestKey];
            }

            stats.callSites[stackKey] = {
                calls: 1,
                methods: {
                    [methodName]: 1,
                },
                firstArgs: argSummary,
                lastArgs: argSummary,
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
            };
        },

        clearBranchCallSiteStats() {
            this.__branchCallSiteStats = null;

            return {
                ok: true,
            };
        },

        getBranchCallSiteStats() {
            if (!ENABLE_BRANCH_CALLSITE_STATS) {
                return {
                    installed: false,
                    reason: "disabled",
                    totalCalls: 0,
                    methods: {},
                    topCallSites: [],
                };
            }
            if (!this.__branchCallSiteStats) {
                return {
                    installed: false,
                    totalCalls: 0,
                    methods: {},
                    topCallSites: [],
                };
            }

            const topCallSites = Object.entries(this.__branchCallSiteStats.callSites)
                .map(([stack, data]) => ({
                    stack,
                    ...data,
                }))
                .sort((a, b) => b.calls - a.calls)
                .slice(0, 20);

            return {
                installed: true,
                totalCalls: this.__branchCallSiteStats.totalCalls,
                methods: { ...this.__branchCallSiteStats.methods },
                topCallSites,
            };
        },

        installBranchCache({
            maxSize = DEFAULT_CACHE_MAX_SIZE,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) {
                return { ok: false, reason: "store not registered" };
            }

            if (this.__branchCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__branchCacheStats,
                };
            }

            const getBranchOriginal = this.__store.getBranch;
            const getBranchFromLeafOriginal = this.__store.getBranchFromLeaf;

            const originals = {};

            if (typeof getBranchOriginal === "function") {
                originals.getBranch = getBranchOriginal;
            }

            if (typeof getBranchFromLeafOriginal === "function") {
                originals.getBranchFromLeaf = getBranchFromLeafOriginal;
            }

            if (Object.keys(originals).length === 0) {
                return { ok: false, reason: "no branch methods available" };
            }

            const getBranchStats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    maxSize,
                    mode: "profiled:persistent:getBranch",
                    lastClearReason: null,
                }
                : {
                    maxSize,
                    mode: "production:persistent:getBranch",
                    lastClearReason: null,
                };

            const getBranchFromLeafStats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    calls: 0,
                    cacheReturns: 0,
                    prefixHits: 0,
                    prefixMisses: 0,
                    prefixRejected: 0,
                    originalCalls: 0,
                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    maxSize,
                    mode: "profiled:persistent:getBranchFromLeaf",
                    lastClearReason: null,
                }
                : {
                    maxSize,
                    mode: "production:persistent:getBranchFromLeaf",
                    lastClearReason: null,
                };

            const getBranchCache = createPersistentCache({
                maxSize,
                stats: getBranchStats,
                profiled,
            });

            const getBranchFromLeafCache = createPersistentCache({
                maxSize,
                stats: getBranchFromLeafStats,
                profiled,
            });

            this.__branchCache = {
                getBranch: getBranchCache.cache,
                getBranchFromLeaf: getBranchFromLeafCache.cache,
            };

            this.__branchCacheStats = {
                getBranch: getBranchStats,
                getBranchFromLeaf: getBranchFromLeafStats,
            };

            this.__branchCacheOriginals = originals;

            const bridgeRef = this;

            if (typeof getBranchOriginal === "function") {
                const store = this.__store;
                const getBranchGet = getBranchCache.get;
                const getBranchSet = getBranchCache.set;
                const recordBranchCallSite = ENABLE_BRANCH_CALLSITE_STATS
                    ? bridgeRef.recordBranchCallSite.bind(bridgeRef)
                    : null;

                this.__store.getBranch = function cachedGetBranch(id, ...rest) {
                    if (recordBranchCallSite) {
                        recordBranchCallSite("getBranch", [id, ...rest]);
                    }

                    const cached = getBranchGet(id);
                    if (cached !== undefined) return cached;

                    const result = getBranchOriginal.call(store, id, ...rest);

                    getBranchSet(id, result ?? null);
                    return result ?? null;
                };
            }

            if (typeof getBranchFromLeafOriginal === "function") {
                if (profiled) {

                    const store = this.__store;

                    this.__store.getBranchFromLeaf = function cachedGetBranchFromLeafProfiled(id, ...rest) {
                        bridgeRef.recordBranchCallSite?.("getBranchFromLeaf", [id, ...rest]);
                        getBranchFromLeafStats.calls += 1;

                        const key =
                            typeof id === "string" ||
                            typeof id === "number" ||
                            typeof id === "boolean" ||
                            id == null
                                ? id
                                : id.id ?? id.nodeId ?? id.message?.id ?? id;

                        const cached = getBranchFromLeafCache.get(key);
                        if (cached !== undefined) {
                            getBranchFromLeafStats.cacheReturns += 1;
                            return cached;
                        }

                        const node = getNodeDirect(store, key);
                        const parentId = node?.parentId ?? null;

                        if (node && parentId) {
                            const parentBranch = getBranchFromLeafCache.get(parentId);

                            if (
                                Array.isArray(parentBranch) &&
                                parentBranch[parentBranch.length - 1]?.id === parentId
                            ) {
                                getBranchFromLeafStats.prefixHits += 1;

                                const result = parentBranch.concat(node);
                                getBranchFromLeafCache.set(key, result);

                                return result;
                            }

                            getBranchFromLeafStats.prefixMisses += 1;
                        } else {
                            getBranchFromLeafStats.prefixRejected += 1;
                        }

                        getBranchFromLeafStats.originalCalls += 1;

                        const result = getBranchFromLeafOriginal.call(
                            store,
                            id,
                            ...rest
                        );

                        getBranchFromLeafCache.set(key, result ?? null);
                        return result ?? null;
                    };
                } else {
                    const store = this.__store;
                    const getBranchFromLeafGet = getBranchFromLeafCache.get;
                    const getBranchFromLeafSet = getBranchFromLeafCache.set;

                    this.__store.getBranchFromLeaf = function cachedGetBranchFromLeafProduction(id, ...rest) {
                        const key =
                            typeof id === "string" ||
                            typeof id === "number" ||
                            typeof id === "boolean" ||
                            id == null
                                ? id
                                : id.id ?? id.nodeId ?? id.message?.id ?? id;

                        const cached = getBranchFromLeafGet(key);
                        if (cached !== undefined) return cached;

                        const node = getNodeDirect(store, key);
                        const parentId = node?.parentId ?? null;

                        if (node && parentId) {
                            const parentBranch = getBranchFromLeafGet(parentId);

                            if (
                                Array.isArray(parentBranch) &&
                                parentBranch[parentBranch.length - 1]?.id === parentId
                            ) {
                                const result = parentBranch.concat(node);
                                getBranchFromLeafSet(key, result);

                                return result;
                            }
                        }

                        const result = getBranchFromLeafOriginal.call(
                            store,
                            id,
                            ...rest
                        );

                        getBranchFromLeafSet(key, result ?? null);
                        return result ?? null;
                    };
                }
            }

            this.__branchCacheInstalled = true;

            const result = {
                ok: true,
                installed: true,
                methods: Object.keys(originals),
                profiled,
            };

            this.__branchCacheLastInstallResult = result;

            return result;
        },

        uninstallBranchCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__branchCacheOriginals",
                installedFlag: "__branchCacheInstalled",
            });
        },

        clearBranchCache() {
            const branchCache = this.__branchCache;

            branchCache?.getBranch?.clear?.();
            branchCache?.getBranchFromLeaf?.clear?.();

            if (this.__branchCacheStats?.getBranch && "cached" in this.__branchCacheStats.getBranch) {
                this.__branchCacheStats.getBranch.cached = 0;
            }

            if (
                this.__branchCacheStats?.getBranchFromLeaf &&
                "cached" in this.__branchCacheStats.getBranchFromLeaf
            ) {
                this.__branchCacheStats.getBranchFromLeaf.cached = 0;
            }

            return { ok: true };
        },

        getBranchCacheStats() {
            return {
                installed: Boolean(this.__branchCacheInstalled),
                size: {
                    getBranch: this.__branchCache?.getBranch?.size ?? 0,
                    getBranchFromLeaf: this.__branchCache?.getBranchFromLeaf?.size ?? 0,
                },
                stats: this.__branchCacheStats ?? null,
                lastInstallResult: this.__branchCacheLastInstallResult ?? null,
            };
        },

        installResolvedNodeFrameCache({
            maxSize = DEFAULT_CACHE_MAX_SIZE,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) {
                return { ok: false, reason: "store not registered" };
            }

            if (this.__resolvedNodeFrameCacheInstalled) {
                return { ok: true, alreadyInstalled: true };
            }

            const stats = profiled
                ? {
                    calls: 0,
                    hits: 0,
                    misses: 0,

                    nodeHits: 0,
                    nullHits: 0,
                    nodeWrites: 0,
                    nullWrites: 0,
                    dualKeyWrites: 0,

                    resolvedNodeIds: 0,
                    messageIdInputs: 0,
                    nodeIdInputs: 0,
                    unknownInputs: 0,

                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    maxSize,
                    mode: "profiled:persistent",
                    lastClearReason: null,

                    inputSamples: [],
                    resultSamples: [],
                }
                : {
                    maxSize,
                    mode: "production:persistent",
                    lastClearReason: null,
                };

            const frameCache = createPersistentCache({
                maxSize,
                stats,
                profiled,
            });

            this.__resolvedNodeFrameCache = frameCache.cache;
            this.__resolvedNodeFrameCacheStats = stats;

            const bridgeRef = this;

            if (profiled) {
                this.__resolveNodeFast = function resolveNodeFastProfiled(id) {
                    stats.calls += 1;

                    if (typeof id === "string") {
                        if (id.startsWith("client-") || /^[0-9a-f-]{20,}$/i.test(id)) {
                            stats.nodeIdInputs += 1;
                        } else {
                            stats.messageIdInputs += 1;
                        }
                    } else {
                        stats.unknownInputs += 1;
                    }

                    const cached = frameCache.get(id);

                    if (cached !== undefined) {
                        if (cached === null) {
                            stats.nullHits += 1;
                        } else {
                            stats.nodeHits += 1;
                        }

                        return cached;
                    }

                    const node = resolveNodeCore(bridgeRef, id);

                    if (stats.inputSamples.length < 20) {
                        stats.inputSamples.push({
                            id,
                            idType: typeof id,
                            idString: String(id).slice(0, 120),
                            nodeExists: Boolean(node),
                            nodeId: node?.id ?? null,
                            messageId:
                                node?.message?.id ||
                                node?.message?.message_id ||
                                node?.message?.metadata?.message_id ||
                                null,
                        });
                    }

                    if (node) {
                        const nodeId = node.id;

                        stats.nodeWrites += 1;

                        if (nodeId) {
                            stats.resolvedNodeIds += 1;
                        }

                        frameCache.set(id, node);

                        if (nodeId && nodeId !== id) {
                            frameCache.set(nodeId, node);
                            stats.dualKeyWrites += 1;
                        }

                        if (stats.resultSamples.length < 20) {
                            stats.resultSamples.push({
                                inputId: String(id).slice(0, 120),
                                nodeId,
                                hasMessage: Boolean(node.message),
                                messageId:
                                    node.message?.id ||
                                    node.message?.message_id ||
                                    node.message?.metadata?.message_id ||
                                    null,
                                nodeKeys:
                                    node && typeof node === "object"
                                        ? Object.keys(node).slice(0, 20)
                                        : null,
                            });
                        }
                    } else {
                        stats.nullWrites += 1;
                        frameCache.set(id, null);
                    }

                    return node;
                };
            } else {
                const get = frameCache.get;
                const set = frameCache.set;
                const resolve = resolveNodeCore;

                this.__resolveNodeFast = function resolveNodeFastProduction(id) {
                    const cached = get(id);
                    if (cached !== undefined) return cached;

                    const node = resolve(bridgeRef, id);

                    if (node) {
                        const nodeId = node.id;

                        set(id, node);

                        if (nodeId && nodeId !== id) {
                            set(nodeId, node);
                        }
                    } else {
                        set(id, null);
                    }

                    return node;
                };
            }

            this.__resolvedNodeFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                profiled,
            };
        },

        uninstallResolvedNodeFrameCache() {
            if (!this.__resolvedNodeFrameCacheInstalled) {
                return { ok: true, alreadyUninstalled: true };
            }

            this.__resolvedNodeFrameCacheInstalled = false;
            this.__resolvedNodeFrameCache = null;
            this.__resolvedNodeFrameCacheStats = null;
            this.__resolveNodeFast = null;

            return { ok: true, uninstalled: true };
        },

        getResolvedNodeFrameCacheStats() {
            return {
                installed: Boolean(this.__resolvedNodeFrameCacheInstalled),
                size: this.__resolvedNodeFrameCache?.size ?? 0,
                stats: this.__resolvedNodeFrameCacheStats ?? null,
            };
        },

        installGetDisplayTurnsCache({
            maxSize = 5000,
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            if (!this.__store) return { ok: false, reason: "store not registered" };
            if (this.__getDisplayTurnsCacheInstalled) return { ok: true, alreadyInstalled: true };

            const original = this.__store.getDisplayTurns;
            if (typeof original !== "function") {
                return { ok: false, reason: "getDisplayTurns unavailable" };
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    bypassed: 0,
                    cached: 0,
                    evictions: 0,
                    frameClears: 0,
                    maxSize,
                    lastClearReason: null,
                    liveHits: 0,
                    liveMisses: 0,
                }
                : null;

            const cacheApi = createPersistentCache({ maxSize, stats, profiled });
            const store = this.__store;
            const bridgeRef = this;
            const prunedSet = this.__prunedLeafIdSet;
            const get = cacheApi.get;
            const set = cacheApi.set;

            const seenCounts = new Map();
            const promoteAfterCalls = 2;

            // rAF-based single-use cache for current leaf
            let liveFrame = -1;
            let liveLeafId = null;
            let liveValue = undefined;
            let liveUsesLeft = 0;

            // rAF frame counter
            bridgeRef.__displayTurnsRafFrame = 0;
            function bumpDisplayTurnsRafFrame() {
                bridgeRef.__displayTurnsRafFrame =
                    (bridgeRef.__displayTurnsRafFrame + 1) | 0;
                requestAnimationFrame(bumpDisplayTurnsRafFrame);
            }
            requestAnimationFrame(bumpDisplayTurnsRafFrame);

            this.__getDisplayTurnsCache = cacheApi.cache;
            this.__getDisplayTurnsCacheStats = stats;
            this.__getDisplayTurnsCacheOriginal = { getDisplayTurns: original };

            this.__store.getDisplayTurns = function cachedGetDisplayTurns(leafId, ...rest) {
                const currentLeafId =
                    typeof store.currentLeafId === "function"
                        ? store.currentLeafId()
                        : store.currentLeafId;

                const isCurrentLeaf = leafId === currentLeafId;

                // Current/active leaf: rAF-throttled single-use cache
                if (isCurrentLeaf) {
                    const frame = bridgeRef.__displayTurnsRafFrame || 0;

                    if (
                        liveFrame === frame &&
                        liveLeafId === leafId &&
                        liveValue !== undefined &&
                        liveUsesLeft > 0
                    ) {
                        liveUsesLeft -= 1;
                        if (stats) stats.liveHits = (stats.liveHits || 0) + 1;
                        return liveValue;
                    }

                    if (stats) stats.liveMisses = (stats.liveMisses || 0) + 1;

                    const result = original.call(store, leafId, ...rest) ?? null;

                    liveFrame = frame;
                    liveLeafId = leafId;
                    liveValue = result;
                    liveUsesLeft = 2;

                    return result;
                }

                const cached = get(leafId);
                if (cached !== undefined) return cached;

                const result = original.call(store, leafId, ...rest);

                const nextCount = (seenCounts.get(leafId) || 0) + 1;
                seenCounts.set(leafId, nextCount);

                const isPrunedLeaf = prunedSet?.has(leafId);

                if (isPrunedLeaf || nextCount >= promoteAfterCalls) {
                    set(leafId, result ?? null);
                } else if (stats) {
                    stats.bypassed = (stats.bypassed || 0) + 1;
                }

                return result ?? null;
            };

            this.__getDisplayTurnsCacheInstalled = true;

            return { ok: true, installed: true, profiled };
        },

        getDisplayTurnsCacheStats() {
            const stats = this.__getDisplayTurnsCacheStats;
            const hits = stats?.hits ?? 0;
            const misses = stats?.misses ?? 0;
            const total = hits + misses;
            const size = this.__getDisplayTurnsCache?.size ?? 0;

            return {
                installed: Boolean(this.__getDisplayTurnsCacheInstalled),
                hits,
                misses,
                bypassed: stats?.bypassed ?? 0,
                hitRate: total > 0 ? hits / total : 0,
                size,
                cached: stats?.cached ?? size,
                evictions: stats?.evictions ?? 0,
                maxSize: stats?.maxSize ?? null,
                liveHits: stats?.liveHits ?? 0,
                liveMisses: stats?.liveMisses ?? 0,
                lastClearReason: stats?.lastClearReason ?? null,
            };
        },

        uninstallGetDisplayTurnsCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__getDisplayTurnsCacheOriginal",
                installedFlag: "__getDisplayTurnsCacheInstalled",
            });
        },

        applyStoreReadOptimization({ debug = false, clearStats = false } = {}) {
            const optimizationStartedAt = performance.now();
            const discoveryResult = this.hasStore() ? true : this.promoteStoreDiscovery();

            if (!this.hasStore()) {
                return {
                    ok: false,
                    reason: "store not registered after promoteStoreDiscovery",
                    discoveryResult,
                    status: this.status(),
                };
            }

            const result = {
                ok: true,
                discoveryResult,
                statusBefore: this.status(),
                messageIdIndex: this.installMessageIdIndex({
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                indexRefreshHooks: [
                    this.wrapMutationForIndexRefresh("addMessageNode"),
                    this.wrapMutationForIndexRefresh("addOptimisticMessageNode"),
                    this.wrapMutationForIndexRefresh("prependNode"),
                    this.wrapMutationForIndexRefresh("prependOptismisticNode"),
                    this.wrapMutationForIndexRefresh("processUpdate", {
                        clearCaches: false,
                        rebuildIndex: false,
                    }),
                ],
                nodeFrameCache: this.installExistingNodeFrameCache({
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                findNodeFromLeafFrameCache: this.installFindNodeFromLeafFrameCache({
                    maxSize: 10000,
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                getLeafFromNodeFrameCache: this.installGetLeafFromNodeFrameCache({
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                branchCache: this.installBranchCache({
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                resolvedNodeFrameCache: this.installResolvedNodeFrameCache({
                    profiled: ENABLE_CACHE_PROFILING,
                }),
                profiler: ENABLE_STORE_PROFILER
                    ? this.installStoreProfiler()
                    : { ok: true, skipped: true, reason: "disabled by ENABLE_STORE_PROFILER" },
                cleared: null,
                getDisplayTurnsCache: this.installGetDisplayTurnsCache({
                    maxSize: 5000,
                    profiled: ENABLE_CACHE_PROFILING,
                }),
            };

            if (clearStats) {
                result.cleared = this.clearPerformanceStats();
            }

            result.statusAfter = this.status();

            if (debug) {
                console.log("[thread-optimizer bridge] store read optimization applied", result);
            }

            this.__initTiming.lastApplyOptimizationMs = performance.now() - optimizationStartedAt;

            console.log(DISCOVERY_LOG_PREFIX, "optimization install completed", {
                elapsedMs: Math.round(this.__initTiming.lastApplyOptimizationMs * 10) / 10,
                ok: result.ok,
                installed: {
                    messageIdIndex: result.messageIdIndex?.ok,
                    nodeFrameCache: result.nodeFrameCache?.ok,
                    findNodeFromLeafFrameCache: result.findNodeFromLeafFrameCache?.ok,
                    getLeafFromNodeFrameCache: result.getLeafFromNodeFrameCache?.ok,
                    branchCache: result.branchCache?.ok,
                    resolvedNodeFrameCache: result.resolvedNodeFrameCache?.ok,
                    profiler: result.profiler?.ok,
                },
                statusAfter: result.statusAfter,
            });

            return result;
        },

        disableStoreReadOptimization({ debug = false } = {}) {
            const result = {
                profiler: this.uninstallStoreProfiler?.(),
                getDisplayTurnsCache: this.uninstallGetDisplayTurnsCache?.(),
                resolvedNodeFrameCache: this.uninstallResolvedNodeFrameCache(),
                getLeafFromNodeFrameCache: this.uninstallGetLeafFromNodeFrameCache(),
                findNodeFromLeafFrameCache: this.uninstallFindNodeFromLeafFrameCache(),
                nodeFrameCache: this.uninstallExistingNodeFrameCache(),
                branchCache: this.uninstallBranchCache(),
                indexRefreshHooks: this.uninstallIndexRefreshHooks?.(),
                messageIdIndex: this.uninstallMessageIdIndex(),
            };

            if (debug) {
                console.log("[thread-optimizer bridge] store read optimization disabled", result);
            }

            return {
                ok: true,
                ...result,
            };
        },

        clearPerformanceStats() {
            this.clearStoreProfile?.();

            if (this.__messageIdIndexStats) {
                this.__messageIdIndexStats.hits = 0;
                this.__messageIdIndexStats.misses = 0;
                this.__messageIdIndexStats.fallbackHits = 0;
                this.__messageIdIndexStats.missSinceRebuild = 0;
                this.__messageIdIndexStats.rebuildSkips = 0;
            }

            for (const [cacheSlot, statsSlot] of FRAME_CACHE_SLOTS) {
                if (cacheSlot === "__branchCache") {
                    resetFrameCacheStats(
                        this.__branchCacheStats?.getBranch,
                        this.__branchCache?.getBranch
                    );

                    resetFrameCacheStats(
                        this.__branchCacheStats?.getBranchFromLeaf,
                        this.__branchCache?.getBranchFromLeaf
                    );

                    continue;
                }

                resetFrameCacheStats(this[statsSlot], this[cacheSlot]);
            }

            if (ENABLE_BRANCH_CALLSITE_STATS) {
                this.clearBranchCallSiteStats?.();
            }

            return { ok: true };
        },

        preparePerformanceTest() {
            this.__storeReadOptimizationRequested = true;

            return this.applyStoreReadOptimization({
                debug: false,
                clearStats: true,
            });
        },

        getPerformanceSnapshot() {
            return {
                status: this.status?.(),
                messageIdIndex: this.getMessageIdIndexStats?.(),
                existingNodeFrameCache: this.getExistingNodeFrameCacheStats?.(),
                findNodeFromLeafFrameCache: this.getFindNodeFromLeafFrameCacheStats?.(),
                getLeafFromNodeFrameCache: this.getGetLeafFromNodeFrameCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),
                getDisplayTurnsCache: this.getDisplayTurnsCacheStats?.(),
                branchCallSites: this.getBranchCallSiteStats?.(),
                initTiming: this.getInitTiming?.(),
                profile: this.getStoreProfile?.(),
            };
        },

        installStoreReadCache() {
            return this.applyStoreReadOptimization({
                debug: this.__storeReadOptimizationDebug,
                clearStats: false,
            });
        },

        clearStoreReadCache(reason = "manual") {
            for (const [cacheSlot, statsSlot] of FRAME_CACHE_SLOTS) {
                const cache = this[cacheSlot];
                const stats = this[statsSlot];

                if (cacheSlot === "__branchCache") {
                    this.__branchCache?.getBranch?.clear?.();

                    if (ENABLE_CACHE_PROFILING && this.__branchCacheStats) {
                        if (this.__branchCacheStats.getBranch) {
                            this.__branchCacheStats.getBranch.cached = 0;
                            this.__branchCacheStats.getBranch.frameClears += 1;
                            this.__branchCacheStats.getBranch.lastClearReason = reason;
                        }

                        if (this.__branchCacheStats.getBranchFromLeaf) {
                            this.__branchCacheStats.getBranchFromLeaf.lastClearReason = reason;
                        }
                    }

                    continue;
                }

                // keep getDisplayTurns cache across mutations
                if (
                    cacheSlot === "__getDisplayTurnsCache" &&
                    reason === "store-mutation"
                ) {
                    if (stats && ENABLE_CACHE_PROFILING) {
                        stats.skippedClears = (stats.skippedClears || 0) + 1;
                        stats.lastClearReason = "skipped-store-mutation";
                    }
                    continue;
                }

                // keep getLeafFromNode cache across mutations
                if (
                    cacheSlot === "__getLeafFromNodeFrameCache" &&
                    reason === "store-mutation"
                ) {
                    if (stats && ENABLE_CACHE_PROFILING) {
                        stats.skippedClears = (stats.skippedClears || 0) + 1;
                        stats.lastClearReason = "skipped-store-mutation";
                    }
                    continue;
                }

                // keep findNodeFromLeaf cache across mutations
                if (
                    cacheSlot === "__findNodeFromLeafFrameCache" &&
                    reason === "store-mutation"
                ) {
                    if (stats && ENABLE_CACHE_PROFILING) {
                        stats.skippedClears = (stats.skippedClears || 0) + 1;
                        stats.lastClearReason = "skipped-store-mutation";
                    }
                    continue;
                }

                // skip unnecessary clears for selected caches
                if (
                    cacheSlot === "__existingNodeFrameCache" &&
                    reason !== "store-mutation" &&
                    reason !== "conversation-change" &&
                    reason !== "manual"
                ) {
                    if (stats && ENABLE_CACHE_PROFILING) {
                        stats.skippedClears = (stats.skippedClears || 0) + 1;
                        stats.lastClearReason = "skipped-" + reason;
                    }
                    continue;
                }

                cache?.clear?.();

                if (stats && ENABLE_CACHE_PROFILING) {
                    stats.cached = 0;
                    if ("clears" in stats) stats.clears += 1;
                    else if ("frameClears" in stats) stats.frameClears += 1;
                    stats.lastClearReason = reason;
                }
            }

            return { ok: true };
        },

        getStoreReadCacheStats() {
            return {
                installed: Boolean(
                    this.__messageIdIndexInstalled ||
                    this.__existingNodeFrameCacheInstalled ||
                    this.__findNodeFromLeafFrameCacheInstalled ||
                    this.__getLeafFromNodeFrameCacheInstalled ||
                    this.__branchCacheInstalled ||
                    this.__resolvedNodeFrameCacheInstalled ||
                    this.__getDisplayTurnsCacheInstalled
                ),
                messageIdIndex: this.getMessageIdIndexStats?.(),
                existingNodeFrameCache: this.getExistingNodeFrameCacheStats?.(),
                findNodeFromLeafFrameCache: this.getFindNodeFromLeafFrameCacheStats?.(),
                getLeafFromNodeFrameCache: this.getGetLeafFromNodeFrameCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),
                getDisplayTurnsCache: this.getDisplayTurnsCacheStats?.(),
            };
        },

        getInitTiming() {
            const now = performance.now();

            return {
                installedForMs: Math.round((now - this.__initTiming.installedAt) * 10) / 10,
                firstDiscoveryStartedAt: this.__initTiming.firstDiscoveryStartedAt,
                firstDiscoveryCompletedAt: this.__initTiming.firstDiscoveryCompletedAt,
                lastDiscoveryMs: Math.round(this.__initTiming.lastDiscoveryMs * 10) / 10,
                lastApplyOptimizationMs: Math.round(this.__initTiming.lastApplyOptimizationMs * 10) / 10,
                discoveryRuns: this.__discoveryRuns,
                found: this.__found,
                hasStore: Boolean(this.__store),
                anchorCount: this.__anchorCount,
                visitedFibers: this.__visitedFibers,
                visitedObjects: this.__visitedObjects,
            };
        },

        maybeRebuildMessageIdIndex({ minIntervalMs = 1000 } = {}) {
            if (!this.__messageIdIndexInstalled) {
                return { ok: false, reason: "index not installed" };
            }

            const now = Date.now();
            const last = this.__messageIdIndexStats?.lastRebuiltAt ?? 0;

            if (now - last < minIntervalMs) {
                return { ok: true, skipped: true, reason: "too soon" };
            }

            return this.buildMessageIdIndex();
        },

        wrapMutationForIndexRefresh(methodName, {
            clearCaches = true,
            rebuildIndex = true,
        } = {}) {
            if (!this.__store || typeof this.__store[methodName] !== "function") {
                return { ok: false, reason: `${methodName} unavailable` };
            }

            this.__indexRefreshHookOriginals ??= {};

            if (this.__indexRefreshHookOriginals[methodName]) {
                return { ok: true, alreadyInstalled: true };
            }

            const original = this.__store[methodName];
            this.__indexRefreshHookOriginals[methodName] = original;

            const bridgeRef = this;

            this.__store[methodName] = function indexedMutationWrapper(...args) {
                const result = original.apply(bridgeRef.__store, args);

                if (clearCaches) {
                    bridgeRef.clearStoreReadCache?.("store-mutation");
                }

                if (rebuildIndex) {
                    queueMicrotask(() => {
                        bridgeRef.maybeRebuildMessageIdIndex?.({ minIntervalMs: 250 });
                    });
                }

                return result;
            };

            this.__indexRefreshHooksInstalled = true;

            return {
                ok: true,
                installed: true,
                method: methodName,
                clearCaches,
                rebuildIndex,
            };
        },

        uninstallIndexRefreshHooks() {
            if (!this.__indexRefreshHooksInstalled || !this.__indexRefreshHookOriginals) {
                return { ok: true, alreadyUninstalled: true };
            }

            if (this.__store) {
                for (const [methodName, original] of Object.entries(this.__indexRefreshHookOriginals)) {
                    this.__store[methodName] = original;
                }
            }

            this.__indexRefreshHooksInstalled = false;
            this.__indexRefreshHookOriginals = null;

            return { ok: true, uninstalled: true };
        },
    };

    window[GLOBAL_KEY] = bridge;

    function isPlainObject(value) {
        return value !== null &&
            typeof value === "object" &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function normalizeBridgeMessageId(messageId) {
        if (typeof messageId !== "string") {
            return null;
        }

        const normalized = messageId.trim();

        if (!normalized) {
            return null;
        }

        if (normalized.length > 300) {
            return null;
        }

        return normalized;
    }

    function isValidBridgeMessageEnvelope(event) {
        if (event.source !== window) return false;
        if (event.origin !== window.location.origin) return false;

        const data = event.data;

        if (!isPlainObject(data)) return false;
        if (data.source !== TRUSTED_SOURCE) return false;
        if (data.token !== BRIDGE_TOKEN) return false;
        if (!MESSAGE_TYPES.has(data.type)) return false;

        return true;
    }

    function validateBridgeMessage(data) {
        switch (data.type) {
            case "thread-optimizer:set-pruning-state": {
                const prunedTurnCount = Number(data.prunedTurnCount);

                return {
                    ok: true,
                    value: {
                        enabled: Boolean(data.enabled),
                        prunedTurnCount:
                            Number.isFinite(prunedTurnCount) && prunedTurnCount >= 0
                                ? prunedTurnCount
                                : 0,
                    },
                };
            }

            case "thread-optimizer:record-pruned-message-id": {
                const messageId = normalizeBridgeMessageId(data.messageId);

                if (!messageId) {
                    return {
                        ok: false,
                        reason: "invalid message id",
                    };
                }

                return {
                    ok: true,
                    value: {
                        messageId,
                    },
                };
            }

            case "thread-optimizer:log-store-performance": {
                return {
                    ok: true,
                    value: {},
                };
            }

            case "thread-optimizer:set-store-read-optimization": {
                return {
                    ok: true,
                    value: {
                        enabled: Boolean(data.enabled),
                        debug: Boolean(data.debug),
                    },
                };
            }

            default:
                return {
                    ok: false,
                    reason: "unknown message type",
                };
        }
    }

    window.addEventListener(
        "message",
        (event) => {
            if (!isValidBridgeMessageEnvelope(event)) {
                return;
            }

            const data = event.data;
            const validation = validateBridgeMessage(data);

            if (!validation.ok) {
                console.debug("[thread-optimizer bridge] ignored invalid bridge message", {
                    type: data.type,
                    reason: validation.reason,
                });
                return;
            }

            const payload = validation.value;

            if (data.type === "thread-optimizer:set-pruning-state") {
                bridge.setKnownPruningState({
                    enabled: payload.enabled,
                    prunedTurnCount: payload.prunedTurnCount,
                });

                if (!isStoreGoodEnough(bridge.__store)) {
                    bridge.retryDiscovery();
                }

                return;
            }

            if (data.type === "thread-optimizer:record-pruned-message-id") {
                bridge.recordPrunedMessageId(payload.messageId);
                return;
            }

            if (data.type === "thread-optimizer:log-store-performance") {
                console.debug("[thread-optimizer bridge] received store performance log request");
                console.log("[thread-optimizer bridge] store performance", bridge.getPerformanceSnapshot());
                return;
            }

            if (data.type === "thread-optimizer:set-store-read-optimization") {
                console.debug("[thread-optimizer bridge] received store read optimization setting", {
                    enabled: payload.enabled,
                    debug: payload.debug,
                });

                bridge.__storeReadOptimizationRequested = payload.enabled;
                bridge.__storeReadOptimizationDebug = payload.debug;

                if (payload.enabled) {
                    bridge.applyStoreReadOptimization({
                        debug: payload.debug,
                        clearStats: true,
                    });
                } else {
                    bridge.disableStoreReadOptimization({
                        debug: payload.debug,
                    });
                }
            }
        },
        false
    );

    let lastConversationKey = location.pathname + location.search;

    function resetToStartupCachePolicy(reason = "conversation-change") {
        bridge.clearStoreReadCache?.(reason);
        bridge.maybeRebuildMessageIdIndex?.({ minIntervalMs: 0 });

        const original = bridge.__existingNodeFrameCacheOriginal?.getNodeIfExists;
        const cacheApi = bridge.__existingNodeFrameCacheApi;

        if (bridge.__store && typeof original === "function" && cacheApi) {
            cacheApi.clear?.("conversation-change");
            bridge.prewarmExistingNodeFrameCache?.(cacheApi);
            bridge.installLiveGetNodeIfExistsWrapper?.(original, cacheApi);
        }
    }

    function checkConversationChanged() {
        const nextKey = location.pathname + location.search;
        if (nextKey === lastConversationKey) return;

        lastConversationKey = nextKey;
        resetToStartupCachePolicy("conversation-change");
    }

    window.addEventListener("popstate", checkConversationChanged);

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        queueMicrotask(checkConversationChanged);
        return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        queueMicrotask(checkConversationChanged);
        return result;
    };

    function enableLivePolicyOnUserIntent() {
        bumpLiveNodeReadFrame();
        bridge.enableLiveNodeCachePolicy?.();
    }

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                enableLivePolicyOnUserIntent();
            }
        },
        true
    );

    document.addEventListener(
        "click",
        (event) => {
            const target = event.target?.closest?.(
                'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="send"]'
            );

            if (target) {
                enableLivePolicyOnUserIntent();
            }
        },
        true
    );

    function bumpLiveNodeReadFrame() {
        bridge.__liveNodeReadFrame = (bridge.__liveNodeReadFrame + 1) | 0;
    }

    document.addEventListener("input", bumpLiveNodeReadFrame, true);
    document.addEventListener("compositionend", bumpLiveNodeReadFrame, true);

    bridge.startDiscoveryLoop();
})();