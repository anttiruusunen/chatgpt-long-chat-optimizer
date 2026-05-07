(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";

    const CONFIG = {
        bridgeVersion: 8,

        discovery: {
            maxFibers: 4000,
            maxObjects: 15000,
        },

        flags: {
            debug: false,
            cacheProfiling: false,
            storeProfiler: false,
            branchCallSites: false,
            nodeCallSites: false,
            findNodeCallSites: false,
        },
    };

    const STORE_ENHANCEMENTS = [
        {
            key: "messageIdIndex",
            install: "installMessageIdIndex",
            uninstall: "uninstallMessageIdIndex",
            installedFlag: "__messageIdIndexInstalled",
            slots: [
                "__messageIdIndexOriginal",
                "__messageIdIndex",
                "__messageIdIndexStats",
            ],
        },
        {
            key: "nodeStableCache",
            install: "installExistingNodeStableCache",
            uninstall: "uninstallExistingNodeStableCache",
            installedFlag: "__existingnodeStableCacheInstalled",
            slots: [
                "__existingnodeStableCacheOriginal",
                "__existingnodeStableCache",
                "__existingnodeStableCacheStats",
                "__existingnodeStableCacheApi",
            ],
        },
        {
            key: "getNodeByIdOrMessageIdCache",
            install: "installGetNodeByIdOrMessageIdCache",
            uninstall: "uninstallGetNodeByIdOrMessageIdCache",
            installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
            slots: [
                "__getNodeByIdOrMessageIdCacheOriginal",
                "__getNodeByIdOrMessageIdCache",
                "__getNodeByIdOrMessageIdCacheStats",
            ],
        },
        {
            key: "findNodeFromLeafFrameCache",
            install: "installFindNodeFromLeafFrameCache",
            uninstall: "uninstallFindNodeFromLeafFrameCache",
            installedFlag: "__findNodeFromLeafFrameCacheInstalled",
            slots: [
                "__findNodeFromLeafFrameCacheOriginal",
                "__findNodeFromLeafFrameCache",
                "__findNodeFromLeafFrameCacheStats",
                "__findNodeFromLeafCacheController",
                "__findNodeFromLeafAncestorChainCache",
                "__findNodeFromLeafDormantAncestorResultCache",
                "__findNodeFromLeafHotPredicateIds",
            ],
        },
        {
            key: "findNodePredicateCache",
            install: "installFindNodePredicateCache",
            uninstall: "uninstallFindNodePredicateCache",
            installedFlag: "__findNodePredicateCacheInstalled",
            slots: [
                "__findNodePredicateCacheOriginal",
                "__findNodePredicateCache",
                "__findNodePredicateCacheStats",
            ],
        },
        {
            key: "getLeafFromNodeFrameCache",
            install: "installGetLeafFromNodeFrameCache",
            uninstall: "uninstallGetLeafFromNodeFrameCache",
            installedFlag: "__getLeafFromNodeFrameCacheInstalled",
            slots: [
                "__getLeafFromNodeFrameCacheOriginal",
                "__getLeafFromNodeFrameCache",
                "__getLeafFromNodeFrameCacheStats",
                "__leafDescendantCache",
                "__leafDescendantMissCache",
            ],
        },
        {
            key: "branchCache",
            install: "installBranchCache",
            uninstall: "uninstallBranchCache",
            installedFlag: "__branchCacheInstalled",
            slots: [
                "__branchCacheOriginals",
                "__branchCache",
                "__branchCacheStats",
                "__branchCacheLastInstallResult",
            ],
        },
        {
            key: "resolvedNodeFrameCache",
            install: "installResolvedNodeFrameCache",
            uninstall: "uninstallResolvedNodeFrameCache",
            installedFlag: "__resolvedNodeFrameCacheInstalled",
            slots: [
                "__resolvedNodeFrameCache",
                "__resolvedNodeFrameCacheStats",
                "__resolveNodeFast",
            ],
        },
    ];

    function resetStoreEnhancementSlots(bridge) {
        for (const enhancement of STORE_ENHANCEMENTS) {
            bridge[enhancement.installedFlag] = false;

            if (Array.isArray(enhancement.slots) && enhancement.slots.length > 0) {
                clearBridgeSlots(bridge, enhancement.slots);
            }
        }
    }

    function runStoreEnhancementInstalls(bridge) {
        const result = {};

        for (const enhancement of STORE_ENHANCEMENTS) {
            const install = bridge[enhancement.install];

            result[enhancement.key] =
                typeof install === "function"
                    ? install.call(bridge, { profiled: ENABLE_CACHE_PROFILING })
                    : { ok: false, reason: `missing installer: ${enhancement.install}` };
        }

        return result;
    }

    function runStoreEnhancementUninstalls(bridge) {
        const result = {};

        for (let i = STORE_ENHANCEMENTS.length - 1; i >= 0; i -= 1) {
            const enhancement = STORE_ENHANCEMENTS[i];
            const uninstall = bridge[enhancement.uninstall];

            result[enhancement.key] =
                typeof uninstall === "function"
                    ? uninstall.call(bridge)
                    : { ok: false, reason: `missing uninstaller: ${enhancement.uninstall}` };
        }

        return result;
    }

    function getStoreEnhancementInstallSummary(result) {
        const installed = {};

        for (const enhancement of STORE_ENHANCEMENTS) {
            installed[enhancement.key] = result[enhancement.key]?.ok;
        }

        return installed;
    }

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

    const DISCOVERY_LOG_PREFIX = "[thread-optimizer bridge init]";

    const PAGE_SCRIPT_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";
    const TRUSTED_SOURCE = "thread-optimizer";

    const MESSAGE_TYPES = new Set([
        "thread-optimizer:set-pruning-state",
        "thread-optimizer:prune-react-message-ids",
        "thread-optimizer:log-store-performance",
        "thread-optimizer:set-store-read-optimization",
        "thread-optimizer:visible-messages-ready",
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

    const ENABLE_DEBUG = CONFIG.flags.debug;
    const ENABLE_STORE_PROFILER = CONFIG.flags.storeProfiler || ENABLE_DEBUG;
    const ENABLE_BRANCH_CALLSITE_STATS = CONFIG.flags.branchCallSites || ENABLE_DEBUG;
    const ENABLE_CACHE_PROFILING = CONFIG.flags.cacheProfiling || ENABLE_DEBUG;
    const ENABLE_NODE_CALLSITE_STATS = CONFIG.flags.nodeCallSites || ENABLE_DEBUG;
    const ENABLE_FIND_NODE_CALLSITE_STATS = CONFIG.flags.findNodeCallSites || ENABLE_DEBUG;

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    const CACHE_MISS = Symbol("threadOptimizerCacheMiss");

    function createNodeObjectCache({ store, stats, profiled = false }) {
        const cache = new Map();

        function get(id) {
            if (!id) return undefined;

            const cached = cache.get(id);

            if (cached !== undefined) {
                if (profiled) stats.hits += 1;
                return cached === CACHE_MISS ? null : cached;
            }

            if (profiled) stats.misses += 1;
            return undefined;
        }

        function set(id, node) {
            if (!id) return;

            cache.set(id, node === null ? CACHE_MISS : node);

            stats.cached = cache.size;

            if (profiled) {
                stats.writes += 1;
                if (node === null) stats.nullWrites += 1;
            }
        }

        function resolve(id) {
            const cached = get(id);

            if (cached !== undefined) {
                return cached;
            }

            const node = getNodeDirect(store, id) ?? null;

            set(id, node);

            return node;
        }

        function clear(reason) {
            cache.clear();
            stats.cached = 0;
            stats.lastClearReason = reason;
        }

        return {
            cache,
            get,
            set,
            resolve,
            clear,
        };
    }

    function createPersistentCache({ stats, profiled = false }) {
        const cache = new Map();

        function clear(reason) {
            if (cache.size !== 0) {
                cache.clear();
                if (profiled && stats && "cached" in stats) stats.cached = 0;
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
                stats.cached = cache.size;
            }
            : function setProduction(key, value) {
                cache.set(key, value === null ? CACHE_MISS : value);
            };

        return { get, set, clear, cache };
    }

    function createCacheStats(profiled, profileStats, productionStats = {}) {
        return profiled
            ? {
                ...profileStats,
            }
            : {
                ...productionStats,
            };
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

    function getNewestVisibleMessageIdFromDom() {
        const selectors = [
            "[data-message-id]",
            "[data-message-author-role][data-message-id]",
            'article[data-testid^="conversation-turn-"] [data-message-id]',
            'section[data-testid^="conversation-turn-"] [data-message-id]',
        ];

        for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);

            for (let i = nodes.length - 1; i >= 0; i -= 1) {
                const value = nodes[i]?.getAttribute?.("data-message-id");

                if (typeof value === "string" && value.trim()) {
                    return value.trim();
                }
            }
        }

        return null;
    }

    function getStoreCurrentLeafId(store) {
        try {
            return typeof store?.currentLeafId === "function"
                ? store.currentLeafId()
                : store?.currentLeafId ?? null;
        } catch {
            return null;
        }
    }

    function candidateStoreCanResolveVisibleNewestNode(store) {
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
            const nodeId = store.messageIdToExistingNodeId?.call(store, newestMessageId);

            if (!nodeId) {
                return {
                    ok: false,
                    reason: "message id did not resolve",
                    newestMessageId,
                    nodeId: null,
                };
            }

            const nodeCache = window[GLOBAL_KEY]?.__nodeObjectCacheApi;

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

    function scoreStoreCandidate(store) {
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

    function requireStore(bridge) {
        return bridge.__store || null;
    }

    function unavailable(reason) {
        return { ok: false, reason };
    }

    function alreadyInstalled(stats = null) {
        return stats
            ? { ok: true, alreadyInstalled: true, stats }
            : { ok: true, alreadyInstalled: true };
    }

    function getStoreMethod(store, methodName) {
        const method = store?.[methodName];
        return typeof method === "function" ? method : null;
    }

    const PERSIST_ACROSS_TOPOLOGY_CACHE_SLOTS = new Set([
        "__existingNodeStableCache",
        "__getNodeByIdOrMessageIdCache",
        "__messageIdIndex",
        "__resolvedNodeFrameCache",
        "__findNodeFromLeafFrameCache",
    ]);

    const STABLE_CACHE_SLOTS = [
        ["__existingNodeStableCache", "__existingNodeStableCacheStats"],
        ["__findNodeFromLeafFrameCache", "__findNodeFromLeafFrameCacheStats"],
        ["__getNodeByIdOrMessageIdCache", "__getNodeByIdOrMessageIdCacheStats"],
        ["__getLeafFromNodeFrameCache", "__getLeafFromNodeFrameCacheStats"],
        ["__branchCache", "__branchCacheStats"],
        ["__resolvedNodeFrameCache", "__resolvedNodeFrameCacheStats"],
    ];

    function getCacheSnapshot(bridge, installedFlag, cacheSlot, statsSlot) {
        return {
            installed: Boolean(bridge[installedFlag]),
            size: bridge[cacheSlot]?.size ?? 0,
            stats: bridge[statsSlot] ?? null,
        };
    }

    function resetFrameCacheStats(stats, cache) {
        if (!stats) return;

        if ("hits" in stats) stats.hits = 0;
        if ("misses" in stats) stats.misses = 0;

        stats.cached = cache?.size ?? 0;
    }

    function smokeTestStoreWrappers(store) {
        try {
            const leafId =
                typeof store.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store.currentLeafId;

            if (!leafId) return true;

            // Critical paths that need to be tested for crashes
            store.getNodeIfExists?.call(store, leafId);
            store.getNodeByIdOrMessageId?.call(store, leafId);
            store.getBranch?.call(store);

            return true;
        } catch (error) {
            console.warn(
                "[thread-optimizer bridge] store wrapper smoke test failed",
                error
            );
            return false;
        }
    }

    function validateStoreMethodBinding(store, methodName, original) {
        if (!store || typeof original !== "function") return false;

        try {
            if (methodName === "getNodeIfExists") {
                return typeof store.messageIdToExistingNodeId === "function";
            }

            if (methodName === "getNodeByIdOrMessageId") {
                return typeof store.getNodeIfExists === "function";
            }

            return true;
        } catch {
            return false;
        }
    }

    function installStoreMethodWrapper({
        bridge,
        methodName,
        originalSlot,
        installedFlag,
        unavailableReason = `${methodName} unavailable`,
        createWrapper,
    }) {
        const store = requireStore(bridge);
        if (!store) return unavailable("store not registered");

        if (bridge[installedFlag]) {
            return alreadyInstalled();
        }

        const original = getStoreMethod(store, methodName);
        if (!original) return unavailable(unavailableReason);

        if (!validateStoreMethodBinding(store, methodName, original)) {
            return unavailable(`${methodName} failed install-time validation`);
        }

        bridge[originalSlot] = {
            ...(bridge[originalSlot] || {}),
            [methodName]: original,
        };

        store[methodName] = createWrapper({
            store,
            original,
            bridge,
        });

        bridge[installedFlag] = true;

        return {
            ok: true,
            installed: true,
            methods: [methodName],
        };
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

    function clearBridgeSlots(bridge, slots) {
        for (let i = 0; i < slots.length; i += 1) {
            bridge[slots[i]] = null;
        }
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
        } catch { }

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
        } catch { }

        try {
            currentLeafId = safeCall(store.currentLeafId);
        } catch { }

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
        } catch { }

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
                    const scored = scoreStoreCandidate(current);

                    if (scored.score > bestNodeCount) {
                        bestStore = current;
                        bestNodeCount = scored.score;
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
                        const scored = scoreStoreCandidate(candidate);

                        if (scored.score > bestNodeCount) {
                            bestStore = candidate;
                            bestNodeCount = scored.score;
                        }

                        continue;
                    }
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
                        const scored = scoreStoreCandidate(scanned.store);

                        if (scored.score > bestNodeCount) {
                            bestStore = scanned.store;
                            bestNodeCount = scored.score;
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
        const nodeCache = bridge.__nodeObjectCacheApi;

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

                    const node = nodeCache
                        ? nodeCache.resolve(indexedNodeId)
                        : getNodeDirect(store, indexedNodeId);

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

            const node = nodeCache
                ? nodeCache.resolve(nodeId)
                : getNodeDirect(store, nodeId);

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
        __version: CONFIG.bridgeVersion,

        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,
        __found: false,
        __messageIdResolveWarningShown: false,

        __storeDiscoveryLocked: false,
        __storeDiscoveryLockReason: null,
        __visibleMessagesReadyChecks: 0,
        __visibleMessagesVerificationDone: false,
        __visibleMessagesVerificationConversationKey: null,
        __lastVisibleMessagesVerificationResult: null,

        __anchorCount: 0,
        __discoveryRuns: 0,
        __visitedFibers: 0,
        __visitedObjects: 0,

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

        __existingNodeStableCacheInstalled: false,
        __existingNodeStableCacheOriginal: null,
        __existingNodeStableCache: null,
        __existingNodeStableCacheStats: null,
        __existingNodeStableCacheApi: null,
        __liveNodeCacheId: null,
        __liveNodeCacheValue: null,
        __liveNodeCacheDirty: true,

        __getNodeByIdOrMessageIdCacheInstalled: false,
        __getNodeByIdOrMessageIdCacheOriginal: null,
        __getNodeByIdOrMessageIdCache: null,
        __getNodeByIdOrMessageIdCacheStats: null,

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

        __nodeIdDirectIndex: null,
        __nodeIdDirectIndexSource: null,
        __confirmedExistingNodeIds: null,

        __storeReadEpoch: 0,

        __lastLiveFindLeafId: null,
        __lastLiveFindPredicateSource: null,
        __lastLiveFindValue: null,

        __updateNodeMessageRafBatcherInstalled: false,
        __updateNodeMessageRafBatcherOriginal: null,
        __updateNodeMessageRafBatcherPending: null,

        __findNodePredicateCacheInstalled: false,
        __findNodePredicateCacheOriginal: null,
        __findNodePredicateCache: null,
        __findNodePredicateCacheStats: null,

        __findNodeCallSiteProfilerInstalled: false,
        __findNodeCallSiteProfilerOriginal: null,
        __findNodeCallSiteProfilerStats: null,

        __nodeObjectCache: null,
        __nodeObjectCacheStats: null,
        __nodeObjectCacheApi: null,

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

        ensureNodeObjectCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return null;

            if (this.__nodeObjectCacheApi) {
                return this.__nodeObjectCacheApi;
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    writes: 0,
                    nullWrites: 0,
                    cached: 0,
                    lastClearReason: null,
                    mode: "profiled:shared-node-object-cache",
                }
                : {
                    cached: 0,
                    lastClearReason: null,
                    mode: "production:shared-node-object-cache",
                };

            const api = createNodeObjectCache({
                store,
                stats,
                profiled,
            });

            this.__nodeObjectCacheApi = api;
            this.__nodeObjectCache = api.cache;
            this.__nodeObjectCacheStats = stats;

            return api;
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
            clearBridgeSlots(this, [
                "__storeProfilerOriginals",
                "__storeProfile",
            ]);

            resetStoreEnhancementSlots(this);

            clearBridgeSlots(this, [
                "__nodeObjectCache",
                "__nodeObjectCacheStats",
                "__nodeObjectCacheApi",
            ]);

            this.__branchCacheClearScheduled = false;
            this.__resolvedNodeFrameCacheClearScheduled = false;

            this.__indexRefreshHooksInstalled = false;
            clearBridgeSlots(this, [
                "__indexRefreshHookOriginals",
            ]);

            clearBridgeSlots(this, [
                "__nodeIdDirectIndex",
                "__nodeIdDirectIndexSource",
                "__confirmedExistingNodeIds",
            ]);

            this.__liveNodeCacheDirty = true;
            clearBridgeSlots(this, [
                "__liveNodeCacheId",
                "__liveNodeCacheValue",
            ]);

            clearBridgeSlots(this, [
                "__lastLiveFindLeafId",
                "__lastLiveFindPredicateSource",
                "__lastLiveFindValue",
            ]);

            this.__updateNodeMessageRafBatcherInstalled = false;
            clearBridgeSlots(this, [
                "__updateNodeMessageRafBatcherOriginal",
                "__updateNodeMessageRafBatcherPending",
            ]);

            this.__findNodeCallSiteProfilerInstalled = false;
            clearBridgeSlots(this, [
                "__findNodeCallSiteProfilerOriginal",
                "__findNodeCallSiteProfilerStats",
            ]);
        },

        registerStore(store, meta = null) {
            const validation = validateStoreCandidate(store);

            if (!validation.ok) {
                rejectStore(store, validation.reason);
                this.__lastError = `registerStore rejected candidate: ${validation.reason}`;
                return false;
            }

            const currentStore = this.__store;
            const currentNodeCount = getStoreNodeCount(currentStore);
            const nextNodeCount = validation.nodeCount ?? getStoreNodeCount(store);

            if (currentStore === store) {
                return true;
            }

            // Do not replace a hydrated/live store with a smaller bootstrap/root store.
            if (currentStore && nextNodeCount < currentNodeCount) {
                console.debug("[thread-optimizer bridge] ignored smaller store candidate", {
                    currentNodeCount,
                    nextNodeCount,
                });
                return false;
            }

            // Critical: fully unwrap the old store before touching the new one.
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

                if (!result?.ok) {
                    console.warn("[thread-optimizer bridge] optimization failed after store registration", result);

                    this.disableStoreReadOptimization?.({ debug: false });
                    this.resetInstalledStoreEnhancements();

                    this.__lastError = `optimization failed: ${result?.reason || "unknown"}`;
                    this.__storeValidationFailed = true;

                    return false;
                }

                if (this.__storeReadOptimizationDebug) {
                    console.log("[thread-optimizer bridge] re-applied store read optimization after store registration", result);
                }
            }

            return true;
        },

        repairDeletedNodeReferences(deletedNodeIds) {
            const store = this.__store;

            if (!store || !Array.isArray(deletedNodeIds) || deletedNodeIds.length === 0) {
                return {
                    ok: true,
                    repairedParents: 0,
                    deletedNodeIds: [],
                };
            }

            const deletedSet = new Set(deletedNodeIds.filter(Boolean));

            let repairedParents = 0;

            const nodes = store.nodes;
            const allNodes =
                nodes instanceof Map
                    ? Array.from(nodes.values())
                    : Array.isArray(nodes)
                        ? nodes
                        : nodes && typeof nodes === "object"
                            ? Object.values(nodes)
                            : [];

            for (const node of allNodes) {
                if (!node || !Array.isArray(node.children)) {
                    continue;
                }

                const beforeLength = node.children.length;
                const nextChildren = node.children.filter(
                    (childId) => !deletedSet.has(childId)
                );

                if (nextChildren.length !== beforeLength) {
                    node.children = nextChildren;
                    repairedParents += 1;
                }
            }

            const currentLeafId =
                typeof store.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store.currentLeafId;

            if (deletedSet.has(currentLeafId)) {
                const fallbackLeaf =
                    typeof store.getLeafFromNode === "function" && store.rootId
                        ? this.withOriginalTopologyMethods?.(() =>
                            store.getLeafFromNode(store.rootId)
                        )
                        : null;

                if (
                    fallbackLeaf?.id &&
                    typeof store.setCurrentLeafId === "function"
                ) {
                    store.setCurrentLeafId(fallbackLeaf.id);
                }
            }

            this.clearFullTopologyCaches?.("repair-deleted-node-references");

            return {
                ok: true,
                repairedParents,
                deletedNodeIds: Array.from(deletedSet),
            };
        },

        withOriginalTopologyMethods(fn) {
            const store = this.__store;

            if (!store || typeof fn !== "function") {
                return fn?.();
            }

            const restore = [];

            const temporarilyRestore = (methodName, originalSlot) => {
                const originalEntry = this[originalSlot];
                const original =
                    typeof originalEntry === "function"
                        ? originalEntry
                        : originalEntry?.[methodName];

                if (typeof original !== "function") {
                    return;
                }

                const current = store[methodName];

                if (current === original) {
                    return;
                }

                restore.push([methodName, current]);
                store[methodName] = original;
            };

            temporarilyRestore("messageIdToExistingNodeId", "__messageIdIndexOriginal");
            temporarilyRestore("getNodeIfExists", "__existingNodeStableCacheOriginal");
            temporarilyRestore("getNodeByIdOrMessageId", "__getNodeByIdOrMessageIdCacheOriginal");
            temporarilyRestore("findNodeFromLeaf", "__findNodeFromLeafFrameCacheOriginal");
            temporarilyRestore("findNode", "__findNodePredicateCacheOriginal");
            temporarilyRestore("getLeafFromNode", "__getLeafFromNodeFrameCacheOriginal");

            // Branch wrappers should not be involved while topology is changing.
            const branchOriginals = this.__branchCacheOriginals;
            if (branchOriginals) {
                for (const methodName of ["getBranch", "getBranchFromLeaf"]) {
                    const original = branchOriginals[methodName];

                    if (typeof original === "function" && store[methodName] !== original) {
                        restore.push([methodName, store[methodName]]);
                        store[methodName] = original;
                    }
                }
            }

            try {
                return fn();
            } finally {
                for (let i = restore.length - 1; i >= 0; i -= 1) {
                    const [methodName, wrapped] = restore[i];
                    store[methodName] = wrapped;
                }
            }
        },

        pruneReactMessageIds(messageIds, {
            reason = "react-prune",
        } = {}) {
            const store = this.__store;

            if (!store || typeof store.deleteNode !== "function") {
                return {
                    ok: false,
                    reason: "store/deleteNode unavailable",
                    deleted: [],
                    failed: [],
                };
            }

            const uniqueIds = Array.from(new Set(
                Array.isArray(messageIds) ? messageIds.filter(Boolean) : []
            ));

            const result = {
                ok: true,
                reason,
                requested: uniqueIds,
                deleted: [],
                failed: [],
            };

            this.beginStoreTopologyMutation?.("react-prune");

            for (let i = uniqueIds.length - 1; i >= 0; i -= 1) {
                const inputId = uniqueIds[i];

                try {
                    const node =
                        this.__resolveNodeFast?.(inputId) ??
                        getNodeDirect(store, inputId) ??
                        store.getNodeIfExists?.(inputId) ??
                        null;

                    if (!node?.id) {
                        result.failed.push({
                            inputId,
                            reason: "node not found",
                        });
                        continue;
                    }

                    const currentLeafId =
                        typeof store.currentLeafId === "function"
                            ? store.currentLeafId()
                            : store.currentLeafId;

                    if (node.id === currentLeafId) {
                        result.failed.push({
                            inputId,
                            nodeId: node.id,
                            reason: "refusing to delete current leaf",
                        });
                        continue;
                    }

                    this.clearCachesForDeletedNode?.(node, inputId);

                    this.withOriginalTopologyMethods?.(() => {
                        store.deleteNode(node.id);
                    });

                    // Important: purge before verification.
                    // Otherwise wrapped getNodeIfExists can return the deleted node from cache.
                    const purgeResult = this.clearCachesForDeletedNode?.(node, inputId);

                    const stillExists = getNodeDirect(store, node.id) ?? null;

                    if (stillExists?.id) {
                        result.failed.push({
                            inputId,
                            nodeId: node.id,
                            reason: "node still exists after delete",
                        });
                        continue;
                    }

                    result.deleted.push({
                        inputId,
                        nodeId: node.id,
                        purgedCacheEntries: purgeResult?.deletedEntries ?? 0,
                        purgedAliases: purgeResult?.aliases ?? [],
                    });
                } catch (error) {
                    result.failed.push({
                        inputId,
                        reason: String(error?.message || error),
                    });
                }
            }

            result.deletedCount = result.deleted.length;
            result.failedCount = result.failed.length;
            result.ok = result.failed.length === 0;

            const deletedNodeIds = result.deleted
                .map((entry) => entry.nodeId)
                .filter(Boolean);

            if (deletedNodeIds.length > 0) {
                result.repairResult =
                    this.repairDeletedNodeReferences?.(deletedNodeIds) ?? null;

                this.beginStoreTopologyMutation?.("react-prune-complete");
            }

            return result;
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

        discoverNow() {
            if (this.__storeDiscoveryLocked) {
                return true;
            }
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
                    maxFibers: CONFIG.discovery.maxFibers,
                    maxObjects: CONFIG.discovery.maxObjects,
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

        lockStoreDiscovery(reason = "unknown") {
            this.__storeDiscoveryLocked = true;
            this.__storeDiscoveryLockReason = reason;

            console.debug("[thread-optimizer bridge] locked store discovery", {
                reason,
                status: this.status(),
            });

            return true;
        },

        verifyRegisteredStoreAgainstVisibleMessages(reason = "visible-messages-ready") {
            const conversationKey = location.pathname + location.search;

            if (
                this.__visibleMessagesVerificationDone &&
                this.__visibleMessagesVerificationConversationKey === conversationKey
            ) {
                return {
                    ok: true,
                    skipped: true,
                    reason: "visible messages verification already completed",
                    previousResult: this.__lastVisibleMessagesVerificationResult,
                };
            }

            this.__visibleMessagesReadyChecks += 1;
            this.__visibleMessagesVerificationConversationKey = conversationKey;

            const currentCheck = this.__store
                ? candidateStoreCanResolveVisibleNewestNode(this.__store)
                : { ok: false, reason: "store not registered" };

            if (currentCheck.ok) {
                this.lockStoreDiscovery(`${reason}:current-store-resolves-visible-newest`);

                const result = {
                    ok: true,
                    locked: true,
                    rediscovered: false,
                    currentCheck,
                };

                this.__visibleMessagesVerificationDone = true;
                this.__lastVisibleMessagesVerificationResult = result;

                return result;
            }

            if (this.__storeDiscoveryLocked) {
                const result = {
                    ok: false,
                    locked: true,
                    rediscovered: false,
                    currentCheck,
                    reason: "store discovery already locked",
                };

                this.__visibleMessagesVerificationDone = true;
                this.__lastVisibleMessagesVerificationResult = result;

                return result;
            }

            this.clearStore();
            this.__lastError = null;

            const rediscovered = this.discoverNow();

            const nextNodeCount = getStoreNodeCount(this.__store);
            const nextCheck = this.__store
                ? candidateStoreCanResolveVisibleNewestNode(this.__store)
                : { ok: false, reason: "store not registered after rediscovery" };

            if (nextCheck.ok) {
                this.lockStoreDiscovery(`${reason}:rediscovered-store-resolves-visible-newest`);
            } else if (nextNodeCount > 1) {
                this.lockStoreDiscovery(`${reason}:rediscovered-hydrated-store`);
            }

            const result = {
                ok: Boolean(nextCheck.ok || nextNodeCount > 1),
                locked: Boolean(this.__storeDiscoveryLocked),
                rediscovered,
                currentCheck,
                nextCheck,
                nodeCount: nextNodeCount,
            };

            this.__visibleMessagesVerificationDone = true;
            this.__lastVisibleMessagesVerificationResult = result;

            return result;
        },

        installStoreProfiler() {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

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

            const EXPLICIT_PROFILE_METHODS = [
                "setCurrentLeafId",
                "messageIdToNodeId",
                "messageIdToExistingNodeId",
                "containsNodeOrMessageId",
                "getAlderItemForMessageId",
                "getNodeByIdOrMessageId",
                "getNodeIfExists",
                "findNode",
                "findNodeFromLeaf",
                "findFirst",
                "findFirstFromLeaf",
                "findFirstFromLeafToParent",
                "hasMessageWithPredicate",
                "getLeafFromNode",
                "getDescendants",
                "getParent",
                "getBranch",
                "getBranchFromLeaf",
                "selectParagenVariant",
                "getDisplayItems",
                "getDisplayTurns",
                "addMessageNode",
                "addOptimisticMessageNode",
                "prependNode",
                "prependOptismisticNode",
                "deleteNode",
                "moveNode",
                "clearNodeMessageParts",
                "updateNodeMetadata",
                "updateNodeMessage",
                "updateNodeMessageMetadata",
                "processUpdate",
                "optimisticDiscardAfter",
                "prettyPrint",
            ];

            const methodNames = Array.from(
                new Set([
                    ...EXPLICIT_PROFILE_METHODS,
                    ...Object.keys(store),
                    ...Object.getOwnPropertyNames(Object.getPrototypeOf(store) || {}),
                ])
            ).filter((methodName) => {
                if (EXCLUDED_PROFILE_METHODS.has(methodName)) return false;
                return typeof store[methodName] === "function";
            });

            this.__storeProfile = {
                installedAt: Date.now(),
                clearedAt: null,
                methods: {},
            };

            this.__storeProfilerOriginals = {};

            for (const methodName of methodNames) {
                const original = store[methodName];

                if (typeof original !== "function") continue;

                this.__storeProfile.methods[methodName] = createEmptyMethodProfile();
                this.__storeProfilerOriginals[methodName] = original;

                const bridgeRef = this;
                const shouldCaptureCallSite =
                    ENABLE_NODE_CALLSITE_STATS &&
                    methodName === "getNodeByIdOrMessageId";

                store[methodName] = function profiledStoreMethod(...args) {
                    const startedAt = performance.now();

                    if (shouldCaptureCallSite) {
                        const profile = bridgeRef.__getNodeByIdOrMessageIdCallSites ??= {
                            total: 0,
                            callSites: {},
                            max: 50,
                        };

                        profile.total += 1;

                        const stack = normalizeStack(new Error().stack);
                        const existing = profile.callSites[stack];

                        if (existing) {
                            existing.calls += 1;
                            existing.lastArg = args[0];
                        } else {
                            const keys = Object.keys(profile.callSites);

                            if (keys.length >= profile.max) {
                                const lowest = keys.reduce((a, b) =>
                                    profile.callSites[a].calls < profile.callSites[b].calls ? a : b
                                );
                                delete profile.callSites[lowest];
                            }

                            profile.callSites[stack] = {
                                calls: 1,
                                firstArg: args[0],
                                lastArg: args[0],
                            };
                        }
                    }

                    try {
                        return original.apply(store, args);
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

        installMessageIdIndex({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__messageIdIndexInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.getMessageIdIndexStats(),
                };
            }

            const stats = {
                hits: 0,
                misses: 0,
                fallbackHits: 0,
                activeHits: 0,
                activeMisses: 0,
                cached: 0,
                mode: profiled
                    ? "profiled:lazy-unbounded-stale-plus-active-epoch"
                    : "production:lazy-unbounded-stale-plus-active-epoch",
            };

            const index = new Map();

            this.__messageIdIndex = index;
            this.__messageIdIndexStats = stats;

            const result = installStoreMethodWrapper({
                bridge: this,
                methodName: "messageIdToExistingNodeId",
                originalSlot: "__messageIdIndexOriginal",
                installedFlag: "__messageIdIndexInstalled",
                createWrapper: ({ store, original, bridge }) => {
                    const getCurrentLeafId = createCurrentLeafIdReader(store);

                    let activeEpoch = -1;
                    let activeKey = null;
                    let activeValue = null;

                    function remember(key, value) {
                        if (!key || !value) return;

                        index.set(key, value);

                        if (value !== key) {
                            index.set(value, value);
                        }

                        if (profiled) stats.cached = index.size;
                    }

                    if (profiled) {
                        return function lazyMessageIdToExistingNodeIdProfiled(messageId) {
                            const cached = index.get(messageId);

                            if (cached !== undefined) {
                                stats.hits += 1;
                                return cached;
                            }

                            const currentLeafId = getCurrentLeafId();

                            if (messageId === currentLeafId) {
                                const epoch = bridge.__storeReadEpoch;

                                if (
                                    activeEpoch === epoch &&
                                    activeKey === messageId
                                ) {
                                    stats.activeHits += 1;
                                    return activeValue;
                                }

                                stats.activeMisses += 1;

                                const result = original.call(store, messageId) ?? null;

                                activeEpoch = epoch;
                                activeKey = messageId;
                                activeValue = result;

                                return result;
                            }

                            stats.misses += 1;

                            const result = original.call(store, messageId) ?? null;

                            if (result) {
                                stats.fallbackHits += 1;
                                remember(messageId, result);
                            }

                            return result;
                        };
                    }

                    return function lazyMessageIdToExistingNodeIdProduction(messageId) {
                        const cached = index.get(messageId);
                        if (cached !== undefined) return cached;

                        const currentLeafId = getCurrentLeafId();

                        if (messageId === currentLeafId) {
                            const epoch = bridge.__storeReadEpoch;

                            if (
                                activeEpoch === epoch &&
                                activeKey === messageId
                            ) {
                                return activeValue;
                            }

                            const result = original.call(store, messageId) ?? null;

                            activeEpoch = epoch;
                            activeKey = messageId;
                            activeValue = result;

                            return result;
                        }

                        const result = original.call(store, messageId) ?? null;

                        if (result) {
                            remember(messageId, result);
                        }

                        return result;
                    };
                },
            });

            return {
                ...result,
                indexSize: this.__messageIdIndex?.size ?? 0,
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

            const original =
                typeof this.__messageIdIndexOriginal === "function"
                    ? this.__messageIdIndexOriginal
                    : this.__messageIdIndexOriginal?.messageIdToExistingNodeId;

            if (this.__store && typeof original === "function") {
                this.__store.messageIdToExistingNodeId = original;
            }

            this.__messageIdIndexInstalled = false;
            this.__messageIdIndexOriginal = null;
            this.__messageIdIndex = null;
            this.__messageIdIndexStats = null;

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

        installExistingNodeStableCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__existingNodeStableCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__existingNodeStableCacheStats,
                };
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    cached: 0,
                    activeCached: 0,
                    normalOriginal: 0,
                    normalCached: 0,
                    mode: "profiled:persistent+confirmed-direct-index+live-epoch",
                }
                : {
                    cached: 0,
                    mode: "production:persistent+confirmed-direct-index+live-epoch",
                };

            const frameCache = createPersistentCache({
                stats,
                profiled,
            });

            this.__confirmedExistingNodeIds ??= new Set();
            this.__existingNodeStableCacheApi = frameCache;
            this.__existingNodeStableCache = frameCache.cache;
            this.__existingNodeStableCacheStats = stats;

            const result = installStoreMethodWrapper({
                bridge: this,
                methodName: "getNodeIfExists",
                originalSlot: "__existingNodeStableCacheOriginal",
                installedFlag: "__existingNodeStableCacheInstalled",
                createWrapper: ({ store, original, bridge }) => {
                    const get = frameCache.get;
                    const set = frameCache.set;

                    let activeEpoch = -1;
                    let activeId = null;
                    let activeValue = null;

                    if (profiled) {
                        return function cachedGetNodeIfExistsLiveProfiled(id) {
                            const epoch = bridge.__storeReadEpoch;

                            if (
                                activeEpoch === epoch &&
                                activeId === id
                            ) {
                                stats.activeCached += 1;
                                return activeValue;
                            }

                            const cached = get(id);

                            if (cached !== undefined) {
                                stats.normalCached += 1;

                                activeEpoch = epoch;
                                activeId = id;
                                activeValue = cached;

                                return cached;
                            }

                            stats.normalOriginal += 1;

                            const result =
                                original.call(store, id) ?? null;

                            if (
                                result !== null &&
                                result.message?.status !== "in_progress"
                            ) {
                                set(id, result);
                            }

                            activeEpoch = epoch;
                            activeId = id;
                            activeValue = result;

                            return result;
                        };
                    }

                    return function cachedGetNodeIfExistsLive(id) {
                        const epoch = bridge.__storeReadEpoch;

                        if (
                            activeEpoch === epoch &&
                            activeId === id
                        ) {
                            return activeValue;
                        }

                        const cached = get(id);

                        if (cached !== undefined) {
                            activeEpoch = epoch;
                            activeId = id;
                            activeValue = cached;

                            return cached;
                        }

                        const result =
                            original.call(store, id) ?? null;

                        if (
                            result !== null &&
                            result.message?.status !== "in_progress"
                        ) {
                            set(id, result);
                        }

                        activeEpoch = epoch;
                        activeId = id;
                        activeValue = result;

                        return result;
                    };
                },
            });

            return {
                ...result,
                profiled,
            };
        },

        uninstallExistingNodeStableCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__existingNodeStableCacheOriginal",
                installedFlag: "__existingNodeStableCacheInstalled",
            });
        },

        getExistingNodeStableCacheStats() {
            return getCacheSnapshot(
                this,
                "__existingNodeStableCacheInstalled",
                "__existingNodeStableCache",
                "__existingNodeStableCacheStats"
            );
        },

        installGetNodeByIdOrMessageIdCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__getNodeByIdOrMessageIdCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__getNodeByIdOrMessageIdCacheStats,
                };
            }

            const original = getStoreMethod(store, "getNodeByIdOrMessageId");

            if (!original) {
                return unavailable("getNodeByIdOrMessageId unavailable");
            }

            const nodeCache = this.ensureNodeObjectCache({ profiled });

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    writes: 0,
                    nullWrites: 0,
                    liveBypasses: 0,
                    inProgressBypasses: 0,
                    cached: 0,
                    mode: "profiled:id-alias-cache+shared-node-cache:stable-only",
                }
                : {
                    cached: 0,
                    mode: "production:id-alias-cache+shared-node-cache:stable-only",
                };

            const aliasCache = createPersistentCache({
                stats,
                profiled,
            });

            this.__getNodeByIdOrMessageIdCache = aliasCache.cache;
            this.__getNodeByIdOrMessageIdCacheStats = stats;

            function readCurrentLeafId() {
                return typeof store.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store.currentLeafId;
            }

            function getCachedNode(id) {
                const cachedNodeId = aliasCache.get(id);

                if (cachedNodeId === undefined) {
                    return undefined;
                }

                if (cachedNodeId === null) {
                    return null;
                }

                return nodeCache
                    ? nodeCache.resolve(cachedNodeId)
                    : getNodeDirect(store, cachedNodeId);
            }

            function remember(id, node) {
                if (!id) return node ?? null;

                if (!node?.id) {
                    aliasCache.set(id, null);

                    if (profiled) {
                        stats.writes += 1;
                        stats.nullWrites += 1;
                        stats.cached = aliasCache.cache.size;
                    }

                    return null;
                }

                if (nodeCache) {
                    nodeCache.set(node.id, node);
                }

                aliasCache.set(id, node.id);

                if (node.id !== id) {
                    aliasCache.set(node.id, node.id);
                }

                if (profiled) {
                    stats.writes += 1;
                    stats.cached = aliasCache.cache.size;
                }

                return node;
            }

            const result = installStoreMethodWrapper({
                bridge: this,
                methodName: "getNodeByIdOrMessageId",
                originalSlot: "__getNodeByIdOrMessageIdCacheOriginal",
                installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
                createWrapper: ({ store, original }) => {
                    if (profiled) {
                        return function cachedGetNodeByIdOrMessageIdProfiled(id) {
                            if (!id) {
                                return original.call(store, id) ?? null;
                            }

                            const currentLeafId = readCurrentLeafId();

                            if (id === currentLeafId) {
                                stats.liveBypasses += 1;
                                return original.call(store, id) ?? null;
                            }

                            const cached = getCachedNode(id);

                            if (cached !== undefined) {
                                stats.hits += 1;
                                return cached;
                            }

                            stats.misses += 1;

                            const result =
                                original.call(store, id) ?? null;

                            if (result?.message?.status === "in_progress") {
                                stats.inProgressBypasses += 1;
                                return result;
                            }

                            return remember(id, result);
                        };
                    }

                    return function cachedGetNodeByIdOrMessageIdProduction(id) {
                        if (!id) {
                            return original.call(store, id) ?? null;
                        }

                        if (id === readCurrentLeafId()) {
                            return original.call(store, id) ?? null;
                        }

                        const cached = getCachedNode(id);

                        if (cached !== undefined) {
                            return cached;
                        }

                        const result =
                            original.call(store, id) ?? null;

                        if (result?.message?.status === "in_progress") {
                            return result;
                        }

                        return remember(id, result);
                    };
                },
            });

            return {
                ...result,
                profiled,
            };
        },

        uninstallGetNodeByIdOrMessageIdCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                originalSlot: "__getNodeByIdOrMessageIdCacheOriginal",
                installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
            });
        },

        getGetNodeByIdOrMessageIdCacheStats() {
            return getCacheSnapshot(
                this,
                "__getNodeByIdOrMessageIdCacheInstalled",
                "__getNodeByIdOrMessageIdCache",
                "__getNodeByIdOrMessageIdCacheStats"
            );
        },

        installFindNodeFromLeafFrameCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) {
                return unavailable("store not registered");
            }

            if (this.__findNodeFromLeafFrameCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__findNodeFromLeafFrameCacheStats,
                };
            }

            const original = getStoreMethod(store, "findNodeFromLeaf");

            if (!original) {
                return unavailable("findNodeFromLeaf unavailable");
            }

            const resultCache = new Map();
            const nodeCache = this.ensureNodeObjectCache({ profiled });

            const stats = profiled
                ? {
                    hits: 0,
                    rejected: 0,
                    writes: 0,
                    ancestorFastHits: 0,
                    ancestorFastMisses: 0,
                    originalCalls: 0,
                    nullResults: 0,
                    invalidCalls: 0,
                    cached: 0,
                    mode: "profiled:name-result-cache+validated+ancestor-fast-path-depth-2",
                }
                : {
                    cached: 0,
                    mode: "production:name-result-cache+validated+ancestor-fast-path-depth-2",
                };

            this.__findNodeFromLeafFrameCacheOriginal = {
                findNodeFromLeaf: original,
            };
            this.__findNodeFromLeafFrameCache = resultCache;
            this.__findNodeFromLeafFrameCacheStats = stats;

            function getPredicateNameKey(predicateFn) {
                return predicateFn.name || "<anon>";
            }

            function getCachedResult(predicateFn, key) {
                if (!resultCache.has(key)) {
                    return undefined;
                }

                const cached = resultCache.get(key);

                if (cached === null) {
                    return null;
                }

                return predicateFn(cached)
                    ? cached
                    : CACHE_MISS;
            }

            function findNearLeaf(predicateFn, leafId) {
                let node = nodeCache ? nodeCache.resolve(leafId) : getNodeDirect(store, leafId);

                for (let depth = 0; node && depth <= 2; depth += 1) {
                    if (predicateFn(node)) {
                        return node;
                    }

                    node = nodeCache
                        ? nodeCache.resolve(node.parentId)
                        : getNodeDirect(store, node.parentId);
                }

                return undefined;
            }

            if (profiled) {
                store.findNodeFromLeaf = function cachedFindNodeFromLeafProfiled(
                    predicateFn,
                    leafId,
                    ...rest
                ) {
                    if (
                        typeof predicateFn !== "function" ||
                        !leafId
                    ) {
                        stats.invalidCalls += 1;
                        stats.originalCalls += 1;

                        return original.call(
                            store,
                            predicateFn,
                            leafId,
                            ...rest
                        );
                    }

                    const key = getPredicateNameKey(predicateFn);
                    const cached = getCachedResult(predicateFn, key);

                    if (cached !== undefined) {
                        if (cached === CACHE_MISS) {
                            stats.rejected += 1;
                        } else {
                            stats.hits += 1;
                            return cached;
                        }
                    }

                    const nearLeaf = findNearLeaf(predicateFn, leafId);

                    if (nearLeaf !== undefined) {
                        stats.ancestorFastHits += 1;
                        resultCache.set(key, nearLeaf);
                        stats.writes += 1;
                        stats.cached = resultCache.size;
                        return nearLeaf;
                    }

                    stats.ancestorFastMisses += 1;
                    stats.originalCalls += 1;

                    const result =
                        original.call(
                            store,
                            predicateFn,
                            leafId,
                            ...rest
                        ) ?? null;

                    if (result === null) {
                        stats.nullResults += 1;
                    }

                    resultCache.set(key, result);
                    stats.writes += 1;
                    stats.cached = resultCache.size;

                    return result;
                };
            } else {
                store.findNodeFromLeaf = function cachedFindNodeFromLeafProduction(
                    predicateFn,
                    leafId,
                    ...rest
                ) {
                    if (
                        typeof predicateFn !== "function" ||
                        !leafId
                    ) {
                        return original.call(
                            store,
                            predicateFn,
                            leafId,
                            ...rest
                        );
                    }

                    const key = getPredicateNameKey(predicateFn);
                    const cached = getCachedResult(predicateFn, key);

                    if (cached !== undefined && cached !== CACHE_MISS) {
                        return cached;
                    }

                    const nearLeaf = findNearLeaf(predicateFn, leafId);

                    if (nearLeaf !== undefined) {
                        resultCache.set(key, nearLeaf);
                        return nearLeaf;
                    }

                    const result =
                        original.call(
                            store,
                            predicateFn,
                            leafId,
                            ...rest
                        ) ?? null;

                    resultCache.set(key, result);

                    return result;
                };
            }

            this.__findNodeFromLeafFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                profiled,
                stats,
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
            return getCacheSnapshot(
                this,
                "__findNodeFromLeafFrameCacheInstalled",
                "__findNodeFromLeafFrameCache",
                "__findNodeFromLeafFrameCacheStats"
            );
        },

        installGetLeafFromNodeFrameCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__getLeafFromNodeFrameCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__getLeafFromNodeFrameCacheStats,
                };
            }

            const stats = profiled
                ? {
                    hits: 0,
                    misses: 0,
                    cached: 0,
                    activeLeafEpochHits: 0,
                    activeLeafEpochMisses: 0,
                    descendantHits: 0,
                    descendantWrites: 0,
                    descendantMissHits: 0,
                    descendantMissWrites: 0,
                    directWalks: 0,
                    directWalkReturns: 0,
                    originalCalls: 0,
                    nullResults: 0,
                    mode: "profiled:persistent+active-leaf-epoch+descendant-direct+shared-node-cache",
                }
                : {
                    cached: 0,
                    mode: "production:persistent+active-leaf-epoch+descendant-direct+shared-node-cache",
                };

            const frameCache = createPersistentCache({
                stats,
                profiled,
            });

            const nodeCache = this.ensureNodeObjectCache({ profiled });

            this.__getLeafFromNodeFrameCache = frameCache.cache;
            this.__getLeafFromNodeFrameCacheStats = stats;

            const leafDescendantCache = new Map();
            this.__leafDescendantCache = leafDescendantCache;

            const leafDescendantMissCache = new Set();
            this.__leafDescendantMissCache = leafDescendantMissCache;

            const get = frameCache.get;
            const set = frameCache.set;

            let activeLeafEpoch = -1;
            let activeLeafKey = null;
            let activeLeafValue = null;

            function normalizeLeafInputKey(id) {
                return typeof id === "string" ||
                    typeof id === "number" ||
                    typeof id === "boolean" ||
                    id == null
                    ? id
                    : id.id ?? id.nodeId ?? id.message?.id ?? id;
            }

            function readCurrentLeafId() {
                return typeof store.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store.currentLeafId;
            }

            function resolveNode(id) {
                return nodeCache
                    ? nodeCache.resolve(id)
                    : getNodeDirect(store, id);
            }

            function tryDirectLeafWalk(key) {
                let node = resolveNode(key);

                if (!node || node.message?.status === "in_progress") {
                    return null;
                }

                let leaf = node;
                let guard = 0;

                while (
                    leaf &&
                    Array.isArray(leaf.children) &&
                    leaf.children.length > 0 &&
                    guard < 2000
                ) {
                    const childId = leaf.children[0];
                    const next = resolveNode(childId);

                    if (!next || next === leaf) break;

                    leaf = next;
                    guard += 1;
                }

                if (!leaf?.id || leaf.message?.status === "in_progress") {
                    return null;
                }

                return leaf;
            }

            function rememberLeaf(key, leaf) {
                set(key, leaf);

                if (leaf?.id && leaf.id !== key) {
                    set(leaf.id, leaf);
                }

                if (nodeCache && leaf?.id) {
                    nodeCache.set(leaf.id, leaf);
                }

                return leaf;
            }

            const result = installStoreMethodWrapper({
                bridge: this,
                methodName: "getLeafFromNode",
                originalSlot: "__getLeafFromNodeFrameCacheOriginal",
                installedFlag: "__getLeafFromNodeFrameCacheInstalled",
                createWrapper: ({ store, original, bridge }) => {
                    if (profiled) {
                        return function cachedGetLeafFromNodeProfiled(id) {
                            const key = normalizeLeafInputKey(id);

                            if (!key) {
                                stats.originalCalls += 1;
                                return original.call(store, id) ?? null;
                            }

                            if (key === readCurrentLeafId()) {
                                const epoch = bridge.__storeReadEpoch;

                                if (
                                    activeLeafEpoch === epoch &&
                                    activeLeafKey === key &&
                                    activeLeafValue !== null
                                ) {
                                    stats.activeLeafEpochHits += 1;
                                    return activeLeafValue;
                                }

                                stats.activeLeafEpochMisses += 1;
                            }

                            const cached = get(key);
                            if (cached !== undefined) return cached;

                            const descendantCached = leafDescendantCache.get(key);

                            if (descendantCached !== undefined) {
                                stats.descendantHits += 1;
                                return rememberLeaf(key, descendantCached);
                            }

                            if (leafDescendantMissCache.has(key)) {
                                stats.descendantMissHits += 1;
                                stats.originalCalls += 1;

                                const result = original.call(store, id) ?? null;

                                if (result === null) {
                                    stats.nullResults += 1;
                                }

                                const leafId = result?.id ?? null;

                                if (leafId && leafId !== key) {
                                    leafDescendantCache.set(key, result);
                                    leafDescendantMissCache.delete(key);
                                    stats.descendantWrites += 1;
                                }

                                return rememberLeaf(key, result);
                            }

                            stats.directWalks += 1;

                            const directLeaf = tryDirectLeafWalk(key);

                            if (directLeaf) {
                                stats.directWalkReturns += 1;
                                stats.descendantWrites += 1;

                                leafDescendantCache.set(key, directLeaf);

                                if (key === readCurrentLeafId()) {
                                    activeLeafEpoch = bridge.__storeReadEpoch;
                                    activeLeafKey = key;
                                    activeLeafValue = directLeaf;
                                }

                                return rememberLeaf(key, directLeaf);
                            }

                            leafDescendantMissCache.add(key);
                            stats.descendantMissWrites += 1;
                            stats.originalCalls += 1;

                            const result = original.call(store, id) ?? null;

                            if (result === null) {
                                stats.nullResults += 1;
                            }

                            const leafId = result?.id ?? null;

                            if (leafId && leafId !== key) {
                                leafDescendantCache.set(key, result);
                                leafDescendantMissCache.delete(key);
                                stats.descendantWrites += 1;
                            }

                            if (key === readCurrentLeafId()) {
                                activeLeafEpoch = bridge.__storeReadEpoch;
                                activeLeafKey = key;
                                activeLeafValue = result;
                            }

                            return rememberLeaf(key, result);
                        };
                    }

                    return function cachedGetLeafFromNodeProduction(id) {
                        const key = normalizeLeafInputKey(id);

                        if (!key) {
                            return original.call(store, id) ?? null;
                        }

                        if (key === readCurrentLeafId()) {
                            const epoch = bridge.__storeReadEpoch;

                            if (
                                activeLeafEpoch === epoch &&
                                activeLeafKey === key &&
                                activeLeafValue !== null
                            ) {
                                return activeLeafValue;
                            }
                        }

                        const cached = get(key);
                        if (cached !== undefined) return cached;

                        const descendantCached = leafDescendantCache.get(key);

                        if (descendantCached !== undefined) {
                            return rememberLeaf(key, descendantCached);
                        }

                        if (!leafDescendantMissCache.has(key)) {
                            const directLeaf = tryDirectLeafWalk(key);

                            if (directLeaf) {
                                leafDescendantCache.set(key, directLeaf);

                                if (key === readCurrentLeafId()) {
                                    activeLeafEpoch = bridge.__storeReadEpoch;
                                    activeLeafKey = key;
                                    activeLeafValue = directLeaf;
                                }

                                return rememberLeaf(key, directLeaf);
                            }

                            leafDescendantMissCache.add(key);
                        }

                        const result = original.call(store, id) ?? null;

                        const leafId = result?.id ?? null;

                        if (leafId && leafId !== key) {
                            leafDescendantCache.set(key, result);
                            leafDescendantMissCache.delete(key);
                        }

                        if (key === readCurrentLeafId()) {
                            activeLeafEpoch = bridge.__storeReadEpoch;
                            activeLeafKey = key;
                            activeLeafValue = result;
                        }

                        return rememberLeaf(key, result);
                    };
                },
            });

            return {
                ...result,
                profiled,
                stats,
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
            return getCacheSnapshot(
                this,
                "__getLeafFromNodeFrameCacheInstalled",
                "__getLeafFromNodeFrameCache",
                "__getLeafFromNodeFrameCacheStats"
            );
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
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__branchCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__branchCacheStats,
                };
            }

            const getBranchOriginal = getStoreMethod(store, "getBranch");
            const getBranchFromLeafOriginal = getStoreMethod(store, "getBranchFromLeaf");

            const originals = {};

            if (getBranchOriginal) {
                originals.getBranch = getBranchOriginal;
            }

            if (getBranchFromLeafOriginal) {
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
                    mode: "profiled:persistent:getBranch",
                }
                : {
                    mode: "production:persistent:getBranch",
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
                    mode: "profiled:persistent:getBranchFromLeaf",
                }
                : {
                    mode: "production:persistent:getBranchFromLeaf",
                };

            const getBranchCache = createPersistentCache({
                stats: getBranchStats,
                profiled,
            });

            const getBranchFromLeafCache = createPersistentCache({
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
                const getBranchGet = getBranchCache.get;
                const getBranchSet = getBranchCache.set;
                const recordBranchCallSite = ENABLE_BRANCH_CALLSITE_STATS
                    ? bridgeRef.recordBranchCallSite.bind(bridgeRef)
                    : null;

                store.getBranch = function cachedGetBranch(id, ...rest) {
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
                    store.getBranchFromLeaf = function cachedGetBranchFromLeafProfiled(id, ...rest) {
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
                    const getBranchFromLeafGet = getBranchFromLeafCache.get;
                    const getBranchFromLeafSet = getBranchFromLeafCache.set;

                    store.getBranchFromLeaf = function cachedGetBranchFromLeafProduction(id, ...rest) {
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
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__resolvedNodeFrameCacheInstalled) {
                return { ok: true, alreadyInstalled: true };
            }

            const stats = createCacheStats(
                profiled,
                {
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
                    mode: "profiled:persistent-id-alias+shared-node-cache",

                    inputSamples: [],
                    resultSamples: [],
                },
                {
                    cached: 0,
                    mode: "production:persistent-id-alias+shared-node-cache",
                }
            );

            const aliasCache = createPersistentCache({
                stats,
                profiled,
            });

            const nodeCache = this.ensureNodeObjectCache({ profiled });

            this.__resolvedNodeFrameCache = aliasCache.cache;
            this.__resolvedNodeFrameCacheStats = stats;

            const bridgeRef = this;

            function classifyInput(id) {
                if (typeof id === "string") {
                    if (id.startsWith("client-") || /^[0-9a-f-]{20,}$/i.test(id)) {
                        return "node";
                    }

                    return "message";
                }

                return "unknown";
            }

            function remember(inputId, node) {
                if (node?.id) {
                    if (nodeCache) {
                        nodeCache.set(node.id, node);
                    }

                    aliasCache.set(inputId, node.id);

                    if (node.id !== inputId) {
                        aliasCache.set(node.id, node.id);

                        if (profiled) {
                            stats.dualKeyWrites += 1;
                        }
                    }

                    if (profiled) {
                        stats.nodeWrites += 1;
                        stats.resolvedNodeIds += 1;
                    }

                    return node;
                }

                aliasCache.set(inputId, null);

                if (profiled) {
                    stats.nullWrites += 1;
                }

                return null;
            }

            function getCachedResolvedNode(id) {
                const cachedNodeId = aliasCache.get(id);

                if (cachedNodeId === undefined) {
                    return undefined;
                }

                if (cachedNodeId === null) {
                    return null;
                }

                return nodeCache
                    ? nodeCache.resolve(cachedNodeId)
                    : getNodeDirect(store, cachedNodeId);
            }

            if (profiled) {
                this.__resolveNodeFast = function resolveNodeFastProfiled(id) {
                    stats.calls += 1;

                    const inputType = classifyInput(id);

                    if (inputType === "node") {
                        stats.nodeIdInputs += 1;
                    } else if (inputType === "message") {
                        stats.messageIdInputs += 1;
                    } else {
                        stats.unknownInputs += 1;
                    }

                    const cached = getCachedResolvedNode(id);

                    if (cached !== undefined) {
                        stats.hits += 1;

                        if (cached === null) {
                            stats.nullHits += 1;
                        } else {
                            stats.nodeHits += 1;
                        }

                        return cached;
                    }

                    stats.misses += 1;

                    const node = resolveNodeCore(bridgeRef, id);

                    if (stats.inputSamples.length < 20) {
                        stats.inputSamples.push({
                            id,
                            inputType,
                        });
                    }

                    if (stats.resultSamples.length < 20) {
                        stats.resultSamples.push({
                            input: id,
                            resultId: node?.id ?? null,
                            resultType: node ? typeof node : null,
                            keys: node && typeof node === "object"
                                ? Object.keys(node).slice(0, 20)
                                : null,
                        });
                    }

                    return remember(id, node);
                };
            } else {
                this.__resolveNodeFast = function resolveNodeFastProduction(id) {
                    const cached = getCachedResolvedNode(id);

                    if (cached !== undefined) {
                        return cached;
                    }

                    const node = resolveNodeCore(bridgeRef, id);

                    return remember(id, node);
                };
            }

            this.__resolvedNodeFrameCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: ["resolveNodeFast"],
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
            return getCacheSnapshot(
                this,
                "__resolvedNodeFrameCacheInstalled",
                "__resolvedNodeFrameCache",
                "__resolvedNodeFrameCacheStats"
            );
        },

        installFindNodeCallSiteProfiler({
            maxCallSites = 50,
            sampleEvery = 100,
            maxPredicateSourcesPerSite = 10,
            predicateSourcePreviewLength = 500,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__findNodeCallSiteProfilerInstalled) {
                return { ok: true, alreadyInstalled: true };
            }

            const original = getStoreMethod(store, "findNode");
            if (!original) return unavailable("findNode unavailable");

            const bridgeRef = this;

            const stats = {
                installedAt: Date.now(),
                totalCalls: 0,
                sampledCalls: 0,
                maxCallSites,
                sampleEvery,
                maxPredicateSourcesPerSite,
                predicateSourcePreviewLength,
                callSites: {},
            };

            function normalizeFindNodeStack(stack) {
                if (!stack || typeof stack !== "string") return "unknown";

                return stack
                    .split("\n")
                    .slice(2, 10)
                    .map((line) =>
                        line
                            .trim()
                            .replace(window.location.origin, "")
                            .replace(/:\d+:\d+/g, ":<line>:<col>")
                    )
                    .join("\n");
            }

            function getPredicateSourcePreview(value) {
                if (typeof value !== "function") return null;

                try {
                    return Function.prototype.toString
                        .call(value)
                        .slice(0, predicateSourcePreviewLength);
                } catch (error) {
                    return `[[Function#toString failed: ${String(error?.message || error)}]]`;
                }
            }

            function recordPredicateSource(entry, source, now, cacheEvent) {
                if (!source) return;

                const sources = entry.predicateSources ??= {};
                let sourceEntry = sources[source];

                if (sourceEntry) {
                    sourceEntry.calls += 1;
                    sourceEntry.lastSeenAt = now;
                } else {
                    const keys = Object.keys(sources);

                    if (keys.length >= maxPredicateSourcesPerSite) {
                        const lowest = keys.reduce((a, b) =>
                            sources[a].calls < sources[b].calls ? a : b
                        );

                        delete sources[lowest];
                    }

                    sourceEntry = sources[source] = {
                        calls: 1,
                        firstSeenAt: now,
                        lastSeenAt: now,
                        cacheHits: 0,
                        cacheMisses: 0,
                        cacheStaleHits: 0,
                        cacheWrites: 0,
                        cacheUnknown: 0,
                    };
                }

                if (cacheEvent?.type === "hit") sourceEntry.cacheHits += 1;
                else if (cacheEvent?.type === "miss") sourceEntry.cacheMisses += 1;
                else if (cacheEvent?.type === "stale-hit") sourceEntry.cacheStaleHits += 1;
                else if (cacheEvent?.type === "write") sourceEntry.cacheWrites += 1;
                else sourceEntry.cacheUnknown += 1;
            }

            store.findNode = function profiledFindNodeCallSite(...args) {
                stats.totalCalls += 1;

                const sampleThisCall = (stats.totalCalls % sampleEvery) === 0;
                let beforeCacheSeq = bridgeRef.__findNodePredicateCacheEventSeq || 0;

                const result = original.apply(store, args);

                if (sampleThisCall) {
                    stats.sampledCalls += 1;

                    const now = Date.now();
                    const stack = normalizeFindNodeStack(new Error().stack);
                    const predicateSource = getPredicateSourcePreview(args[0]);

                    const afterCacheEvent = bridgeRef.__lastFindNodePredicateCacheEvent || null;
                    const afterCacheSeq = bridgeRef.__findNodePredicateCacheEventSeq || 0;
                    const cacheEvent =
                        afterCacheSeq !== beforeCacheSeq ? afterCacheEvent : null;

                    let entry = stats.callSites[stack];

                    if (entry) {
                        entry.calls += 1;
                        entry.lastArgType = typeof args[0];
                        entry.lastSeenAt = now;
                    } else {
                        const keys = Object.keys(stats.callSites);

                        if (keys.length >= maxCallSites) {
                            const lowest = keys.reduce((a, b) =>
                                stats.callSites[a].calls < stats.callSites[b].calls ? a : b
                            );

                            delete stats.callSites[lowest];
                        }

                        entry = stats.callSites[stack] = {
                            calls: 1,
                            firstArgType: typeof args[0],
                            lastArgType: typeof args[0],
                            firstSeenAt: now,
                            lastSeenAt: now,
                            cacheHits: 0,
                            cacheMisses: 0,
                            cacheStaleHits: 0,
                            cacheWrites: 0,
                            cacheUnknown: 0,
                            predicateSources: {},
                        };
                    }

                    if (cacheEvent?.type === "hit") entry.cacheHits += 1;
                    else if (cacheEvent?.type === "miss") entry.cacheMisses += 1;
                    else if (cacheEvent?.type === "stale-hit") entry.cacheStaleHits += 1;
                    else if (cacheEvent?.type === "write") entry.cacheWrites += 1;
                    else entry.cacheUnknown += 1;

                    recordPredicateSource(entry, predicateSource, now, cacheEvent);
                }

                return result;
            };

            this.__findNodeCallSiteProfilerInstalled = true;
            this.__findNodeCallSiteProfilerOriginal = original;
            this.__findNodeCallSiteProfilerStats = stats;

            return {
                ok: true,
                installed: true,
                method: "findNode",
                sampleEvery,
                maxCallSites,
                maxPredicateSourcesPerSite,
            };
        },

        uninstallFindNodeCallSiteProfiler() {
            if (!this.__findNodeCallSiteProfilerInstalled) {
                return { ok: true, alreadyUninstalled: true };
            }

            if (
                this.__store &&
                typeof this.__findNodeCallSiteProfilerOriginal === "function"
            ) {
                this.__store.findNode = this.__findNodeCallSiteProfilerOriginal;
            }

            this.__findNodeCallSiteProfilerInstalled = false;
            this.__findNodeCallSiteProfilerOriginal = null;

            return { ok: true, uninstalled: true };
        },

        clearFindNodeCallSiteProfilerStats() {
            const stats = this.__findNodeCallSiteProfilerStats;

            if (!stats) {
                return { ok: false, reason: "findNode call-site profiler not installed" };
            }

            stats.totalCalls = 0;
            stats.sampledCalls = 0;
            stats.callSites = {};
            stats.installedAt = Date.now();

            return { ok: true };
        },

        getFindNodeCallSiteProfilerStats() {
            const stats = this.__findNodeCallSiteProfilerStats;

            if (!stats) {
                return {
                    installed: false,
                    totalCalls: 0,
                    sampledCalls: 0,
                    topCallSites: [],
                };
            }

            return {
                installed: this.__findNodeCallSiteProfilerInstalled,
                installedAt: stats.installedAt,
                totalCalls: stats.totalCalls,
                sampledCalls: stats.sampledCalls,
                sampleEvery: stats.sampleEvery,
                maxCallSites: stats.maxCallSites,
                maxPredicateSourcesPerSite: stats.maxPredicateSourcesPerSite,
                topCallSites: Object.entries(stats.callSites)
                    .map(([stack, data]) => {
                        const cacheObserved =
                            data.cacheHits +
                            data.cacheMisses +
                            data.cacheStaleHits +
                            data.cacheWrites;

                        const topPredicateSources = Object.entries(data.predicateSources || {})
                            .map(([source, sourceData]) => {
                                const sourceObserved =
                                    sourceData.cacheHits +
                                    sourceData.cacheMisses +
                                    sourceData.cacheStaleHits +
                                    sourceData.cacheWrites;

                                return {
                                    source,
                                    calls: sourceData.calls,
                                    firstSeenAt: sourceData.firstSeenAt,
                                    lastSeenAt: sourceData.lastSeenAt,
                                    cacheHits: sourceData.cacheHits,
                                    cacheMisses: sourceData.cacheMisses,
                                    cacheStaleHits: sourceData.cacheStaleHits,
                                    cacheWrites: sourceData.cacheWrites,
                                    cacheUnknown: sourceData.cacheUnknown,
                                    cacheHitRate:
                                        sourceObserved > 0
                                            ? sourceData.cacheHits / sourceObserved
                                            : 0,
                                };
                            })
                            .sort((a, b) => b.calls - a.calls)
                            .slice(0, stats.maxPredicateSourcesPerSite);

                        return {
                            stack,
                            calls: data.calls,
                            firstArgType: data.firstArgType,
                            lastArgType: data.lastArgType,
                            firstSeenAt: data.firstSeenAt,
                            lastSeenAt: data.lastSeenAt,
                            cacheHits: data.cacheHits,
                            cacheMisses: data.cacheMisses,
                            cacheStaleHits: data.cacheStaleHits,
                            cacheWrites: data.cacheWrites,
                            cacheUnknown: data.cacheUnknown,
                            cacheHitRate:
                                cacheObserved > 0
                                    ? data.cacheHits / cacheObserved
                                    : 0,
                            uniquePredicateSourceCount: Object.keys(data.predicateSources || {}).length,
                            topPredicateSources,
                        };
                    })
                    .sort((a, b) => b.calls - a.calls)
                    .slice(0, 20),
            };
        },

        installFindNodePredicateCache({
            profiled = ENABLE_CACHE_PROFILING,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (this.__findNodePredicateCacheInstalled) {
                return {
                    ok: true,
                    alreadyInstalled: true,
                    stats: this.__findNodePredicateCacheStats,
                };
            }

            const original = getStoreMethod(store, "findNode");
            if (!original) return unavailable("findNode unavailable");

            const cache = new Map();

            const fnToString = Function.prototype.toString;
            const SOURCE_KEY_LEN = 160;

            let lastPredicateFn = null;
            let lastPredicateSourceKey = null;

            let activeEpoch = -1;
            let activeKey = null;
            let activeValue = null;

            const stats = profiled
                ? {
                    calls: 0,
                    hits: 0,
                    misses: 0,
                    staleHits: 0,
                    invalidPredicate: 0,
                    writes: 0,
                    activeEpochHits: 0,
                    activeEpochMisses: 0,
                    cached: 0,
                    mode: "profiled:findNode-predicate-positive-result-cache+epoch-throttle",
                }
                : {
                    cached: 0,
                    mode: "production:findNode-predicate-positive-result-cache+epoch-throttle",
                };

            const bridgeRef = this;

            bridgeRef.__storeReadEpoch = 0;

            function readCurrentLeafId() {
                return typeof store.currentLeafId === "function"
                    ? store.currentLeafId()
                    : store.currentLeafId;
            }

            function getCurrentStoreReadEpoch() {
                return bridgeRef.__storeReadEpoch;
            }

            function getPredicateSourceKey(predicateFn) {
                if (predicateFn === lastPredicateFn) {
                    return lastPredicateSourceKey;
                }

                const source = fnToString.call(predicateFn);
                const key =
                    source.length <= SOURCE_KEY_LEN
                        ? source
                        : (" " + source.slice(0, SOURCE_KEY_LEN)).slice(1);

                lastPredicateFn = predicateFn;
                lastPredicateSourceKey = key;

                return key;
            }

            function makeKey(leafId, predicateSourceKey) {
                return leafId + "::" + predicateSourceKey;
            }

            function recordFindNodePredicateCacheEvent(type, key = null, nodeId = null) {
                bridgeRef.__findNodePredicateCacheEventSeq =
                    (bridgeRef.__findNodePredicateCacheEventSeq || 0) + 1;

                bridgeRef.__lastFindNodePredicateCacheEvent = {
                    type,
                    key,
                    nodeId,
                    epoch: getCurrentStoreReadEpoch(),
                    at: Date.now(),
                };
            }

            function rememberProduction(key, node) {
                if (!node?.id) return;
                cache.set(key, node.id);
            }

            function rememberProfiled(key, node) {
                if (!node?.id) return;

                cache.set(key, node.id);

                stats.writes += 1;
                stats.cached = cache.size;

                recordFindNodePredicateCacheEvent("write", key, node.id);
            }

            function getCachedNodeProduction(key, predicateFn) {
                const nodeId = cache.get(key);
                if (nodeId === undefined) return undefined;

                const node = getNodeDirect(store, nodeId);

                if (node && predicateFn.call(store, node)) {
                    return node;
                }

                cache.delete(key);
                return undefined;
            }

            function getCachedNodeProfiled(key, predicateFn) {
                const nodeId = cache.get(key);
                if (nodeId === undefined) return undefined;

                const node = getNodeDirect(store, nodeId);

                if (node && predicateFn.call(store, node)) {
                    stats.hits += 1;
                    recordFindNodePredicateCacheEvent("hit", key, nodeId);
                    return node;
                }

                cache.delete(key);

                stats.staleHits += 1;
                stats.cached = cache.size;

                recordFindNodePredicateCacheEvent("stale-hit", key, nodeId);

                return undefined;
            }

            function callOriginalWithEpochThrottleProduction(key, predicateFn) {
                const epoch = getCurrentStoreReadEpoch();

                if (activeEpoch === epoch && activeKey === key) {
                    return activeValue;
                }

                const result = original.call(store, predicateFn) ?? null;

                activeEpoch = epoch;
                activeKey = key;
                activeValue = result;

                return result;
            }

            function callOriginalWithEpochThrottleProfiled(key, predicateFn) {
                const epoch = getCurrentStoreReadEpoch();

                if (activeEpoch === epoch && activeKey === key) {
                    stats.activeEpochHits += 1;

                    recordFindNodePredicateCacheEvent(
                        "active-epoch-hit",
                        key,
                        activeValue?.id ?? null
                    );

                    return activeValue;
                }

                stats.activeEpochMisses += 1;

                const result = original.call(store, predicateFn) ?? null;

                activeEpoch = epoch;
                activeKey = key;
                activeValue = result;

                recordFindNodePredicateCacheEvent(
                    "active-epoch-miss",
                    key,
                    result?.id ?? null
                );

                return result;
            }

            this.__findNodePredicateCache = cache;
            this.__findNodePredicateCacheStats = stats;
            this.__findNodePredicateCacheOriginal = { findNode: original };

            if (profiled) {
                store.findNode = function cachedFindNodePredicateProfiled(predicateFn) {
                    stats.calls += 1;

                    if (typeof predicateFn !== "function") {
                        stats.invalidPredicate += 1;
                        return original.call(store, predicateFn) ?? null;
                    }

                    const leafId = readCurrentLeafId();

                    if (!leafId) {
                        stats.misses += 1;
                        recordFindNodePredicateCacheEvent("miss", null, null);
                        return original.call(store, predicateFn) ?? null;
                    }

                    const sourceKey = getPredicateSourceKey(predicateFn);
                    const key = makeKey(leafId, sourceKey);

                    const cached = getCachedNodeProfiled(key, predicateFn);
                    if (cached !== undefined) {
                        return cached;
                    }

                    stats.misses += 1;

                    const result = callOriginalWithEpochThrottleProfiled(
                        key,
                        predicateFn
                    );

                    if (result?.id) {
                        rememberProfiled(key, result);
                    }

                    return result;
                };
            } else {
                store.findNode = function cachedFindNodePredicateProduction(predicateFn) {
                    if (typeof predicateFn !== "function") {
                        return original.call(store, predicateFn) ?? null;
                    }

                    const leafId = readCurrentLeafId();
                    if (!leafId) {
                        return original.call(store, predicateFn) ?? null;
                    }

                    const sourceKey = getPredicateSourceKey(predicateFn);
                    const key = makeKey(leafId, sourceKey);

                    const cached = getCachedNodeProduction(key, predicateFn);
                    if (cached !== undefined) {
                        return cached;
                    }

                    const result = callOriginalWithEpochThrottleProduction(
                        key,
                        predicateFn
                    );

                    if (result?.id) {
                        rememberProduction(key, result);
                    }

                    return result;
                };
            }

            this.__findNodePredicateCacheInstalled = true;

            return {
                ok: true,
                installed: true,
                methods: ["findNode"],
                profiled,
            };
        },

        uninstallFindNodePredicateCache() {
            if (!this.__findNodePredicateCacheInstalled) {
                return { ok: true, alreadyUninstalled: true };
            }

            const original = this.__findNodePredicateCacheOriginal?.findNode;

            if (this.__store && typeof original === "function") {
                this.__store.findNode = original;
            }

            this.__findNodePredicateCacheInstalled = false;
            this.__findNodePredicateCacheOriginal = null;
            this.__findNodePredicateCache = null;
            this.__findNodePredicateCacheStats = null;

            return { ok: true, uninstalled: true };
        },

        getFindNodePredicateCacheStats() {
            return {
                installed: Boolean(this.__findNodePredicateCacheInstalled),
                size: this.__findNodePredicateCache?.size ?? 0,
                stats: this.__findNodePredicateCacheStats,
            };
        },

        getNodeByIdOrMessageIdCallSiteStats() {
            const stats = this.__getNodeByIdOrMessageIdCallSites;

            if (!stats) {
                return {
                    installed: false,
                    total: 0,
                    topCallSites: [],
                };
            }

            return {
                installed: true,
                total: stats.total,
                topCallSites: Object.entries(stats.callSites)
                    .map(([stack, data]) => ({
                        stack,
                        ...data,
                    }))
                    .sort((a, b) => b.calls - a.calls)
                    .slice(0, 20),
            };
        },

        applyStoreReadOptimization({ debug = false, clearStats = false } = {}) {
            const optimizationStartedAt = performance.now();
            const discoveryResult = this.hasStore();

            if (!this.hasStore()) {
                return {
                    ok: false,
                    reason: "store not registered",
                    discoveryResult,
                    status: this.status(),
                };
            }

            if (!smokeTestStoreWrappers(this.__store)) {
                this.__storeValidationFailed = true;

                return {
                    ok: false,
                    reason: "store wrapper smoke test failed before optimization",
                    status: this.status(),
                };
            }

            const result = {
                ok: true,
                discoveryResult,
                statusBefore: this.status(),

                //updateNodeMessageRafBatcher: this.installUpdateNodeMessageRafBatcher(),
                indexRefreshHooks: [
                    this.wrapMutationForIndexRefresh("addMessageNode"),
                    this.wrapMutationForIndexRefresh("addOptimisticMessageNode"),
                    this.wrapMutationForIndexRefresh("prependNode"),
                    this.wrapMutationForIndexRefresh("prependOptismisticNode"),
                    this.wrapMutationForIndexRefresh("processUpdate", {
                        clearCaches: false,
                    }),
                ],

                ...runStoreEnhancementInstalls(this),

                findNodeCallSiteProfiler: ENABLE_FIND_NODE_CALLSITE_STATS
                    ? this.installFindNodeCallSiteProfiler()
                    : {
                        ok: true,
                        skipped: true,
                        reason: "disabled by ENABLE_FIND_NODE_CALLSITE_STATS",
                    },

                profiler: ENABLE_STORE_PROFILER
                    ? this.installStoreProfiler()
                    : {
                        ok: true,
                        skipped: true,
                        reason: "disabled by ENABLE_STORE_PROFILER",
                    },

                cleared: null,
            };

            if (clearStats) {
                result.cleared = this.clearPerformanceStats();
            }

            result.statusAfter = this.status();

            if (debug) {
                console.log("[thread-optimizer bridge] store read optimization applied", result);
            }

            this.__initTiming.lastApplyOptimizationMs =
                performance.now() - optimizationStartedAt;

            console.log(DISCOVERY_LOG_PREFIX, "optimization install completed", {
                elapsedMs: Math.round(this.__initTiming.lastApplyOptimizationMs * 10) / 10,
                ok: result.ok,
                installed: {
                    ...getStoreEnhancementInstallSummary(result),
                    updateNodeMessageRafBatcher: result.updateNodeMessageRafBatcher?.ok,
                    findNodeCallSiteProfiler: result.findNodeCallSiteProfiler?.ok,
                    profiler: result.profiler?.ok,
                },
                statusAfter: result.statusAfter,
            });

            if (!smokeTestStoreWrappers(this.__store)) {
                this.disableStoreReadOptimization?.({ debug: false });
                this.resetInstalledStoreEnhancements();

                this.__storeValidationFailed = true;

                return {
                    ok: false,
                    reason: "store wrapper smoke test failed after optimization",
                    status: this.status(),
                };
            }

            return result;
        },

        disableStoreReadOptimization({ debug = false } = {}) {
            const result = {
                profiler: this.uninstallStoreProfiler?.(),
                findNodeCallSiteProfiler: this.uninstallFindNodeCallSiteProfiler?.(),

                ...runStoreEnhancementUninstalls(this),

                indexRefreshHooks: this.uninstallIndexRefreshHooks?.(),
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
                this.__messageIdIndexStats.activeHits = 0;
                this.__messageIdIndexStats.activeMisses = 0;
                this.__messageIdIndexStats.cached = this.__messageIdIndex?.size ?? 0;
            }

            for (const [cacheSlot, statsSlot] of STABLE_CACHE_SLOTS) {
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

            if (this.__findNodePredicateCacheStats) {
                const stats = this.__findNodePredicateCacheStats;

                if ("calls" in stats) stats.calls = 0;
                if ("hits" in stats) stats.hits = 0;
                if ("misses" in stats) stats.misses = 0;
                if ("staleHits" in stats) stats.staleHits = 0;
                if ("invalidPredicate" in stats) stats.invalidPredicate = 0;
                if ("writes" in stats) stats.writes = 0;
                if ("activeRafHits" in stats) stats.activeRafHits = 0;
                if ("activeRafMisses" in stats) stats.activeRafMisses = 0;

                stats.cached = this.__findNodePredicateCache?.size ?? 0;
            }

            if (ENABLE_BRANCH_CALLSITE_STATS) {
                this.clearBranchCallSiteStats?.();
            }

            if (ENABLE_FIND_NODE_CALLSITE_STATS) {
                this.clearFindNodeCallSiteProfilerStats?.();
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
                existingNodeStableCache: this.getExistingNodeStableCacheStats?.(),
                getNodeByIdOrMessageIdCache: this.getGetNodeByIdOrMessageIdCacheStats?.(),
                findNodeFromLeafFrameCache: this.getFindNodeFromLeafFrameCacheStats?.(),
                getLeafFromNodeFrameCache: this.getGetLeafFromNodeFrameCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),

                branchCallSites: this.getBranchCallSiteStats?.(),
                getNodeByIdOrMessageIdCallSites: this.getNodeByIdOrMessageIdCallSiteStats?.(),
                initTiming: this.getInitTiming?.(),
                profile: this.getStoreProfile?.(),
                findNodeCallSites: this.getFindNodeCallSiteProfilerStats?.(),
                findNodePredicateCache: this.getFindNodePredicateCacheStats?.(),
                nodeObjectCache: {
                    installed: Boolean(this.__nodeObjectCacheApi),
                    size: this.__nodeObjectCache?.size ?? 0,
                    stats: this.__nodeObjectCacheStats,
                },
            };
        },

        installStoreReadCache() {
            return this.applyStoreReadOptimization({
                debug: this.__storeReadOptimizationDebug,
                clearStats: false,
            });
        },

        clearStoreReadCache(reason = "manual") {
            if (shouldAdvanceFindNodeEpoch(reason)) {
                this.__storeReadEpoch += 1;
            }

            const invalidationStats = this.__cacheInvalidationStats ??= {
                totalCalls: 0,
                byReason: {},
                byCache: {},
                recent: [],
                maxRecent: 50,
            };

            invalidationStats.totalCalls += 1;
            invalidationStats.byReason[reason] =
                (invalidationStats.byReason[reason] || 0) + 1;

            const recordInvalidation = (cacheName, action, sizeBefore = 0, extra = null) => {
                const cacheStats = invalidationStats.byCache[cacheName] ??= {
                    clears: 0,
                    skipped: 0,
                    sizeCleared: 0,
                    byReason: {},
                    byAction: {},
                };

                cacheStats.byReason[reason] =
                    (cacheStats.byReason[reason] || 0) + 1;
                cacheStats.byAction[action] =
                    (cacheStats.byAction[action] || 0) + 1;

                if (action === "cleared") {
                    cacheStats.clears += 1;
                    cacheStats.sizeCleared += sizeBefore || 0;
                } else {
                    cacheStats.skipped += 1;
                }

                invalidationStats.recent.push({
                    at: Date.now(),
                    reason,
                    cacheName,
                    action,
                    sizeBefore,
                    extra,
                });

                if (invalidationStats.recent.length > invalidationStats.maxRecent) {
                    invalidationStats.recent.shift();
                }
            };

            const shouldHardClear =
                reason === "manual" ||
                reason === "conversation-change" ||
                reason === "store-replaced" ||
                reason === "bridge-reset";

            const recordBranchSkip = (why) => {
                const getBranchSize = this.__branchCache?.getBranch?.size ?? 0;
                const getBranchFromLeafSize =
                    this.__branchCache?.getBranchFromLeaf?.size ?? 0;

                recordInvalidation("__branchCache.getBranch", "skipped", getBranchSize, {
                    why,
                });

                recordInvalidation(
                    "__branchCache.getBranchFromLeaf",
                    "skipped",
                    getBranchFromLeafSize,
                    { why }
                );
            };

            const recordCacheSkip = (cacheSlot, stats, why) => {
                const cache = this[cacheSlot];

                recordInvalidation(cacheSlot, "skipped", cache?.size ?? 0, {
                    why,
                });
            };

            if (!shouldHardClear) {
                for (const [cacheSlot, statsSlot] of STABLE_CACHE_SLOTS) {
                    if (cacheSlot === "__branchCache") {
                        recordBranchSkip("cache preserved until conversation/store reset");
                        continue;
                    }

                    recordCacheSkip(
                        cacheSlot,
                        this[statsSlot],
                        "cache preserved until conversation/store reset"
                    );
                }

                return {
                    ok: true,
                    reason,
                    skipped: true,
                    stats: invalidationStats,
                };
            }

            for (const [cacheSlot, statsSlot] of STABLE_CACHE_SLOTS) {
                const cache = this[cacheSlot];
                const stats = this[statsSlot];

                if (cacheSlot === "__branchCache") {
                    const getBranchSize = this.__branchCache?.getBranch?.size ?? 0;
                    const getBranchFromLeafSize =
                        this.__branchCache?.getBranchFromLeaf?.size ?? 0;

                    if (this.__branchCache instanceof Map) {
                        for (const cache of this.__branchCache.values()) {
                            cache?.clear?.();
                        }
                    }

                    recordInvalidation("__branchCache.getBranch", "cleared", getBranchSize);
                    recordInvalidation(
                        "__branchCache.getBranchFromLeaf",
                        "cleared",
                        getBranchFromLeafSize
                    );

                    if (ENABLE_CACHE_PROFILING && this.__branchCacheStats) {
                        if (this.__branchCacheStats.getBranch) {
                            this.__branchCacheStats.getBranch.cached = 0;
                        }

                        if (this.__branchCacheStats.getBranchFromLeaf) {
                            this.__branchCacheStats.getBranchFromLeaf.cached = 0;
                        }
                    }

                    continue;
                }

                if (cacheSlot === "__findNodeFromLeafFrameCache") {
                    this.__findNodeFromLeafAncestorChainCache?.clear?.();
                    this.__findNodeFromLeafPredicateNodeResultCache?.clear?.();
                    this.__findNodeFromLeafDormantAncestorResultCache?.clear?.();
                }

                if (cacheSlot === "__getLeafFromNodeFrameCache") {
                    this.__leafDescendantCache?.clear?.();
                    this.__leafDescendantMissCache?.clear?.();
                }

                const sizeBefore = cache?.size ?? 0;

                cache?.clear?.();

                recordInvalidation(cacheSlot, "cleared", sizeBefore);

                if (stats && ENABLE_CACHE_PROFILING) {
                    stats.cached = 0;

                    if ("clears" in stats) {
                        stats.clears += 1;
                    }
                }
            }

            return {
                ok: true,
                reason,
                skipped: false,
                stats: invalidationStats,
            };
        },

        getStoreReadCacheStats() {
            return {
                installed: Boolean(
                    this.__messageIdIndexInstalled ||
                    this.__existingNodeStableCacheInstalled ||
                    this.__findNodeFromLeafFrameCacheInstalled ||
                    this.__getLeafFromNodeFrameCacheInstalled ||
                    this.__branchCacheInstalled ||
                    this.__resolvedNodeFrameCacheInstalled
                ),
                messageIdIndex: this.getMessageIdIndexStats?.(),
                existingNodeStableCache: this.getExistingNodeStableCacheStats?.(),
                getNodeByIdOrMessageIdCache: this.getGetNodeByIdOrMessageIdCacheStats?.(),
                findNodeFromLeafFrameCache: this.getFindNodeFromLeafFrameCacheStats?.(),
                getLeafFromNodeFrameCache: this.getGetLeafFromNodeFrameCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),
            };
        },

        beginStoreTopologyMutation(reason = "topology-mutation") {
            this.__storeReadEpoch = (this.__storeReadEpoch || 0) + 1;

            this.__liveNodeCacheDirty = true;
            this.__liveNodeCacheId = null;
            this.__liveNodeCacheValue = null;

            this.__lastLiveFindLeafId = null;
            this.__lastLiveFindPredicateSource = null;
            this.__lastLiveFindValue = null;

            return {
                ok: true,
                reason,
                epoch: this.__storeReadEpoch,
            };
        },

        clearFullTopologyCaches(reason = "conversation-change") {
            this.__storeReadEpoch = (this.__storeReadEpoch || 0) + 1;

            this.__nodeObjectCacheApi?.clear?.(reason);
            this.__existingNodeStableCacheApi?.clear?.(reason);

            this.__messageIdIndex?.clear?.();
            this.__getNodeByIdOrMessageIdCache?.clear?.();
            this.__resolvedNodeFrameCache?.clear?.();

            this.__findNodeFromLeafFrameCache?.clear?.();
            this.__findNodeFromLeafAncestorChainCache?.clear?.();
            this.__findNodeFromLeafDormantAncestorResultCache?.clear?.();
            this.__findNodePredicateCache?.clear?.();

            this.__getLeafFromNodeFrameCache?.clear?.();
            this.__leafDescendantCache?.clear?.();
            this.__leafDescendantMissCache?.clear?.();

            this.clearBranchCache?.();

            this.__nodeIdDirectIndex = null;
            this.__nodeIdDirectIndexSource = null;
            this.__confirmedExistingNodeIds = null;

            this.__liveNodeCacheDirty = true;
            this.__liveNodeCacheId = null;
            this.__liveNodeCacheValue = null;

            this.__lastLiveFindLeafId = null;
            this.__lastLiveFindPredicateSource = null;
            this.__lastLiveFindValue = null;

            return {
                ok: true,
                reason,
                epoch: this.__storeReadEpoch,
            };
        },

        clearCachesForDeletedNode(node, inputId = null) {
            if (!node?.id) {
                return { ok: false, reason: "node missing" };
            }

            const nodeId = node.id;
            const parentId = node.parentId ?? null;
            const childIds = Array.isArray(node.children)
                ? node.children.filter(Boolean)
                : [];

            const messageId =
                node.message?.id ||
                node.message?.message_id ||
                node.message?.metadata?.message_id ||
                null;

            const aliases = Array.from(
                new Set([inputId, nodeId, messageId].filter(Boolean))
            );

            let deletedEntries = 0;

            const deleteAliasesFromMap = (map) => {
                if (!(map instanceof Map)) return 0;

                let count = 0;

                for (const alias of aliases) {
                    if (map.delete(alias)) count += 1;
                }

                return count;
            };

            deletedEntries += deleteAliasesFromMap(this.__nodeObjectCache);
            deletedEntries += deleteAliasesFromMap(this.__nodeIdDirectIndex);
            deletedEntries += deleteAliasesFromMap(this.__messageIdIndex);
            deletedEntries += deleteAliasesFromMap(this.__existingNodeStableCache);
            deletedEntries += deleteAliasesFromMap(this.__getNodeByIdOrMessageIdCache);
            deletedEntries += deleteAliasesFromMap(this.__resolvedNodeFrameCache);

            // Branch cache:
            // getBranch is current-leaf derived, so any topology mutation invalidates it.
            // getBranchFromLeaf(parent/children/descendants) can all change because
            // deleteNode splices children into the parent. Targeted is possible, but
            // cheap/safe option is clearing this branch-path cache.
            this.clearBranchCache?.();

            // Leaf caches are path/topology dependent. Clear whole.
            this.__getLeafFromNodeFrameCache?.clear?.();
            this.__leafDescendantCache?.clear?.();
            this.__leafDescendantMissCache?.clear?.();

            // findNodeFromLeaf caches predicate results along parent chains.
            // A deleted node can invalidate any cached chain crossing that node.
            this.__findNodeFromLeafFrameCache?.clear?.();
            this.__findNodeFromLeafAncestorChainCache?.clear?.();
            this.__findNodeFromLeafDormantAncestorResultCache?.clear?.();

            // Predicate cache may hold the deleted node as a result.
            this.__findNodePredicateCache?.delete?.(nodeId);
            for (const alias of aliases) {
                this.__findNodePredicateCache?.delete?.(alias);
            }

            this.__liveNodeCacheDirty = true;

            if (this.__liveNodeCacheId === nodeId || aliases.includes(this.__liveNodeCacheId)) {
                this.__liveNodeCacheId = null;
                this.__liveNodeCacheValue = null;
            }

            if (this.__lastLiveFindValue?.id === nodeId) {
                this.__lastLiveFindLeafId = null;
                this.__lastLiveFindPredicateSource = null;
                this.__lastLiveFindValue = null;
            }

            return {
                ok: true,
                nodeId,
                parentId,
                childIds,
                aliases,
                deletedEntries,
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

        wrapMutationForIndexRefresh(methodName, {
            clearCaches = true,
            cacheReason = null,
        } = {}) {
            const result = installStoreMethodWrapper({
                bridge: this,
                methodName,
                originalSlot: "__indexRefreshHookOriginals",
                installedFlag: "__indexRefreshHooksInstalled",
                unavailableReason: `${methodName} unavailable`,
                createWrapper: ({ store, original, bridge }) => function indexedMutationWrapper(...args) {
                    const res = original.apply(store, args);

                    if (clearCaches) {
                        bridge.clearStoreReadCache?.(
                            cacheReason || getMutationCacheReason(methodName, args)
                        );
                    }

                    return res;
                },
            });

            return {
                ...result,
                method: methodName,
                clearCaches,
                cacheReason,
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

            case "thread-optimizer:prune-react-message-ids": {
                const rawIds = Array.isArray(data.messageIds) ? data.messageIds : [];

                const messageIds = Array.from(
                    new Set(
                        rawIds
                            .map(normalizeBridgeMessageId)
                            .filter(Boolean)
                    )
                );

                if (messageIds.length === 0) {
                    return {
                        ok: false,
                        reason: "no valid message ids",
                    };
                }

                return {
                    ok: true,
                    value: {
                        messageIds,
                        reason:
                            typeof data.reason === "string"
                                ? data.reason.slice(0, 100)
                                : "react-prune",
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

            case "thread-optimizer:visible-messages-ready": {
                return {
                    ok: true,
                    value: {},
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

                return;
            }

            if (data.type === "thread-optimizer:prune-react-message-ids") {
                const result = bridge.pruneReactMessageIds(payload.messageIds, {
                    reason: payload.reason,
                });

                if (!result.ok) {
                    console.debug("[thread-optimizer bridge] React prune had failures", result);
                }

                return;
            }

            if (data.type === "thread-optimizer:log-store-performance") {
                console.debug("[thread-optimizer bridge] received store performance log request");
                console.log("[thread-optimizer bridge] store performance", bridge.getPerformanceSnapshot());
                return;
            }

            if (data.type === "thread-optimizer:visible-messages-ready") {
                bridge.verifyRegisteredStoreAgainstVisibleMessages(
                    "visible-messages-ready"
                );

                return;
            }

            if (data.type === "thread-optimizer:set-store-read-optimization") {
                bridge.__storeReadOptimizationRequested = payload.enabled;
                bridge.__storeReadOptimizationDebug = payload.debug;

                if (!payload.enabled) {
                    bridge.disableStoreReadOptimization({
                        debug: payload.debug,
                    });
                }

                return;
            }
        },
        false
    );

    let lastConversationKey = location.pathname + location.search;

    function resetToStartupCachePolicy(reason = "conversation-change") {
        bridge.clearStoreReadCache?.(reason);

        const original = bridge.__existingNodeStableCacheOriginal?.getNodeIfExists;
        const cacheApi = bridge.__existingNodeStableCacheApi;

        if (bridge.__store && typeof original === "function" && cacheApi) {
            cacheApi.clear?.("conversation-change");
        }
    }

    function checkConversationChanged() {
        const nextKey = location.pathname + location.search;
        if (nextKey === lastConversationKey) return;

        lastConversationKey = nextKey;
        resetToStartupCachePolicy("conversation-change");

        bridge.__storeDiscoveryLocked = false;
        bridge.__visibleMessagesVerificationDone = false;
        bridge.__visibleMessagesVerificationConversationKey = null;
        bridge.__lastVisibleMessagesVerificationResult = null;
    }

    function shouldAdvanceFindNodeEpoch(reason) {
        return (
            reason === "topology-mutation" ||
            reason === "conversation-change" ||
            reason === "manual"
        );
    }

    function getMutationCacheReason(methodName, args) {
        if (
            methodName === "addMessageNode" ||
            methodName === "addOptimisticMessageNode" ||
            methodName === "prependNode" ||
            methodName === "prependOptismisticNode"
        ) {
            const message = args?.[1];

            const role = message?.author?.role;
            const status = message?.status;
            const metadata = message?.metadata || {};

            // User send is the one we care about for findNode epoch.
            if (role === "user") {
                return "topology-mutation";
            }

            // Assistant/tool/system streaming nodes should not keep nuking findNode sharing.
            if (
                role === "assistant" ||
                role === "tool" ||
                role === "system" ||
                status === "in_progress" ||
                metadata.is_loading_message ||
                metadata.async_task_id ||
                metadata.async_completion_id
            ) {
                return "streaming-mutation";
            }

            return "store-mutation";
        }

        if (
            methodName === "deleteNode" ||
            methodName === "moveNode"
        ) {
            return "topology-mutation";
        }

        return "store-mutation";
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
})();