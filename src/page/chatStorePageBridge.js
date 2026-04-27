(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";
    const BRIDGE_VERSION = 8;

    const MAX_FIBERS = 4000;
    const MAX_OBJECTS = 15000;
    const DISCOVERY_RETRY_MS = 1200;
    const MAX_DISCOVERY_RUNS = 30;
    const DEFAULT_CACHE_MAX_SIZE = 1000;

    const DISCOVERY_LOG_PREFIX = "[thread-optimizer bridge init]";

    const ENABLE_STORE_PROFILER = false;
    const ENABLE_BRANCH_CALLSITE_STATS = false;

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    function createFrameCache({ maxSize, stats }) {
        const cache = new Map();
        let clearScheduled = false;

        function clear(reason) {
            cache.clear();
            clearScheduled = false;

            stats.cached = 0;
            stats.frameClears += 1;
            stats.lastClearReason = reason;
        }

        function scheduleClear() {
            if (clearScheduled) return;
            clearScheduled = true;

            requestAnimationFrame(() => clear("raf"));
        }

        function get(key) {
            if (cache.has(key)) {
                stats.hits += 1;
                return cache.get(key);
            }

            stats.misses += 1;
            return undefined;
        }

        function set(key, value) {
            cache.set(key, value ?? null);
            scheduleClear();

            if (cache.size > maxSize) {
                const firstKey = cache.keys().next().value;
                cache.delete(firstKey);
                stats.evictions += 1;
            }

            stats.cached = cache.size;
        }

        return { get, set, clear, cache };
    }

    function uninstallMethodFrameCache({
        bridge,
        methodNames,
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

        const nodes = store.nodes;

        if (nodes instanceof Map) {
            return nodes.get(nodeId) ?? null;
        }

        if (Array.isArray(nodes)) {
            return nodes.find((node) => node?.id === nodeId) ?? null;
        }

        if (nodes && typeof nodes === "object") {
            return nodes[nodeId] ?? null;
        }

        return null;
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

        let nodeCount = null;
        let rootId = null;
        let currentLeafId = null;

        try {
            const nodesValue = store.nodes;
            if (nodesValue && typeof nodesValue === "object") {
                nodeCount = Array.isArray(nodesValue)
                    ? nodesValue.length
                    : Object.keys(nodesValue).length;
            }
        } catch {}

        try {
            rootId = safeCall(store.rootId);
        } catch {}

        try {
            currentLeafId = safeCall(store.currentLeafId);
        } catch {}

        return {
            found: true,
            nodeCount,
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
        if (isObjectLike(store)) {
            rejectedStores.add(store);
        }

        const reasonKey = String(reason || "unknown");
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

        const MAX_ELEMENTS_FOR_ROOT_SCAN = 10000;
        const all = document.body ? document.body.querySelectorAll("*") : document.querySelectorAll("*");
        const limit = Math.min(all.length, MAX_ELEMENTS_FOR_ROOT_SCAN);

        for (let i = 0; i < limit; i += 1) {
            const el = all[i];

            if (!el || el.nodeType !== 1) continue;

            const keys = Object.keys(el);

            for (let j = 0; j < keys.length; j += 1) {
                const key = keys[j];

                if (
                    key.charCodeAt(0) !== 95 || // _
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

                    return {
                        store: bestStore,
                        visitedObjects,
                    };
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

                        return {
                            store: candidate,
                            visitedFibers,
                            visitedObjects,
                        };
                    }

                    rejectStore(candidate, validation.reason);
                }

                if (bestStore) {
                    continue;
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
                        return {
                            store: scanned.store,
                            visitedFibers,
                            visitedObjects,
                        };
                    }

                    if (objectBudget.visitedObjects > limits.maxObjects) {
                        return {
                            store: bestStore ?? null,
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

    function getCheapCacheKey(methodName, args) {
        const first = args[0];

        if (
            first === null ||
            typeof first === "string" ||
            typeof first === "number" ||
            typeof first === "boolean"
        ) {
            return `${methodName}:${String(first)}`;
        }

        if (first && typeof first === "object") {
            return `${methodName}:object:${first.id ?? first.nodeId ?? first.message?.id ?? "unknown"}`;
        }

        return `${methodName}:${typeof first}`;
    }

    function resolveNodeCore(bridge, id) {
        const store = bridge.__store;
        const index = bridge.__messageIdIndex;
        if (!store) return null;

        try {
            if (index?.has(id)) {
                const nodeId = index.get(id);
                return getNodeDirect(store, nodeId);
            }

            const nodeId = store.messageIdToExistingNodeId?.call(store, id);
            if (!nodeId) return null;

            const node = getNodeDirect(store, nodeId);

            if (node && index) {
                index.set(id, nodeId);
                index.set(nodeId, nodeId);
            }

            return node;
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

        __findNodeFromLeafFrameCacheInstalled: false,
        __findNodeFromLeafFrameCacheOriginal: null,
        __findNodeFromLeafFrameCache: null,
        __findNodeFromLeafFrameCacheStats: null,

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

        status() {
            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(this.__store),
                found: this.__found,
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

            this.__findNodeFromLeafFrameCacheInstalled = false;
            this.__findNodeFromLeafFrameCacheOriginal = null;
            this.__findNodeFromLeafFrameCache = null;
            this.__findNodeFromLeafFrameCacheStats = null;

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

            this.__indexRefreshHooksInstalled = false;
            this.__indexRefreshHookOriginals = null;
        },

        registerStore(store, meta = null) {
            const validation = validateStoreCandidate(store);

            if (!validation.ok) {
                rejectStore(store, validation.reason);
                this.__lastError = `registerStore rejected candidate: ${validation.reason}`;
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

            const inspection = this.inspectMessageById(normalizedMessageId);

            return {
                recorded: true,
                resolved: Boolean(inspection.nodeId && inspection.exists),
                messageId: normalizedMessageId,
                nodeId: inspection.nodeId,
                count: this.__prunedMessageIds.length,
                inspection,
            };
        },

        getPrunedMessageIds() {
            return [...this.__prunedMessageIds];
        },

        clearPrunedMessageIds() {
            this.__prunedMessageIds = [];
            this.__lastError = null;
            return true;
        },

        inspectPrunedMessages() {
            return this.__prunedMessageIds.map((messageId, index) => ({
                index,
                ...this.inspectMessageById(messageId),
            }));
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

            const methodNames = [
                "messageIdToExistingNodeId",
                "getNodeIfExists",
                "getBranch",
                "getBranchFromLeaf",
                "deleteNode",
            ];

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

            return {
                installed: this.__storeProfilerInstalled,
                installedAt: this.__storeProfile.installedAt,
                clearedAt: this.__storeProfile.clearedAt ?? null,
                methods,
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

        installMessageIdIndex() {
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

            this.__store.messageIdToExistingNodeId = function indexedMessageIdToExistingNodeId(messageId) {
                if (bridgeRef.__messageIdIndex?.has(messageId)) {
                    bridgeRef.__messageIdIndexStats.hits += 1;
                    return bridgeRef.__messageIdIndex.get(messageId);
                }

                bridgeRef.maybeRebuildMessageIdIndex?.({ minIntervalMs: 1000 });

                if (bridgeRef.__messageIdIndex?.has(messageId)) {
                    bridgeRef.__messageIdIndexStats.hits += 1;
                    return bridgeRef.__messageIdIndex.get(messageId);
                }

                bridgeRef.__messageIdIndexStats.misses += 1;

                const result = original.apply(bridgeRef.__store, arguments);

                if (result) {
                    bridgeRef.__messageIdIndexStats.fallbackHits += 1;
                    bridgeRef.__messageIdIndex.set(messageId, result);
                }

                return result ?? null;
            };

            this.__messageIdIndexInstalled = true;

            return {
                ok: true,
                installed: true,
                indexSize: this.__messageIdIndex.size,
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

        installExistingNodeFrameCache({ maxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
            if (!this.__store) return { ok: false, reason: "store not registered" };
            if (this.__existingNodeFrameCacheInstalled) {
                return { ok: true, alreadyInstalled: true, stats: this.__existingNodeFrameCacheStats };
            }

            const original = this.__store.getNodeIfExists;
            if (typeof original !== "function") {
                return { ok: false, reason: "getNodeIfExists unavailable" };
            }

            const stats = {
                hits: 0,
                misses: 0,
                cached: 0,
                evictions: 0,
                frameClears: 0,
                maxSize,
                mode: "frame",
                lastClearReason: null,
            };

            const frameCache = createFrameCache({ maxSize, stats });

            this.__existingNodeFrameCache = frameCache.cache;
            this.__existingNodeFrameCacheStats = stats;
            this.__existingNodeFrameCacheOriginal = { getNodeIfExists: original };

            const bridgeRef = this;

            this.__store.getNodeIfExists = function cachedGetNodeIfExists(id) {
                const cached = frameCache.get(id);
                if (cached !== undefined) return cached;

                const result = original.call(bridgeRef.__store, id);

                frameCache.set(id, result ?? null);
                return result ?? null;
            };

            this.__existingNodeFrameCacheInstalled = true;

            return { ok: true, installed: true, methods: ["getNodeIfExists"] };
        },

        uninstallExistingNodeFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                methodNames: "getNodeIfExists",
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

        installFindNodeFromLeafFrameCache({ maxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
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

            const stats = {
                hits: 0,
                misses: 0,
                cached: 0,
                evictions: 0,
                frameClears: 0,
                maxSize,
                mode: "frame",
                lastClearReason: null,
            };

            const frameCache = createFrameCache({ maxSize, stats });

            this.__findNodeFromLeafFrameCache = frameCache.cache;
            this.__findNodeFromLeafFrameCacheStats = stats;
            this.__findNodeFromLeafFrameCacheOriginal = { findNodeFromLeaf: original };

            const bridgeRef = this;

            this.__store.findNodeFromLeaf = function cachedFindNodeFromLeaf(id) {
                const index = bridgeRef.__messageIdIndex;
                const canonicalId = index?.get(id) ?? id;

                const cached = frameCache.get(canonicalId);
                if (cached !== undefined) return cached;

                const result = original.call(bridgeRef.__store, id);

                // cache BOTH hits and misses
                frameCache.set(canonicalId, result ?? null);

                return result ?? null;
            };

            this.__findNodeFromLeafFrameCacheInstalled = true;

            return { ok: true, installed: true, methods: ["findNodeFromLeaf"] };
        },

        uninstallFindNodeFromLeafFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                methodNames: "findNodeFromLeaf",
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

        installGetLeafFromNodeFrameCache({ maxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
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

            const stats = {
                hits: 0,
                misses: 0,
                cached: 0,
                evictions: 0,
                frameClears: 0,
                maxSize,
                mode: "frame",
                lastClearReason: null,
            };

            const frameCache = createFrameCache({ maxSize, stats });

            this.__getLeafFromNodeFrameCache = frameCache.cache;
            this.__getLeafFromNodeFrameCacheStats = stats;
            this.__getLeafFromNodeFrameCacheOriginal = { getLeafFromNode: original };

            const bridgeRef = this;

            this.__store.getLeafFromNode = function cachedGetLeafFromNode(id) {
                const key =
                    typeof id === "string" ||
                    typeof id === "number" ||
                    typeof id === "boolean" ||
                    id == null
                        ? id
                        : id.id ?? id.nodeId ?? id.message?.id ?? id;

                const cached = frameCache.get(key);
                if (cached !== undefined) return cached;

                const result = original.call(bridgeRef.__store, id);

                frameCache.set(key, result ?? null);
                return result ?? null;
            };

            this.__getLeafFromNodeFrameCacheInstalled = true;

            return { ok: true, installed: true, methods: ["getLeafFromNode"] };
        },

        uninstallGetLeafFromNodeFrameCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                methodNames: "getLeafFromNode",
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
            if (!this.__branchCallSiteStats) {
                this.__branchCallSiteStats = {
                    installed: true,
                    totalCalls: 0,
                    methods: {},
                    callSites: {},
                    maxCallSites: 80,
                };
            }

            const stats = this.__branchCallSiteStats;

            stats.totalCalls += 1;
            stats.methods[methodName] = (stats.methods[methodName] || 0) + 1;

            let stackKey = "stack capture disabled";

            if (this.__branchCallSiteCaptureStacks) {
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

        installBranchCache({ maxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
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

            const originals = {};
            for (const methodName of ["getBranch", "getBranchFromLeaf"]) {
                const original = this.__store[methodName];
                if (typeof original === "function") {
                    originals[methodName] = original;
                }
            }

            if (Object.keys(originals).length === 0) {
                return { ok: false, reason: "no branch methods available" };
            }

            const stats = {
                hits: 0,
                misses: 0,
                cached: 0,
                evictions: 0,
                frameClears: 0,
                maxSize,
                mode: "frame",
                lastClearReason: null,
            };

            const frameCache = createFrameCache({ maxSize, stats });

            this.__branchCache = frameCache.cache;
            this.__branchCacheStats = stats;
            this.__branchCacheOriginals = originals;

            const bridgeRef = this;

            for (const [methodName, original] of Object.entries(originals)) {
                this.__store[methodName] = function cachedBranchMethod(id, ...rest) {
                    if (ENABLE_BRANCH_CALLSITE_STATS) {
                        bridgeRef.recordBranchCallSite(methodName, [id, ...rest]);
                    }

                    const key = `${methodName}:${String(id)}`;

                    const cached = frameCache.get(key);
                    if (cached !== undefined) return cached;

                    const result = original.call(bridgeRef.__store, id, ...rest);

                    frameCache.set(key, result ?? null);
                    return result ?? null;
                };
            }

            this.__branchCacheInstalled = true;

            const result = {
                ok: true,
                installed: true,
                methods: Object.keys(originals),
            };

            this.__branchCacheLastInstallResult = result;

            return result;
        },

        uninstallBranchCache() {
            return uninstallMethodFrameCache({
                bridge: this,
                methodNames: ["getBranch", "getBranchFromLeaf"],
                originalSlot: "__branchCacheOriginals",
                installedFlag: "__branchCacheInstalled",
            });
        },

        clearBranchCache() {
            this.__branchCache?.clear();

            if (this.__branchCacheStats) {
                this.__branchCacheStats.cached = 0;
            }

            return {
                ok: true,
            };
        },

        getBranchCacheStats() {
            return {
                installed: Boolean(this.__branchCacheInstalled),
                size: this.__branchCache?.size ?? 0,
                stats: this.__branchCacheStats ?? null,
                lastInstallResult: this.__branchCacheLastInstallResult ?? null,
            };
        },

        installResolvedNodeFrameCache({ maxSize = DEFAULT_CACHE_MAX_SIZE } = {}) {
            if (!this.__store) {
                return { ok: false, reason: "store not registered" };
            }

            if (this.__resolvedNodeFrameCacheInstalled) {
                return { ok: true, alreadyInstalled: true };
            }

            const stats = {
                hits: 0,
                misses: 0,
                cached: 0,
                evictions: 0,
                frameClears: 0,
                maxSize,
                mode: "frame",
                lastClearReason: null,
            };

            const frameCache = createFrameCache({ maxSize, stats });

            this.__resolvedNodeFrameCache = frameCache.cache;
            this.__resolvedNodeFrameCacheStats = stats;

            const bridgeRef = this;

            this.__resolveNodeFast = function resolveNodeFast(id) {
                const cached = frameCache.get(id);
                if (cached !== undefined) return cached;

                const node = resolveNodeCore(bridgeRef, id);

                if (node) {
                    const nodeId = node.id;

                    // primary key
                    frameCache.set(id, node);

                    // 🔥 dual-key cache
                    if (nodeId && nodeId !== id) {
                        frameCache.set(nodeId, node);
                    }
                } else {
                    frameCache.set(id, null);
                }

                return node;
            };

            this.__resolvedNodeFrameCacheInstalled = true;

            return { ok: true, installed: true };
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

        applyStoreReadOptimization({ debug = false, clearStats = false } = {}) {
            const optimizationStartedAt = performance.now();
            const discoveryResult = this.hasStore() ? true : this.retryDiscovery();

            if (!this.hasStore()) {
                return {
                    ok: false,
                    reason: "store not registered after retryDiscovery",
                    discoveryResult,
                    status: this.status(),
                };
            }

            const result = {
                ok: true,
                discoveryResult,
                statusBefore: this.status(),
                messageIdIndex: this.installMessageIdIndex(),
                indexRefreshHooks: [
                    this.wrapMutationForIndexRefresh("addMessageNode"),
                    this.wrapMutationForIndexRefresh("addOptimisticMessageNode"),
                    this.wrapMutationForIndexRefresh("prependNode"),
                    this.wrapMutationForIndexRefresh("prependOptismisticNode"),
                    this.wrapMutationForIndexRefresh("processUpdate"),
                ],
                nodeFrameCache: this.installExistingNodeFrameCache(),
                findNodeFromLeafFrameCache: this.installFindNodeFromLeafFrameCache(),
                getLeafFromNodeFrameCache: this.installGetLeafFromNodeFrameCache(),
                branchCache: this.installBranchCache(),
                resolvedNodeFrameCache: this.installResolvedNodeFrameCache(),
                profiler: ENABLE_STORE_PROFILER
                    ? this.installStoreProfiler()
                    : { ok: true, skipped: true, reason: "disabled by ENABLE_STORE_PROFILER" },
                cleared: null,
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
            }

            for (const [cacheSlot, statsSlot] of [
                ["__existingNodeFrameCache", "__existingNodeFrameCacheStats"],
                ["__findNodeFromLeafFrameCache", "__findNodeFromLeafFrameCacheStats"],
                ["__getLeafFromNodeFrameCache", "__getLeafFromNodeFrameCacheStats"],
            ]) {
                const stats = this[statsSlot];
                if (!stats) continue;

                stats.hits = 0;
                stats.misses = 0;
                stats.cached = this[cacheSlot]?.size ?? 0;
                stats.evictions = 0;
                stats.frameClears = 0;
                stats.lastClearReason = null;
            }

            if (this.__branchCacheStats) {
                this.__branchCacheStats.hits = 0;
                this.__branchCacheStats.misses = 0;
                this.__branchCacheStats.cached = this.__branchCache?.size ?? 0;
                this.__branchCacheStats.evictions = 0;
                this.__branchCacheStats.frameClears = 0;
            }

            if (this.__resolvedNodeFrameCacheStats) {
                this.__resolvedNodeFrameCacheStats.hits = 0;
                this.__resolvedNodeFrameCacheStats.misses = 0;
                this.__resolvedNodeFrameCacheStats.cached = this.__resolvedNodeFrameCache?.size ?? 0;
                this.__resolvedNodeFrameCacheStats.evictions = 0;
                this.__resolvedNodeFrameCacheStats.frameClears = 0;
                this.__resolvedNodeFrameCacheStats.lastClearReason = null;
            }

            this.clearBranchCallSiteStats?.();

            return {
                ok: true,
            };
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
                branchCallSites: this.getBranchCallSiteStats?.(),
                initTiming: this.getInitTiming?.(),
                profile: this.getStoreProfile?.(),
            };
        },

        inspectStoreMethods() {
            if (!this.__store) {
                return {
                    ok: false,
                    reason: "store not registered",
                };
            }

            const names = [
                "findNodeFromLeaf",
                "findNode",
                "getNodeByIdOrMessageId",
                "getLeafFromNode",
                "getVariantIds",
                "isMessageTurnEnded",
                "isLastActorMessage",
                "getBranch",
                "getBranchFromLeaf",
                "getNodeIfExists",
                "messageIdToExistingNodeId",
            ];

            return {
                ok: true,
                methods: Object.fromEntries(
                    names.map((name) => [name, typeof this.__store[name] === "function"])
                ),
                storeKeys: Object.keys(this.__store).slice(0, 160),
                protoKeys: Object.getOwnPropertyNames(
                    Object.getPrototypeOf(this.__store) || {}
                ).slice(0, 160),
            };
        },

        inspectStoreShape() {
            if (!this.__store) {
                return {
                    ok: false,
                    reason: "store not registered",
                };
            }

            const store = this.__store;
            const proto = Object.getPrototypeOf(store);
            const nodes = store.nodes;

            return {
                ok: true,
                storeType: Object.prototype.toString.call(store),
                ownKeys: Reflect.ownKeys(store).map(String).slice(0, 200),
                protoKeys: proto ? Reflect.ownKeys(proto).map(String).slice(0, 200) : [],
                nodes: {
                    exists: nodes != null,
                    type: typeof nodes,
                    tag: Object.prototype.toString.call(nodes),
                    isMap: nodes instanceof Map,
                    isArray: Array.isArray(nodes),
                    count: getStoreNodeCount(store),
                    keys: nodes && typeof nodes === "object"
                        ? Reflect.ownKeys(nodes).map(String).slice(0, 100)
                        : [],
                },
                info: getStoreInfo(store),
                methods: this.inspectStoreMethods?.(),
            };
        },

        installStoreReadCache() {
            return this.applyStoreReadOptimization({
                debug: this.__storeReadOptimizationDebug,
                clearStats: false,
            });
        },

        clearStoreReadCache() {
            this.clearBranchCache();

            for (const [cacheSlot, statsSlot] of [
                ["__existingNodeFrameCache", "__existingNodeFrameCacheStats"],
                ["__findNodeFromLeafFrameCache", "__findNodeFromLeafFrameCacheStats"],
                ["__getLeafFromNodeFrameCache", "__getLeafFromNodeFrameCacheStats"],
                ["__resolvedNodeFrameCache", "__resolvedNodeFrameCacheStats"],
            ]) {
                this[cacheSlot]?.clear();

                if (this[statsSlot]) {
                    this[statsSlot].cached = 0;
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
                    this.__resolvedNodeFrameCacheInstalled
                ),
                messageIdIndex: this.getMessageIdIndexStats?.(),
                existingNodeFrameCache: this.getExistingNodeFrameCacheStats?.(),
                findNodeFromLeafFrameCache: this.getFindNodeFromLeafFrameCacheStats?.(),
                getLeafFromNodeFrameCache: this.getGetLeafFromNodeFrameCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),
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
            if (!this.__messageIdIndexInstalled) return { ok: false, reason: "index not installed" };

            const now = Date.now();
            const last = this.__messageIdIndexStats?.lastRebuiltAt ?? 0;

            if (now - last < minIntervalMs) {
                return { ok: true, skipped: true, reason: "too soon" };
            }

            return this.buildMessageIdIndex();
        },

        wrapMutationForIndexRefresh(methodName) {
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

                queueMicrotask(() => {
                    bridgeRef.maybeRebuildMessageIdIndex?.({ minIntervalMs: 250 });
                });

                return result;
            };

            this.__indexRefreshHooksInstalled = true;

            return { ok: true, installed: true };
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

    window.addEventListener(
        "message",
        (event) => {
            if (event.source !== window) return;
            if (event.origin !== window.location.origin) return;

            const data = event.data;

            if (!data || data.source !== "thread-optimizer") {
                return;
            }

            if (data.type === "thread-optimizer:record-pruned-message-id") {
                bridge.recordPrunedMessageId(data.messageId);
                return;
            }

            if (data.type === "thread-optimizer:log-store-performance") {
                console.debug("[thread-optimizer bridge] received store performance log request");
                console.log("[thread-optimizer bridge] store performance", bridge.getPerformanceSnapshot());
                return;
            }

            if (data.type === "thread-optimizer:set-store-read-optimization") {
                console.debug("[thread-optimizer bridge] received store read optimization setting", {
                    enabled: data.enabled,
                    debug: data.debug,
                });

                bridge.__storeReadOptimizationRequested = Boolean(data.enabled);
                bridge.__storeReadOptimizationDebug = Boolean(data.debug);

                if (data.enabled) {
                    bridge.applyStoreReadOptimization({
                        debug: Boolean(data.debug),
                        clearStats: true,
                    });
                } else {
                    bridge.disableStoreReadOptimization({
                        debug: Boolean(data.debug),
                    });
                }

                return;
            }

            console.debug("[thread-optimizer bridge] ignored message", data);
        },
        false
    );

    bridge.startDiscoveryLoop();
})();