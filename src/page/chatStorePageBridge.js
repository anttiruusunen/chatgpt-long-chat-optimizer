import {
    GLOBAL_KEY,
    CONFIG,
    DISCOVERY_LOG_PREFIX,
    ENABLE_DEBUG,
    ENABLE_STORE_PROFILER,
    ENABLE_BRANCH_CALLSITE_STATS,
    ENABLE_CACHE_PROFILING,
    ENABLE_NODE_CALLSITE_STATS,
    ENABLE_FIND_NODE_CALLSITE_STATS,
} from "./chatStoreBridge/config.js";

import {
    getBridgeTokenFromCurrentScript,
    isTrustedBridgeMessage,
} from "./chatStoreBridge/protocol.js";

import {
    clearBridgeSlots,
    getNodeDirectFresh,
    getStoreCurrentLeafId,
    getStoreNodeCount,
    unavailable,
} from "./chatStoreBridge/common.js";

import {
    getStoreMethod,
    installStoreMethodWrapper,
    resetFrameCacheStats,
    requireStore,
} from "./chatStoreBridge/cacheCore.js";

import {
    STABLE_CACHE_SLOTS,
    resetStoreEnhancementSlots,
} from "./chatStoreBridge/storeEnhancements.js";

import {
    getVisibleConversationTurnCount,
    getEstimatedConversationTurnCount,
    getExpectedMinimumStoreNodeCount,
} from "./chatStoreBridge/domState.js";

import {
    candidateStoreCanResolveVisibleNewestNode,
    getStoreInfo,
    rejectStore,
    validateStoreCandidate,
} from "./chatStoreBridge/storeValidation.js";

import {
    createDiscoveryLimits,
    discoverStoreFromFiberRoot,
    getFiberRoots,
} from "./chatStoreBridge/discovery.js";

import {
    collectRecentExchangeKeepNodeIdsFromActiveBranch,
    deleteStoreNodeFresh,
    getActiveStoreBranchNewestFirst,
    getStoreRootId,
    summarizeStoreNode,
} from "./chatStoreBridge/storeTopology.js";

import {
    requestStoreBackedConversationRefresh,
} from "./chatStoreBridge/refresh.js";

import {
    createEmptyMethodProfile,
    normalizeStack,
} from "./chatStoreBridge/profiling.js";

import {
    cacheInstallerMethods,
} from "./chatStoreBridge/cacheInstallers.js";

const ENABLE_DEV_DIAGNOSTICS =
    typeof __DEV__ !== "undefined" && __DEV__ === true;

(() => {
    const BRIDGE_TOKEN = getBridgeTokenFromCurrentScript();

    if (!BRIDGE_TOKEN) {
        if (ENABLE_DEV_DIAGNOSTICS) {
            console.warn(
                "[thread-optimizer bridge] blocked install because bridge token is missing"
            );
        }
        return;
    }

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    function shouldAdvanceStoreEpoch(reason) {
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

            if (role === "user") {
                return "topology-mutation";
            }

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

    function validateBridgeMessage(data) {
        switch (data.type) {
            case "thread-optimizer:set-pruning-state": {
                const prunedTurnCount = Number(data.prunedTurnCount);
                const historyKeptExchanges = Number(data.historyKeptExchanges);

                return {
                    ok: true,
                    value: {
                        enabled: Boolean(data.enabled),
                        prunedTurnCount:
                            Number.isFinite(prunedTurnCount) && prunedTurnCount >= 0
                                ? prunedTurnCount
                                : 0,
                        historyKeptExchanges:
                            Number.isFinite(historyKeptExchanges) &&
                            historyKeptExchanges >= 1
                                ? Math.floor(historyKeptExchanges)
                                : 1,
                    },
                };
            }

            case "thread-optimizer:prune-store-history": {
                const historyKeptExchanges = Number(data.historyKeptExchanges);

                return {
                    ok: true,
                    value: {
                        historyKeptExchanges:
                            Number.isFinite(historyKeptExchanges) &&
                            historyKeptExchanges >= 1
                                ? Math.floor(historyKeptExchanges)
                                : 1,
                        reason:
                            typeof data.reason === "string"
                                ? data.reason.slice(0, 100)
                                : "store-prune",
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
        __knownHistoryKeptExchanges: 1,

        __pendingStoreHistoryPrune: null,
        __pendingStoreHistoryPruneScheduled: false,

        __startupStorePruneScheduled: false,
        __startupStorePruneCompletedForStore: null,

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

        __branchCacheInstalled: false,
        __branchCacheOriginals: null,
        __branchCache: null,
        __branchCacheStats: null,
        __branchCacheLastInstallResult: null,
        __branchCacheClearScheduled: false,

        __resolvedNodeFrameCacheInstalled: false,
        __resolvedNodeFrameCache: null,
        __resolvedNodeFrameCacheStats: null,
        __resolveNodeFast: null,

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

        __findNodeCallSiteProfilerInstalled: false,
        __findNodeCallSiteProfilerOriginal: null,
        __findNodeCallSiteProfilerStats: null,

        __nodeObjectCache: null,
        __nodeObjectCacheStats: null,
        __nodeObjectCacheApi: null,

        ...cacheInstallerMethods,

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
                    deleteNode: Boolean(
                        this.__store &&
                        typeof this.__store.deleteNode === "function"
                    ),
                    getNodeIfExists: Boolean(
                        this.__store &&
                        typeof this.__store.getNodeIfExists === "function"
                    ),
                    messageIdToExistingNodeId: Boolean(
                        this.__store &&
                        typeof this.__store.messageIdToExistingNodeId === "function"
                    ),
                    getBranch: Boolean(
                        this.__store &&
                        typeof this.__store.getBranch === "function"
                    ),
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

        queueStoreHistoryPrune({
            historyKeptExchanges = 1,
            reason = "queued-store-prune",
        } = {}) {
            const keepCount = Math.max(
                1,
                Math.floor(Number(historyKeptExchanges) || 1)
            );

            this.__pendingStoreHistoryPrune = {
                historyKeptExchanges: keepCount,
                reason,
                queuedAt: Date.now(),
            };

            if (ENABLE_DEV_DIAGNOSTICS) {
                console.debug("[thread-optimizer bridge] queued store history prune", {
                    reason,
                    historyKeptExchanges: keepCount,
                    hasStore: Boolean(this.__store),
                    pruningEnabled: this.__knownPruningEnabled,
                });
            }

            return {
                ok: true,
                queued: true,
                historyKeptExchanges: keepCount,
                reason,
            };
        },

        flushPendingStoreHistoryPrune(reason = "flush-pending-store-prune") {
            if (this.__pendingStoreHistoryPruneScheduled) {
                return {
                    ok: true,
                    flushed: false,
                    reason: "flush already scheduled",
                };
            }

            if (!this.__pendingStoreHistoryPrune) {
                return {
                    ok: true,
                    flushed: false,
                    reason: "no pending store history prune",
                };
            }

            if (!this.__store) {
                return {
                    ok: false,
                    flushed: false,
                    reason: "store not registered",
                };
            }

            this.__pendingStoreHistoryPruneScheduled = true;

            window.setTimeout(() => {
                this.__pendingStoreHistoryPruneScheduled = false;

                const pending = this.__pendingStoreHistoryPrune;

                if (!pending) {
                    return;
                }

                if (!this.__store) {
                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug(
                            "[thread-optimizer bridge] kept pending store prune because store disappeared",
                            {
                                reason,
                                pending,
                            }
                        );
                    }
                    return;
                }

                if (!this.__knownPruningEnabled) {
                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug(
                            "[thread-optimizer bridge] dropped pending store prune because pruning is disabled",
                            {
                                reason,
                                pending,
                            }
                        );
                    }

                    this.__pendingStoreHistoryPrune = null;
                    return;
                }

                this.__pendingStoreHistoryPrune = null;

                const result = this.pruneStoreHistory({
                    historyKeptExchanges: pending.historyKeptExchanges,
                    reason: `${pending.reason}:${reason}`,
                });

                this.__lastStoreHistoryPruneResult = result;

                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug("[thread-optimizer bridge] flushed pending store history prune", {
                        reason,
                        pending,
                        ok: result?.ok,
                        historyKeptExchanges: result?.historyKeptExchanges,
                        currentLeafId: result?.currentLeafId,
                        branchNodeCount: result?.branchNodeCount,
                        requestedDeleteCount: result?.deleteNodeIds?.length || 0,
                        deletedCount: result?.deleted?.length || 0,
                        failedCount: result?.failed?.length || 0,
                    });
                }
            }, 0);

            return {
                ok: true,
                flushed: false,
                scheduled: true,
                reason,
                pending: this.__pendingStoreHistoryPrune,
            };
        },

        scheduleStartupStorePrune(reason = "store-registered") {
            if (!this.__knownPruningEnabled) {
                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug(
                        "[thread-optimizer bridge] skipped startup store prune because pruning is disabled",
                        {
                            reason,
                            historyKeptExchanges: this.__knownHistoryKeptExchanges,
                        }
                    );
                }

                return {
                    ok: true,
                    scheduled: false,
                    reason: "pruning disabled",
                };
            }

            if (!this.__store) {
                return {
                    ok: false,
                    scheduled: false,
                    reason: "store not registered",
                };
            }

            if (this.__startupStorePruneScheduled) {
                return {
                    ok: true,
                    scheduled: false,
                    reason: "startup store prune already scheduled",
                };
            }

            if (this.__startupStorePruneCompletedForStore === this.__store) {
                return {
                    ok: true,
                    scheduled: false,
                    reason: "startup store prune already completed for this store",
                };
            }

            this.__startupStorePruneScheduled = true;

            window.setTimeout(() => {
                this.__startupStorePruneScheduled = false;

                if (!this.__knownPruningEnabled || !this.__store) {
                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug("[thread-optimizer bridge] canceled startup store prune", {
                            reason,
                            pruningEnabled: this.__knownPruningEnabled,
                            hasStore: Boolean(this.__store),
                        });
                    }
                    return;
                }

                const result = this.pruneStoreHistory({
                    historyKeptExchanges: this.__knownHistoryKeptExchanges,
                    reason: `startup:${reason}`,
                });

                this.__startupStorePruneCompletedForStore = this.__store;
                this.__lastStoreHistoryPruneResult = result;

                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug("[thread-optimizer bridge] startup store prune completed", {
                        reason,
                        ok: result?.ok,
                        historyKeptExchanges: result?.historyKeptExchanges,
                        currentLeafId: result?.currentLeafId,
                        branchNodeCount: result?.branchNodeCount,
                        requestedDeleteCount: result?.deleteNodeIds?.length || 0,
                        deletedCount: result?.deleted?.length || 0,
                        failedCount: result?.failed?.length || 0,
                    });
                }
            }, 0);

            return {
                ok: true,
                scheduled: true,
                reason,
                historyKeptExchanges: this.__knownHistoryKeptExchanges,
            };
        },

        registerStore(store, meta = null) {
            const validation = validateStoreCandidate(store);

            if (!validation.ok) {
                rejectStore(store, validation.reason);
                this.__lastError =
                    `registerStore rejected candidate: ${validation.reason}`;
                return false;
            }

            const currentStore = this.__store;
            const currentNodeCount = getStoreNodeCount(currentStore);
            const nextNodeCount = validation.nodeCount ?? getStoreNodeCount(store);

            if (currentStore === store) {
                return true;
            }

            if (currentStore && nextNodeCount < currentNodeCount) {
                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug("[thread-optimizer bridge] ignored smaller store candidate", {
                        currentNodeCount,
                        nextNodeCount,
                    });
                }
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

            if (ENABLE_DEV_DIAGNOSTICS) {
                console.log("[thread-optimizer bridge] store registered", {
                    nodeCount: getStoreNodeCount(this.__store),
                    status: this.status(),
                });
            }

            if (this.__storeReadOptimizationRequested) {
                const result = this.applyStoreReadOptimization({
                    debug: this.__storeReadOptimizationDebug,
                    clearStats: true,
                });

                if (!result?.ok) {
                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.warn(
                            "[thread-optimizer bridge] optimization failed after store registration",
                            result
                        );
                    }

                    this.disableStoreReadOptimization?.({ debug: false });
                    this.resetInstalledStoreEnhancements();

                    this.__lastError =
                        `optimization failed: ${result?.reason || "unknown"}`;
                    this.__storeValidationFailed = true;

                    return false;
                }

                if (ENABLE_DEV_DIAGNOSTICS && this.__storeReadOptimizationDebug) {
                    console.log(
                        "[thread-optimizer bridge] re-applied store read optimization after store registration",
                        result
                    );
                }
            }

            this.flushPendingStoreHistoryPrune?.("registerStore");
            this.scheduleStartupStorePrune?.("registerStore");

            return true;
        },

        repairDeletedNodeReferences(deletedNodeIds) {
            const store = this.__store;

            if (
                !store ||
                !Array.isArray(deletedNodeIds) ||
                deletedNodeIds.length === 0
            ) {
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

            temporarilyRestore(
                "messageIdToExistingNodeId",
                "__messageIdIndexOriginal"
            );
            temporarilyRestore(
                "getNodeIfExists",
                "__existingNodeStableCacheOriginal"
            );
            temporarilyRestore(
                "getNodeByIdOrMessageId",
                "__getNodeByIdOrMessageIdCacheOriginal"
            );

            const branchOriginals = this.__branchCacheOriginals;
            if (branchOriginals) {
                for (const methodName of ["getBranch"]) {
                    const original = branchOriginals[methodName];

                    if (
                        typeof original === "function" &&
                        store[methodName] !== original
                    ) {
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

        pruneStoreHistory({
            historyKeptExchanges = 1,
            reason = "store-prune",
        } = {}) {
            const store = this.__store;

            if (!store || typeof store.deleteNode !== "function") {
                return {
                    ok: false,
                    reason: "store/deleteNode unavailable",
                    historyKeptExchanges,
                    currentLeafId: null,
                    branchNodeCount: 0,
                    keepNodeIds: [],
                    deleteNodeIds: [],
                    deleted: [],
                    failed: [],
                };
            }

            const keepCount = Math.max(
                1,
                Math.floor(Number(historyKeptExchanges) || 1)
            );
            const rootId = getStoreRootId(store);
            const currentLeafId = getStoreCurrentLeafId(store);

            const branch = getActiveStoreBranchNewestFirst(store);
            const branchNodes = branch.nodes;

            if (!currentLeafId || branchNodes.length === 0) {
                return {
                    ok: false,
                    reason: "active branch unavailable",
                    historyKeptExchanges: keepCount,
                    currentLeafId,
                    branchNodeCount: branchNodes.length,
                    keepNodeIds: [],
                    deleteNodeIds: [],
                    deleted: [],
                    failed: [],
                };
            }

            const keepPlan = collectRecentExchangeKeepNodeIdsFromActiveBranch(store, {
                historyKeptExchanges: keepCount,
            });

            const keepNodeIds = keepPlan.keepNodeIds;

            keepNodeIds.add(currentLeafId);
            if (rootId) keepNodeIds.add(rootId);

            const deleteNodeIds = [];
            const skipped = [];

            for (const node of branchNodes) {
                if (!node?.id) continue;

                if (keepNodeIds.has(node.id)) {
                    skipped.push({
                        nodeId: node.id,
                        reason: "kept recent exchange/root",
                    });
                    continue;
                }

                deleteNodeIds.push(node.id);
            }

            const result = {
                ok: true,
                reason,
                historyKeptExchanges: keepCount,
                rootId,
                currentLeafId,
                branchNodeCount: branchNodes.length,
                branchTruncated: branch.truncated,
                keptExchangeCount: keepPlan.keptExchangeCount,
                keepWalkedNodeCount: keepPlan.walkedNodeCount,
                keepStopReason: keepPlan.stopReason,
                keepNodeIds: Array.from(keepNodeIds),
                deleteNodeIds,
                skipped,
                deleted: [],
                failed: [],
            };

            if (ENABLE_DEV_DIAGNOSTICS) {
                console.debug("[thread-optimizer bridge] store exchange prune plan", {
                    reason,
                    historyKeptExchanges: keepCount,
                    rootId,
                    currentLeafId,
                    branchNodeCount: branchNodes.length,
                    keptExchangeCount: keepPlan.keptExchangeCount,
                    keepWalkedNodeCount: keepPlan.walkedNodeCount,
                    keepStopReason: keepPlan.stopReason,
                    keepCount: keepNodeIds.size,
                    deleteCount: deleteNodeIds.length,
                    keepSamples: Array.from(keepNodeIds).slice(0, 20),
                    deleteSamples: deleteNodeIds.slice(0, 25),
                    newestBranchSamples: branchNodes
                        .slice(0, 12)
                        .map(summarizeStoreNode),
                });
            }

            if (deleteNodeIds.length === 0) {
                return result;
            }

            this.beginStoreTopologyMutation?.("store-prune");

            const runDeletes = () => {
                for (let i = deleteNodeIds.length - 1; i >= 0; i -= 1) {
                    const nodeId = deleteNodeIds[i];
                    const node = getNodeDirectFresh(store, nodeId);

                    if (node?.id) {
                        this.clearCachesForDeletedNode?.(node, nodeId);
                    }

                    const deleteResult = deleteStoreNodeFresh(store, nodeId, {
                        reason,
                    });

                    if (deleteResult.ok) {
                        result.deleted.push(deleteResult);
                    } else {
                        result.failed.push(deleteResult);
                    }
                }
            };

            if (typeof this.withOriginalTopologyMethods === "function") {
                this.withOriginalTopologyMethods(runDeletes);
            } else {
                runDeletes();
            }

            result.deletedCount = result.deleted.length;
            result.failedCount = result.failed.length;
            result.ok = result.failed.length === 0;

            if (result.deleted.length > 0) {
                this.clearFullTopologyCaches?.("store-prune-complete");

                window.setTimeout(() => {
                    result.refreshResult = requestStoreBackedConversationRefresh(store, {
                        reason: "store-prune-complete",
                        currentLeafId,
                    });

                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug(
                            "[thread-optimizer bridge] delayed store prune refresh completed",
                            {
                                reason,
                                refreshResult: result.refreshResult,
                            }
                        );
                    }
                }, 100);
            }

            if (ENABLE_DEV_DIAGNOSTICS) {
                console.debug("[thread-optimizer bridge] store prune completed", {
                    reason,
                    ok: result.ok,
                    historyKeptExchanges: keepCount,
                    requestedDeleteCount: deleteNodeIds.length,
                    deletedCount: result.deletedCount,
                    failedCount: result.failedCount,
                    refreshResult: result.refreshResult,
                    deletedSamples: result.deleted.slice(0, 20),
                    failedSamples: result.failed.slice(0, 20),
                });
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

                if (!this.__messageIdResolveWarningShown) {
                    this.__messageIdResolveWarningShown = true;

                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug(
                            "[thread-optimizer bridge] messageId resolver fallback unavailable",
                            {
                                error: this.__lastError,
                            }
                        );
                    }
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

                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.warn("[thread-optimizer bridge] getNodeByMessageId failed", error);
                }

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

        setKnownPruningState({
            enabled,
            prunedTurnCount,
            historyKeptExchanges,
        } = {}) {
            this.__knownPruningEnabled = Boolean(enabled);

            if (Number.isFinite(prunedTurnCount) && prunedTurnCount >= 0) {
                this.__knownPrunedTurnCount = prunedTurnCount;
            }

            if (
                Number.isFinite(historyKeptExchanges) &&
                historyKeptExchanges >= 1
            ) {
                this.__knownHistoryKeptExchanges = Math.floor(historyKeptExchanges);
            }

            return {
                ok: true,
                enabled: this.__knownPruningEnabled,
                prunedTurnCount: this.__knownPrunedTurnCount,
                historyKeptExchanges: this.__knownHistoryKeptExchanges,
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
                const limits = createDiscoveryLimits();

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

                if (
                    ENABLE_DEV_DIAGNOSTICS &&
                    (this.__found ||
                        this.__discoveryRuns === 1 ||
                        this.__discoveryRuns % 5 === 0)
                ) {
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

            if (ENABLE_DEV_DIAGNOSTICS) {
                console.debug("[thread-optimizer bridge] locked store discovery", {
                    reason,
                    status: this.status(),
                });
            }

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
                this.lockStoreDiscovery(
                    `${reason}:current-store-resolves-visible-newest`
                );

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
                this.lockStoreDiscovery(
                    `${reason}:rediscovered-store-resolves-visible-newest`
                );
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

            if (!ENABLE_STORE_PROFILER && !this.__storeReadOptimizationDebug) {
                return {
                    ok: true,
                    skipped: true,
                    reason: "store profiler disabled",
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
                    ...Object.getOwnPropertyNames(
                        Object.getPrototypeOf(store) || {}
                    ),
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
                        const profile =
                            bridgeRef.__getNodeByIdOrMessageIdCallSites ??= {
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
                                    profile.callSites[a].calls <
                                    profile.callSites[b].calls
                                        ? a
                                        : b
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
                        const methodProfile =
                            bridgeRef.__storeProfile?.methods?.[methodName];
                        if (methodProfile) methodProfile.errors += 1;
                        throw error;
                    } finally {
                        const elapsed = performance.now() - startedAt;
                        const methodProfile =
                            bridgeRef.__storeProfile?.methods?.[methodName];

                        if (methodProfile) {
                            methodProfile.calls += 1;
                            methodProfile.totalMs += elapsed;
                            methodProfile.lastMs = elapsed;
                            methodProfile.maxMs = Math.max(
                                methodProfile.maxMs,
                                elapsed
                            );

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
                for (const [methodName, original] of Object.entries(
                    this.__storeProfilerOriginals
                )) {
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

            for (const [methodName, profile] of Object.entries(
                this.__storeProfile.methods
            )) {
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
                existing.methods[methodName] =
                    (existing.methods[methodName] || 0) + 1;
                existing.lastArgs = argSummary;
                existing.lastSeenAt = Date.now();
                return;
            }

            const keys = Object.keys(stats.callSites);

            if (keys.length >= stats.maxCallSites) {
                const lowestKey = keys.reduce((lowest, key) => {
                    return stats.callSites[key].calls <
                        stats.callSites[lowest].calls
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

        installFindNodeCallSiteProfiler({
            maxCallSites = 50,
            sampleEvery = 100,
            maxPredicateSourcesPerSite = 10,
            predicateSourcePreviewLength = 500,
        } = {}) {
            const store = requireStore(this);
            if (!store) return unavailable("store not registered");

            if (!ENABLE_FIND_NODE_CALLSITE_STATS) {
                return {
                    ok: true,
                    skipped: true,
                    reason: "findNode call-site profiler disabled",
                };
            }

            if (this.__findNodeCallSiteProfilerInstalled) {
                return { ok: true, alreadyInstalled: true };
            }

            const original = getStoreMethod(store, "findNode");
            if (!original) return unavailable("findNode unavailable");

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
                    return `[[Function#toString failed: ${String(
                        error?.message || error
                    )}]]`;
                }
            }

            function recordPredicateSource(entry, source, now) {
                if (!source) return;

                const sources = entry.predicateSources ??= {};
                let sourceEntry = sources[source];

                if (sourceEntry) {
                    sourceEntry.calls += 1;
                    sourceEntry.lastSeenAt = now;
                    return;
                }

                const keys = Object.keys(sources);

                if (keys.length >= maxPredicateSourcesPerSite) {
                    const lowest = keys.reduce((a, b) =>
                        sources[a].calls < sources[b].calls ? a : b
                    );

                    delete sources[lowest];
                }

                sources[source] = {
                    calls: 1,
                    firstSeenAt: now,
                    lastSeenAt: now,
                };
            }

            store.findNode = function profiledFindNodeCallSite(...args) {
                stats.totalCalls += 1;

                const sampleThisCall = (stats.totalCalls % sampleEvery) === 0;
                const result = original.apply(store, args);

                if (sampleThisCall) {
                    stats.sampledCalls += 1;

                    const now = Date.now();
                    const stack = normalizeFindNodeStack(new Error().stack);
                    const predicateSource = getPredicateSourcePreview(args[0]);

                    let entry = stats.callSites[stack];

                    if (entry) {
                        entry.calls += 1;
                        entry.lastArgType = typeof args[0];
                        entry.lastSeenAt = now;
                    } else {
                        const keys = Object.keys(stats.callSites);

                        if (keys.length >= maxCallSites) {
                            const lowest = keys.reduce((a, b) =>
                                stats.callSites[a].calls <
                                stats.callSites[b].calls
                                    ? a
                                    : b
                            );

                            delete stats.callSites[lowest];
                        }

                        entry = stats.callSites[stack] = {
                            calls: 1,
                            firstArgType: typeof args[0],
                            lastArgType: typeof args[0],
                            firstSeenAt: now,
                            lastSeenAt: now,
                            predicateSources: {},
                        };
                    }

                    recordPredicateSource(entry, predicateSource, now);
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
                return {
                    ok: false,
                    reason: "findNode call-site profiler not installed",
                };
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
                        const topPredicateSources = Object.entries(
                            data.predicateSources || {}
                        )
                            .map(([source, sourceData]) => ({
                                source,
                                calls: sourceData.calls,
                                firstSeenAt: sourceData.firstSeenAt,
                                lastSeenAt: sourceData.lastSeenAt,
                            }))
                            .sort((a, b) => b.calls - a.calls)
                            .slice(0, stats.maxPredicateSourcesPerSite);

                        return {
                            stack,
                            calls: data.calls,
                            firstArgType: data.firstArgType,
                            lastArgType: data.lastArgType,
                            firstSeenAt: data.firstSeenAt,
                            lastSeenAt: data.lastSeenAt,
                            uniquePredicateSourceCount: Object.keys(
                                data.predicateSources || {}
                            ).length,
                            topPredicateSources,
                        };
                    })
                    .sort((a, b) => b.calls - a.calls)
                    .slice(0, 20),
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

        clearPerformanceStats() {
            this.clearStoreProfile?.();

            if (this.__messageIdIndexStats) {
                this.__messageIdIndexStats.hits = 0;
                this.__messageIdIndexStats.misses = 0;
                this.__messageIdIndexStats.fallbackHits = 0;
                this.__messageIdIndexStats.activeHits = 0;
                this.__messageIdIndexStats.activeMisses = 0;
                this.__messageIdIndexStats.cached =
                    this.__messageIdIndex?.size ?? 0;
            }

            for (const [cacheSlot, statsSlot] of STABLE_CACHE_SLOTS) {
                if (cacheSlot === "__branchCache") {
                    resetFrameCacheStats(
                        this.__branchCacheStats?.getBranch,
                        this.__branchCache?.getBranch
                    );

                    continue;
                }

                resetFrameCacheStats(this[statsSlot], this[cacheSlot]);
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
                getNodeByIdOrMessageIdCache:
                    this.getGetNodeByIdOrMessageIdCacheStats?.(),
                branchCache: this.getBranchCacheStats?.(),
                resolvedNodeFrameCache: this.getResolvedNodeFrameCacheStats?.(),

                branchCallSites: this.getBranchCallSiteStats?.(),
                getNodeByIdOrMessageIdCallSites:
                    this.getNodeByIdOrMessageIdCallSiteStats?.(),
                initTiming: this.getInitTiming?.(),
                profile: this.getStoreProfile?.(),
                findNodeCallSites: this.getFindNodeCallSiteProfilerStats?.(),
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
            if (shouldAdvanceStoreEpoch(reason)) {
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

            const recordInvalidation = (
                cacheName,
                action,
                sizeBefore = 0,
                extra = null
            ) => {
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

                recordInvalidation("__branchCache.getBranch", "skipped", getBranchSize, {
                    why,
                });
            };

            const recordCacheSkip = (cacheSlot, why) => {
                const cache = this[cacheSlot];

                recordInvalidation(cacheSlot, "skipped", cache?.size ?? 0, {
                    why,
                });
            };

            if (!shouldHardClear) {
                for (const [cacheSlot] of STABLE_CACHE_SLOTS) {
                    if (cacheSlot === "__branchCache") {
                        recordBranchSkip("cache preserved until conversation/store reset");
                        continue;
                    }

                    recordCacheSkip(
                        cacheSlot,
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

                    this.clearBranchCache?.();

                    recordInvalidation(
                        "__branchCache.getBranch",
                        "cleared",
                        getBranchSize
                    );

                    if (ENABLE_CACHE_PROFILING && this.__branchCacheStats) {
                        if (this.__branchCacheStats.getBranch) {
                            this.__branchCacheStats.getBranch.cached = 0;
                        }
                    }

                    continue;
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

        getInitTiming() {
            const now = performance.now();

            return {
                installedForMs:
                    Math.round((now - this.__initTiming.installedAt) * 10) / 10,
                firstDiscoveryStartedAt: this.__initTiming.firstDiscoveryStartedAt,
                firstDiscoveryCompletedAt: this.__initTiming.firstDiscoveryCompletedAt,
                lastDiscoveryMs:
                    Math.round(this.__initTiming.lastDiscoveryMs * 10) / 10,
                lastApplyOptimizationMs:
                    Math.round(this.__initTiming.lastApplyOptimizationMs * 10) / 10,
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
                createWrapper: ({ store, original, bridge }) =>
                    function indexedMutationWrapper(...args) {
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
            if (
                !this.__indexRefreshHooksInstalled ||
                !this.__indexRefreshHookOriginals
            ) {
                return { ok: true, alreadyUninstalled: true };
            }

            if (this.__store) {
                for (const [methodName, original] of Object.entries(
                    this.__indexRefreshHookOriginals
                )) {
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
            if (!isTrustedBridgeMessage(event, BRIDGE_TOKEN)) {
                return;
            }

            const data = event.data;
            const validation = validateBridgeMessage(data);

            if (!validation.ok) {
                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug("[thread-optimizer bridge] ignored invalid bridge message", {
                        type: data.type,
                        reason: validation.reason,
                    });
                }
                return;
            }

            const payload = validation.value;

            if (data.type === "thread-optimizer:set-pruning-state") {
                bridge.setKnownPruningState({
                    enabled: payload.enabled,
                    prunedTurnCount: payload.prunedTurnCount,
                    historyKeptExchanges: payload.historyKeptExchanges,
                });

                bridge.flushPendingStoreHistoryPrune?.("pruning-state-updated");
                bridge.scheduleStartupStorePrune?.("pruning-state-updated");

                return;
            }

            if (data.type === "thread-optimizer:prune-store-history") {
                if (!bridge.__store) {
                    const queued = bridge.queueStoreHistoryPrune({
                        historyKeptExchanges: payload.historyKeptExchanges,
                        reason: payload.reason,
                    });

                    if (ENABLE_DEV_DIAGNOSTICS) {
                        console.debug(
                            "[thread-optimizer bridge] queued store prune bridge request because store is unavailable",
                            {
                                ok: queued.ok,
                                historyKeptExchanges: queued.historyKeptExchanges,
                                reason: queued.reason,
                            }
                        );
                    }

                    return;
                }

                const result = bridge.pruneStoreHistory({
                    historyKeptExchanges: payload.historyKeptExchanges,
                    reason: payload.reason,
                });

                if (ENABLE_DEV_DIAGNOSTICS) {
                    console.debug("[thread-optimizer bridge] store prune bridge result", {
                        ok: result.ok,
                        reason: result.reason,
                        historyKeptExchanges: result.historyKeptExchanges,
                        currentLeafId: result.currentLeafId,
                        branchNodeCount: result.branchNodeCount,
                        requestedDeleteCount: result.deleteNodeIds?.length || 0,
                        deletedCount: result.deleted?.length || 0,
                        failedCount: result.failed?.length || 0,
                        result,
                    });
                }

                return;
            }

            if (data.type === "thread-optimizer:log-store-performance") {
                if (ENABLE_DEBUG) {
                    console.debug(
                        "[thread-optimizer bridge] received store performance log request"
                    );
                    console.log(
                        "[thread-optimizer bridge] store performance",
                        bridge.getPerformanceSnapshot()
                    );
                }
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
                    return;
                }

                bridge.applyStoreReadOptimization?.({
                    debug: payload.debug,
                    clearStats: true,
                });

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

        bridge.__pendingStoreHistoryPrune = null;
        bridge.__pendingStoreHistoryPruneScheduled = false;
        bridge.__startupStorePruneScheduled = false;
        bridge.__startupStorePruneCompletedForStore = null;
    }

    window.addEventListener("popstate", checkConversationChanged);

    const originalPushState = history.pushState;
    history.pushState = function patchedPushState(...args) {
        const result = originalPushState.apply(this, args);
        queueMicrotask(checkConversationChanged);
        return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function patchedReplaceState(...args) {
        const result = originalReplaceState.apply(this, args);
        queueMicrotask(checkConversationChanged);
        return result;
    };
})();