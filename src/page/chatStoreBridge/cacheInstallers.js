import {
    DISCOVERY_LOG_PREFIX,
    ENABLE_DEBUG,
    ENABLE_STORE_PROFILER,
    ENABLE_BRANCH_CALLSITE_STATS,
    ENABLE_CACHE_PROFILING,
    ENABLE_MESSAGE_ID_INDEX_CACHE,
    ENABLE_EXISTING_NODE_STABLE_CACHE,
    ENABLE_BRANCH_CACHE,
    ENABLE_RESOLVED_NODE_FRAME_CACHE,
    ENABLE_GET_NODE_BY_ID_OR_MESSAGE_ID_CACHE,
} from "./config.js";

import {
    findStoreNodeByMessageId,
    getNodeDirect,
    unavailable,
} from "./common.js";

import {
    createNodeObjectCache,
    createPersistentCache,
    createCacheStats,
    getCacheSnapshot,
    getStoreMethod,
    installStoreMethodWrapper,
    requireStore,
    uninstallMethodFrameCache,
} from "./cacheCore.js";

import {
    runStoreEnhancementUninstalls,
} from "./storeEnhancements.js";

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

function getStoreRootIdValue(store) {
    try {
        const rootId = store?.rootId;

        return typeof rootId === "function" ? rootId.call(store) : rootId;
    } catch {
        return null;
    }
}

function getBranchSearchParentId(node) {
    return (
        node?.parentId ||
        node?.parent ||
        node?.parent_id ||
        node?.parentNodeId ||
        node?.parent_node_id ||
        null
    );
}

function getBranchSearchMessage(node) {
    return node?.message && typeof node.message === "object"
        ? node.message
        : node;
}

function isBranchSearchRootNode(node) {
    return getNodeRole(node) === "root";
}

function createBranchSearchRecorder(stats) {
    return function recordBranchSearch(methodName, {
        iterations = 0,
        matched = false,
        fallback = false,
    } = {}) {
        if (!ENABLE_CACHE_PROFILING || !stats) {
            return;
        }

        stats.calls += 1;
        stats.iterations += iterations;

        if (matched) {
            stats.matches += 1;
        }

        if (fallback) {
            stats.fallbacks += 1;
        }

        stats.methods[methodName] = (stats.methods[methodName] || 0) + 1;
    };
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

        let nodeId = null;
        let node = null;

        const resolver = store.messageIdToExistingNodeId;

        if (typeof resolver === "function") {
            nodeId = resolver.call(store, id);

            if (nodeId) {
                node = nodeCache
                    ? nodeCache.resolve(nodeId)
                    : getNodeDirect(store, nodeId);
            }
        }

        if (!node) {
            node = findStoreNodeByMessageId(store, id);
            nodeId = node?.id ?? null;
        }

        if (!nodeId || !node) return null;

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

function updateCachedCount(stats, cache) {
    if (stats && "cached" in stats) {
        stats.cached = cache?.size ?? 0;
    }
}

function readNodeStatus(node) {
    return node?.message?.status ?? node?.status ?? null;
}

function getNodeMessage(node) {
    return node?.message && typeof node.message === "object"
        ? node.message
        : node;
}

function getNodeRole(node) {
    const message = getNodeMessage(node);
    return message?.author?.role ?? message?.role ?? node?.author?.role ?? null;
}

function getNodeMetadata(node) {
    const message = getNodeMessage(node);
    return message?.metadata ?? node?.metadata ?? {};
}

function isLiveOrAsyncNode(node) {
    const message = getNodeMessage(node);
    const status = message?.status ?? node?.status ?? null;
    const metadata = getNodeMetadata(node);

    return (
        status === "in_progress" ||
        Boolean(metadata.is_loading_message) ||
        Boolean(metadata.async_task_id) ||
        Boolean(metadata.async_completion_id)
    );
}

function isSafeForExistingNodeStableCache(node) {
    if (!node) {
        return false;
    }

    if (isLiveOrAsyncNode(node)) {
        return false;
    }

    const role = getNodeRole(node);

    // Conservative: only cache user turns for now.
    // Assistant/tool/system nodes can mutate after first appearing,
    // especially image-generation and async tool responses.
    return role === "user";
}

function isSafeForGetNodeByIdOrMessageIdCache(node) {
    if (!node) {
        return false;
    }

    if (isLiveOrAsyncNode(node)) {
        return false;
    }

    const role = getNodeRole(node);

    return role === "user";
}

export const cacheInstallerMethods = {
    ensureNodeObjectCache() {
        const store = requireStore(this);
        if (!store) return null;

        if (this.__nodeObjectCacheApi) {
            return this.__nodeObjectCacheApi;
        }

        const stats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                writes: 0,
                nullWrites: 0,
                cached: 0,
                lastClearReason: null,
                mode: "profiled:shared-node-object-cache",
            },
            {
                cached: 0,
                lastClearReason: null,
                mode: "production:shared-node-object-cache",
            }
        );

        const api = createNodeObjectCache({
            store,
            stats,
        });

        this.__nodeObjectCacheApi = api;
        this.__nodeObjectCache = api.cache;
        this.__nodeObjectCacheStats = stats;

        return api;
    },

    resolveNodeIdFromMessageId(id) {
        if (!this.__store) {
            this.__lastError = "store not registered";
            return null;
        }

        try {
            const node = this.__resolveNodeFast
                ? this.__resolveNodeFast(id)
                : resolveNodeCore(this, id);

            this.__lastError = null;
            return node?.id || null;
        } catch (error) {
            this.__lastError = String(error?.message || error);
            return null;
        }
    },

    installMessageIdIndex() {
        const store = requireStore(this);
        if (!store) return unavailable("store not registered");

        const original = getStoreMethod(store, "messageIdToExistingNodeId");

        if (!original) {
            return {
                ok: true,
                skipped: true,
                reason: "messageIdToExistingNodeId unavailable",
            };
        }

        if (this.__messageIdIndexInstalled) {
            return {
                ok: true,
                alreadyInstalled: true,
                stats: this.getMessageIdIndexStats(),
            };
        }

        const stats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                fallbackHits: 0,
                activeHits: 0,
                activeMisses: 0,
                cached: 0,
                mode: "profiled:lazy-unbounded-stale-plus-active-epoch",
            },
            {
                cached: 0,
                mode: "production:lazy-unbounded-stale-plus-active-epoch",
            }
        );

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

                    updateCachedCount(stats, index);
                }

                return function lazyMessageIdToExistingNodeId(messageId) {
                    const cached = index.get(messageId);

                    if (cached !== undefined) {
                        if (ENABLE_CACHE_PROFILING) stats.hits += 1;
                        return cached;
                    }

                    const currentLeafId = getCurrentLeafId();

                    if (messageId === currentLeafId) {
                        const epoch = bridge.__storeReadEpoch;

                        if (
                            activeEpoch === epoch &&
                            activeKey === messageId
                        ) {
                            if (ENABLE_CACHE_PROFILING) stats.activeHits += 1;
                            return activeValue;
                        }

                        if (ENABLE_CACHE_PROFILING) stats.activeMisses += 1;

                        const result = original.call(store, messageId) ?? null;

                        activeEpoch = epoch;
                        activeKey = messageId;
                        activeValue = result;

                        return result;
                    }

                    if (ENABLE_CACHE_PROFILING) stats.misses += 1;

                    const result = original.call(store, messageId) ?? null;

                    if (result) {
                        if (ENABLE_CACHE_PROFILING) stats.fallbackHits += 1;
                        remember(messageId, result);
                    }

                    return result;
                };
            },
        });

        return {
            ...result,
            indexSize: this.__messageIdIndex?.size ?? 0,
            profiled: ENABLE_CACHE_PROFILING,
        };
    },

    getMessageIdIndexStats() {
        return getCacheSnapshot(
            this,
            "__messageIdIndexInstalled",
            "__messageIdIndex",
            "__messageIdIndexStats"
        );
    },

    uninstallMessageIdIndex() {
        return uninstallMethodFrameCache({
            bridge: this,
            originalSlot: "__messageIdIndexOriginal",
            installedFlag: "__messageIdIndexInstalled",
        });
    },

    installExistingNodeStableCache() {
        const store = requireStore(this);
        if (!store) return unavailable("store not registered");

        if (this.__existingNodeStableCacheInstalled) {
            return {
                ok: true,
                alreadyInstalled: true,
                stats: this.__existingNodeStableCacheStats,
            };
        }

        const stats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                cached: 0,
                activeCached: 0,
                normalOriginal: 0,
                normalCached: 0,
                mode: "profiled:persistent+confirmed-direct-index+live-epoch",
            },
            {
                cached: 0,
                mode: "production:persistent+confirmed-direct-index+live-epoch",
            }
        );

        const frameCache = createPersistentCache({
            stats,
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

                return function cachedGetNodeIfExistsLive(id) {
                    const epoch = bridge.__storeReadEpoch;

                    if (
                        activeEpoch === epoch &&
                        activeId === id
                    ) {
                        if (ENABLE_CACHE_PROFILING) stats.activeCached += 1;
                        return activeValue;
                    }

                    const cached = get(id);

                    if (cached !== undefined) {
                        if (ENABLE_CACHE_PROFILING) stats.normalCached += 1;

                        activeEpoch = epoch;
                        activeId = id;
                        activeValue = cached;

                        return cached;
                    }

                    if (ENABLE_CACHE_PROFILING) stats.normalOriginal += 1;

                    const result = original.call(store, id) ?? null;

                    if (isSafeForExistingNodeStableCache(result)) {
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
            profiled: ENABLE_CACHE_PROFILING,
        };
    },

    clearExistingNodeStableCache(reason = "clear-existing-node-stable-cache") {
        this.__existingNodeStableCacheApi?.clear?.(reason);

        return {
            ok: true,
            reason,
            size: this.__existingNodeStableCache?.size ?? 0,
        };
    },

    getExistingNodeStableCacheStats() {
        return getCacheSnapshot(
            this,
            "__existingNodeStableCacheInstalled",
            "__existingNodeStableCache",
            "__existingNodeStableCacheStats"
        );
    },

    uninstallExistingNodeStableCache() {
        return uninstallMethodFrameCache({
            bridge: this,
            originalSlot: "__existingNodeStableCacheOriginal",
            installedFlag: "__existingNodeStableCacheInstalled",
        });
    },

    installGetNodeByIdOrMessageIdCache() {
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

        const nodeCache = this.ensureNodeObjectCache();

        const stats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                writes: 0,
                nullWrites: 0,
                liveBypasses: 0,
                inProgressBypasses: 0,
                cached: 0,
                mode: "profiled:id-alias-cache+shared-node-cache:stable-only",
            },
            {
                cached: 0,
                mode: "production:id-alias-cache+shared-node-cache:stable-only",
            }
        );

        const aliasCache = createPersistentCache({
            stats,
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
                if (ENABLE_CACHE_PROFILING) {
                    stats.nullWrites += 1;
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

            if (ENABLE_CACHE_PROFILING) {
                stats.writes += 1;
            }

            updateCachedCount(stats, aliasCache.cache);

            return node;
        }

        const result = installStoreMethodWrapper({
            bridge: this,
            methodName: "getNodeByIdOrMessageId",
            originalSlot: "__getNodeByIdOrMessageIdCacheOriginal",
            installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
            createWrapper: ({ store, original }) =>
                function cachedGetNodeByIdOrMessageId(id) {
                    if (!id) {
                        return original.call(store, id) ?? null;
                    }

                    if (id === readCurrentLeafId()) {
                        if (ENABLE_CACHE_PROFILING) stats.liveBypasses += 1;
                        return original.call(store, id) ?? null;
                    }

                    const cached = getCachedNode(id);

                    if (cached !== undefined) {
                        if (ENABLE_CACHE_PROFILING) stats.hits += 1;
                        return cached;
                    }

                    if (ENABLE_CACHE_PROFILING) stats.misses += 1;

                    const result = original.call(store, id) ?? null;

                    if (!isSafeForGetNodeByIdOrMessageIdCache(result)) {
                        if (ENABLE_CACHE_PROFILING) stats.inProgressBypasses += 1;
                        return result;
                    }

                    return remember(id, result);
                },
        });

        return {
            ...result,
            profiled: ENABLE_CACHE_PROFILING,
        };
    },

    getGetNodeByIdOrMessageIdCacheStats() {
        return getCacheSnapshot(
            this,
            "__getNodeByIdOrMessageIdCacheInstalled",
            "__getNodeByIdOrMessageIdCache",
            "__getNodeByIdOrMessageIdCacheStats"
        );
    },

    uninstallGetNodeByIdOrMessageIdCache() {
        return uninstallMethodFrameCache({
            bridge: this,
            originalSlot: "__getNodeByIdOrMessageIdCacheOriginal",
            installedFlag: "__getNodeByIdOrMessageIdCacheInstalled",
        });
    },

    installBranchCache() {
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

        const findMessageOriginal = getStoreMethod(store, "findMessage");
        const someMessageOriginal = getStoreMethod(store, "someMessage");
        const findMessageFromLeafOriginal = getStoreMethod(store, "findMessageFromLeaf");
        const findFirstOriginal = getStoreMethod(store, "findFirst");
        const findFirstFromLeafOriginal = getStoreMethod(store, "findFirstFromLeaf");
        const findFirstFromLeafToParentOriginal = getStoreMethod(
            store,
            "findFirstFromLeafToParent"
        );

        const originals = {};

        if (getBranchOriginal) {
            originals.getBranch = getBranchOriginal;
        }

        if (getBranchFromLeafOriginal) {
            originals.getBranchFromLeaf = getBranchFromLeafOriginal;
        }

        if (findMessageOriginal) {
            originals.findMessage = findMessageOriginal;
        }

        if (someMessageOriginal) {
            originals.someMessage = someMessageOriginal;
        }

        if (findMessageFromLeafOriginal) {
            originals.findMessageFromLeaf = findMessageFromLeafOriginal;
        }

        if (findFirstOriginal) {
            originals.findFirst = findFirstOriginal;
        }

        if (findFirstFromLeafOriginal) {
            originals.findFirstFromLeaf = findFirstFromLeafOriginal;
        }

        if (findFirstFromLeafToParentOriginal) {
            originals.findFirstFromLeafToParent = findFirstFromLeafToParentOriginal;
        }

        if (Object.keys(originals).length === 0) {
            return { ok: false, reason: "no branch methods available" };
        }

        const getBranchStats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                cached: 0,
                mode: "profiled:persistent:getBranch",
            },
            {
                cached: 0,
                mode: "production:persistent:getBranch",
            }
        );

        const getBranchFromLeafStats = createCacheStats(
            {
                hits: 0,
                misses: 0,
                cached: 0,
                mode: "profiled:persistent:getBranchFromLeaf",
            },
            {
                cached: 0,
                mode: "production:persistent:getBranchFromLeaf",
            }
        );

        const branchSearchStats = createCacheStats(
            {
                calls: 0,
                iterations: 0,
                matches: 0,
                fallbacks: 0,
                methods: {},
                mode: "profiled:branch-search-wrappers",
            },
            {
                mode: "production:branch-search-wrappers",
            }
        );

        const getBranchCache = createPersistentCache({
            stats: getBranchStats,
        });

        const getBranchFromLeafCache = createPersistentCache({
            stats: getBranchFromLeafStats,
        });

        this.__branchCache = {
            getBranch: getBranchCache.cache,
            getBranchFromLeaf: getBranchFromLeafCache.cache,
        };

        this.__branchCacheStats = {
            getBranch: getBranchStats,
            getBranchFromLeaf: getBranchFromLeafStats,
            branchSearch: branchSearchStats,
        };

        this.__branchCacheOriginals = originals;

        const bridgeRef = this;

        if (typeof getBranchOriginal === "function") {
            const getBranchGet = getBranchCache.get;
            const getBranchSet = getBranchCache.set;
            const recordBranchCallSite = ENABLE_BRANCH_CALLSITE_STATS
                ? bridgeRef.recordBranchCallSite?.bind(bridgeRef)
                : null;

            store.getBranch = function cachedGetBranch(...args) {
                if (recordBranchCallSite) {
                    recordBranchCallSite("getBranch", args);
                }

                const leafId =
                    typeof store.currentLeafId === "function"
                        ? store.currentLeafId()
                        : store.currentLeafId;

                const cacheKey = leafId || "__current_leaf__";

                const cached = getBranchGet(cacheKey);

                if (cached !== undefined) {
                    if (ENABLE_CACHE_PROFILING) getBranchStats.hits += 1;
                    return cached;
                }

                if (ENABLE_CACHE_PROFILING) getBranchStats.misses += 1;

                let result;

                if (typeof getBranchFromLeafOriginal === "function" && leafId) {
                    result = store.getBranchFromLeaf(leafId);
                } else {
                    result = getBranchOriginal.apply(store, args);
                }

                getBranchSet(cacheKey, result ?? null);
                updateCachedCount(getBranchStats, getBranchCache.cache);

                return result ?? null;
            };
        }

        if (typeof getBranchFromLeafOriginal === "function") {
            const getBranchFromLeafGet = getBranchFromLeafCache.get;
            const getBranchFromLeafSet = getBranchFromLeafCache.set;
            const recordBranchCallSite = ENABLE_BRANCH_CALLSITE_STATS
                ? bridgeRef.recordBranchCallSite?.bind(bridgeRef)
                : null;

            store.getBranchFromLeaf = function cachedGetBranchFromLeaf(leafId, ...rest) {
                if (recordBranchCallSite) {
                    recordBranchCallSite("getBranchFromLeaf", [leafId, ...rest]);
                }

                const cacheKey = leafId || "__missing_leaf__";

                const cached = getBranchFromLeafGet(cacheKey);

                if (cached !== undefined) {
                    if (ENABLE_CACHE_PROFILING) getBranchFromLeafStats.hits += 1;
                    return cached;
                }

                if (ENABLE_CACHE_PROFILING) getBranchFromLeafStats.misses += 1;

                const result = getBranchFromLeafOriginal.call(store, leafId, ...rest);

                getBranchFromLeafSet(cacheKey, result ?? null);
                updateCachedCount(
                    getBranchFromLeafStats,
                    getBranchFromLeafCache.cache
                );

                return result ?? null;
            };
        }

        const recordBranchSearch = createBranchSearchRecorder(branchSearchStats);

        function readCachedBranch(leafId) {
            if (!leafId || typeof store.getBranchFromLeaf !== "function") {
                return null;
            }

            const branch = store.getBranchFromLeaf(leafId);

            return Array.isArray(branch) ? branch : null;
        }

        function fallbackToOriginalSearch(methodName, original, args) {
            recordBranchSearch(methodName, {
                fallback: true,
            });

            return original.apply(store, args);
        }

        if (
            typeof findMessageOriginal === "function" &&
            typeof store.getBranchFromLeaf === "function"
        ) {
            store.findMessage = function cachedFindMessage(predicate, ...rest) {
                if (typeof predicate !== "function" || rest.length > 0) {
                    return fallbackToOriginalSearch(
                        "findMessage",
                        findMessageOriginal,
                        [predicate, ...rest]
                    );
                }

                const leafId =
                    typeof store.currentLeafId === "function"
                        ? store.currentLeafId()
                        : store.currentLeafId;

                let branch;

                try {
                    branch = readCachedBranch(leafId);
                } catch {
                    return fallbackToOriginalSearch(
                        "findMessage",
                        findMessageOriginal,
                        [predicate]
                    );
                }

                if (!branch) {
                    return fallbackToOriginalSearch(
                        "findMessage",
                        findMessageOriginal,
                        [predicate]
                    );
                }

                let iterations = 0;

                for (let index = branch.length - 1; index >= 0; index -= 1) {
                    const node = branch[index];

                    if (!node) {
                        continue;
                    }

                    iterations += 1;

                    const message = getBranchSearchMessage(node);

                    if (predicate(message)) {
                        recordBranchSearch("findMessage", {
                            iterations,
                            matched: true,
                        });

                        return message;
                    }

                    if (isBranchSearchRootNode(node)) {
                        break;
                    }
                }

                recordBranchSearch("findMessage", {
                    iterations,
                    matched: false,
                });

                return undefined;
            };
        }

        if (
            typeof someMessageOriginal === "function" &&
            typeof store.findMessage === "function"
        ) {
            store.someMessage = function cachedSomeMessage(predicate, ...rest) {
                if (typeof predicate !== "function" || rest.length > 0) {
                    return fallbackToOriginalSearch(
                        "someMessage",
                        someMessageOriginal,
                        [predicate, ...rest]
                    );
                }

                recordBranchSearch("someMessage");

                return store.findMessage(predicate) != null;
            };
        }

        if (
            typeof findMessageFromLeafOriginal === "function" &&
            typeof store.getBranchFromLeaf === "function"
        ) {
            store.findMessageFromLeaf = function cachedFindMessageFromLeaf(
                predicate,
                leafId,
                rootId = getStoreRootIdValue(store)
            ) {
                if (typeof predicate !== "function") {
                    return fallbackToOriginalSearch(
                        "findMessageFromLeaf",
                        findMessageFromLeafOriginal,
                        [predicate, leafId, rootId]
                    );
                }

                let rootNode = null;
                let branch = null;

                try {
                    rootNode =
                        typeof store.getNodeIfExists === "function"
                            ? store.getNodeIfExists(rootId)
                            : null;

                    branch = readCachedBranch(leafId);
                } catch {
                    return fallbackToOriginalSearch(
                        "findMessageFromLeaf",
                        findMessageFromLeafOriginal,
                        [predicate, leafId, rootId]
                    );
                }

                if (!rootNode || !branch) {
                    return fallbackToOriginalSearch(
                        "findMessageFromLeaf",
                        findMessageFromLeafOriginal,
                        [predicate, leafId, rootId]
                    );
                }

                let iterations = 0;

                for (let index = branch.length - 1; index >= 0; index -= 1) {
                    const node = branch[index];

                    if (!node) {
                        continue;
                    }

                    if (node === rootNode || node.id === rootNode.id) {
                        break;
                    }

                    iterations += 1;

                    const message = getBranchSearchMessage(node);

                    if (predicate(message)) {
                        recordBranchSearch("findMessageFromLeaf", {
                            iterations,
                            matched: true,
                        });

                        return message;
                    }
                }

                recordBranchSearch("findMessageFromLeaf", {
                    iterations,
                    matched: false,
                });

                return undefined;
            };
        }

        if (
            typeof findFirstOriginal === "function" &&
            typeof store.findFirstFromLeaf === "function"
        ) {
            store.findFirst = function cachedFindFirst(predicate, ...rest) {
                if (typeof predicate !== "function" || rest.length > 0) {
                    return fallbackToOriginalSearch(
                        "findFirst",
                        findFirstOriginal,
                        [predicate, ...rest]
                    );
                }

                const leafId =
                    typeof store.currentLeafId === "function"
                        ? store.currentLeafId()
                        : store.currentLeafId;

                recordBranchSearch("findFirst");

                return store.findFirstFromLeaf(predicate, leafId);
            };
        }

        if (
            typeof findFirstFromLeafOriginal === "function" &&
            typeof store.getBranchFromLeaf === "function"
        ) {
            store.findFirstFromLeaf = function cachedFindFirstFromLeaf(
                predicate,
                leafId
            ) {
                if (typeof predicate !== "function") {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeaf",
                        findFirstFromLeafOriginal,
                        [predicate, leafId]
                    );
                }

                let branch;

                try {
                    branch = readCachedBranch(leafId);
                } catch {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeaf",
                        findFirstFromLeafOriginal,
                        [predicate, leafId]
                    );
                }

                if (!branch) {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeaf",
                        findFirstFromLeafOriginal,
                        [predicate, leafId]
                    );
                }

                let iterations = 0;
                let result;

                for (let index = branch.length - 1; index >= 0; index -= 1) {
                    const node = branch[index];

                    if (!node) {
                        continue;
                    }

                    iterations += 1;

                    const message = getBranchSearchMessage(node);

                    if (predicate(message)) {
                        result = message;
                    }
                }

                recordBranchSearch("findFirstFromLeaf", {
                    iterations,
                    matched: result != null,
                });

                return result;
            };
        }

        if (
            typeof findFirstFromLeafToParentOriginal === "function" &&
            typeof store.getBranchFromLeaf === "function"
        ) {
            store.findFirstFromLeafToParent = function cachedFindFirstFromLeafToParent(
                predicate,
                leafId,
                parentId
            ) {
                if (typeof predicate !== "function") {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeafToParent",
                        findFirstFromLeafToParentOriginal,
                        [predicate, leafId, parentId]
                    );
                }

                let branch;

                try {
                    branch = readCachedBranch(leafId);
                } catch {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeafToParent",
                        findFirstFromLeafToParentOriginal,
                        [predicate, leafId, parentId]
                    );
                }

                if (!branch) {
                    return fallbackToOriginalSearch(
                        "findFirstFromLeafToParent",
                        findFirstFromLeafToParentOriginal,
                        [predicate, leafId, parentId]
                    );
                }

                let iterations = 0;
                let result;

                for (let index = branch.length - 1; index >= 0; index -= 1) {
                    const node = branch[index];

                    if (!node) {
                        continue;
                    }

                    iterations += 1;

                    const message = getBranchSearchMessage(node);

                    if (predicate(message)) {
                        result = message;
                    }

                    if (getBranchSearchParentId(node) === parentId) {
                        break;
                    }
                }

                recordBranchSearch("findFirstFromLeafToParent", {
                    iterations,
                    matched: result != null,
                });

                return result;
            };
        }

        this.__branchCacheInstalled = true;

        const result = {
            ok: true,
            installed: true,
            methods: Object.keys(originals),
            profiled: ENABLE_CACHE_PROFILING,
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

        if (
            this.__branchCacheStats?.getBranch &&
            "cached" in this.__branchCacheStats.getBranch
        ) {
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

    installResolvedNodeFrameCache() {
        const store = requireStore(this);
        if (!store) return unavailable("store not registered");

        if (this.__resolvedNodeFrameCacheInstalled) {
            return { ok: true, alreadyInstalled: true };
        }

        const stats = createCacheStats(
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
        });

        const nodeCache = this.ensureNodeObjectCache();

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

                    if (ENABLE_CACHE_PROFILING) {
                        stats.dualKeyWrites += 1;
                    }
                }

                if (ENABLE_CACHE_PROFILING) {
                    stats.nodeWrites += 1;
                    stats.resolvedNodeIds += 1;
                }

                updateCachedCount(stats, aliasCache.cache);

                return node;
            }

            aliasCache.set(inputId, null);

            if (ENABLE_CACHE_PROFILING) {
                stats.nullWrites += 1;
            }

            updateCachedCount(stats, aliasCache.cache);

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

        this.__resolveNodeFast = function resolveNodeFast(id) {
            let inputType = null;

            if (ENABLE_CACHE_PROFILING) {
                stats.calls += 1;

                inputType = classifyInput(id);

                if (inputType === "node") {
                    stats.nodeIdInputs += 1;
                } else if (inputType === "message") {
                    stats.messageIdInputs += 1;
                } else {
                    stats.unknownInputs += 1;
                }
            }

            const cached = getCachedResolvedNode(id);

            if (cached !== undefined) {
                if (ENABLE_CACHE_PROFILING) {
                    stats.hits += 1;

                    if (cached === null) {
                        stats.nullHits += 1;
                    } else {
                        stats.nodeHits += 1;
                    }
                }

                return cached;
            }

            if (ENABLE_CACHE_PROFILING) stats.misses += 1;

            const node = resolveNodeCore(bridgeRef, id);

            if (ENABLE_CACHE_PROFILING) {
                inputType ??= classifyInput(id);

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
            }

            return remember(id, node);
        };

        this.__resolvedNodeFrameCacheInstalled = true;

        return {
            ok: true,
            installed: true,
            methods: ["resolveNodeFast"],
            profiled: ENABLE_CACHE_PROFILING,
        };
    },

    uninstallResolvedNodeFrameCache() {
        this.__resolveNodeFast = null;
        this.__resolvedNodeFrameCacheInstalled = false;
        this.__resolvedNodeFrameCache = null;
        this.__resolvedNodeFrameCacheStats = null;

        return {
            ok: true,
            uninstalled: true,
        };
    },

    getResolvedNodeFrameCacheStats() {
        return getCacheSnapshot(
            this,
            "__resolvedNodeFrameCacheInstalled",
            "__resolvedNodeFrameCache",
            "__resolvedNodeFrameCacheStats"
        );
    },

    clearStableStoreReadCaches(reason = "clear-stable-store-read-caches") {
        this.__nodeObjectCacheApi?.clear?.(reason);
        this.__existingNodeStableCacheApi?.clear?.(reason);

        this.__messageIdIndex?.clear?.();
        this.__getNodeByIdOrMessageIdCache?.clear?.();
        this.__resolvedNodeFrameCache?.clear?.();

        this.clearBranchCache?.();

        updateCachedCount(this.__messageIdIndexStats, this.__messageIdIndex);
        updateCachedCount(
            this.__getNodeByIdOrMessageIdCacheStats,
            this.__getNodeByIdOrMessageIdCache
        );
        updateCachedCount(
            this.__resolvedNodeFrameCacheStats,
            this.__resolvedNodeFrameCache
        );

        return {
            ok: true,
            reason,
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

        this.clearBranchCache?.();

        this.__leafDescendantCache?.clear?.();
        this.__leafDescendantMissCache?.clear?.();

        this.__liveNodeCacheDirty = true;

        if (
            this.__liveNodeCacheId === nodeId ||
            aliases.includes(this.__liveNodeCacheId)
        ) {
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

    applyStoreReadOptimization({
        debug = false,
        clearStats = false,
    } = {}) {
        const startedAt = performance.now();

        this.__storeReadOptimizationRequested = true;
        this.__storeReadOptimizationDebug = Boolean(debug);

        if (!this.__store) {
            return {
                ok: false,
                reason: "store not registered",
            };
        }

        if (clearStats) {
            this.clearStableStoreReadCaches?.("apply-store-read-optimization");
        }

        const results = [];

        const installIfEnabled = (enabled, name, installer) => {
            if (!enabled) {
                results.push({
                    name,
                    skipped: true,
                    reason: "disabled by config",
                });
                return;
            }

            if (typeof installer !== "function") {
                results.push({
                    name,
                    ok: false,
                    reason: "installer unavailable",
                });
                return;
            }

            const result = installer.call(this);

            results.push({
                name,
                ...result,
            });
        };

        installIfEnabled(
            ENABLE_MESSAGE_ID_INDEX_CACHE,
            "messageIdIndex",
            this.installMessageIdIndex
        );

        installIfEnabled(
            ENABLE_EXISTING_NODE_STABLE_CACHE,
            "existingNodeStableCache",
            this.installExistingNodeStableCache
        );

        installIfEnabled(
            ENABLE_BRANCH_CACHE,
            "branchCache",
            this.installBranchCache
        );

        installIfEnabled(
            ENABLE_RESOLVED_NODE_FRAME_CACHE,
            "resolvedNodeFrameCache",
            this.installResolvedNodeFrameCache
        );

        installIfEnabled(
            ENABLE_GET_NODE_BY_ID_OR_MESSAGE_ID_CACHE,
            "getNodeByIdOrMessageIdCache",
            this.installGetNodeByIdOrMessageIdCache
        );

        if (ENABLE_STORE_PROFILER) {
            results.push({
                name: "storeProfiler",
                ...this.installStoreProfiler(),
            });
        }

        const durationMs = performance.now() - startedAt;

        this.__initTiming.lastApplyOptimizationMs = durationMs;

        if (debug || ENABLE_DEBUG) {
            console.log(DISCOVERY_LOG_PREFIX, "optimization install completed", {
                durationMs,
                profiled: ENABLE_CACHE_PROFILING,
                results,
            });
        }

        return {
            ok: true,
            profiled: ENABLE_CACHE_PROFILING,
            durationMs,
            results,
        };
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

    getStoreReadCacheStats() {
        return {
            installed: Boolean(
                this.__messageIdIndexInstalled ||
                this.__existingNodeStableCacheInstalled ||
                this.__getNodeByIdOrMessageIdCacheInstalled ||
                this.__branchCacheInstalled ||
                this.__resolvedNodeFrameCacheInstalled
            ),
            messageIdIndex: this.getMessageIdIndexStats?.(),
            existingNodeStableCache: this.getExistingNodeStableCacheStats?.(),
            getNodeByIdOrMessageIdCache: this.getGetNodeByIdOrMessageIdCacheStats?.(),
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
};