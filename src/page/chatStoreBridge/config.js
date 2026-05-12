export const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";

const DEFAULT_ENABLE_DEBUG = false;
const DEFAULT_ENABLE_STORE_PROFILER = false;
const DEFAULT_ENABLE_CACHE_PROFILING = false;
const DEFAULT_ENABLE_BRANCH_CALLSITE_STATS = false;
const DEFAULT_ENABLE_NODE_CALLSITE_STATS = false;
const DEFAULT_ENABLE_FIND_NODE_CALLSITE_STATS = false;

const DEFAULT_ENABLE_MESSAGE_ID_INDEX_CACHE = true;
const DEFAULT_ENABLE_EXISTING_NODE_STABLE_CACHE = true;
const DEFAULT_ENABLE_BRANCH_CACHE = true;
const DEFAULT_ENABLE_RESOLVED_NODE_FRAME_CACHE = true;
const DEFAULT_ENABLE_GET_NODE_BY_ID_OR_MESSAGE_ID_CACHE = true;

export const CONFIG = {
    bridgeVersion: 8,

    discovery: {
        maxFibers: 4000,
        maxObjects: 15000,
    },

    flags: {
        debug: DEFAULT_ENABLE_DEBUG,
        cacheProfiling: DEFAULT_ENABLE_CACHE_PROFILING,
        storeProfiler: DEFAULT_ENABLE_STORE_PROFILER,
        branchCallSites: DEFAULT_ENABLE_BRANCH_CALLSITE_STATS,
        nodeCallSites: DEFAULT_ENABLE_NODE_CALLSITE_STATS,
        findNodeCallSites: DEFAULT_ENABLE_FIND_NODE_CALLSITE_STATS,

        messageIdIndexCache: DEFAULT_ENABLE_MESSAGE_ID_INDEX_CACHE,
        existingNodeStableCache: DEFAULT_ENABLE_EXISTING_NODE_STABLE_CACHE,
        branchCache: DEFAULT_ENABLE_BRANCH_CACHE,
        resolvedNodeFrameCache: DEFAULT_ENABLE_RESOLVED_NODE_FRAME_CACHE,
        getNodeByIdOrMessageIdCache: DEFAULT_ENABLE_GET_NODE_BY_ID_OR_MESSAGE_ID_CACHE,
    },
};

export const DISCOVERY_LOG_PREFIX = "[thread-optimizer bridge init]";

export const PAGE_SCRIPT_TOKEN_ATTR =
    "data-thread-optimizer-chat-store-page-bridge-token";

export const TRUSTED_SOURCE = "thread-optimizer";

export const MESSAGE_TYPES = new Set([
    "thread-optimizer:set-pruning-state",
    "thread-optimizer:prune-store-history",
    "thread-optimizer:log-store-performance",
    "thread-optimizer:set-store-read-optimization",
    "thread-optimizer:visible-messages-ready",
]);

export const ENABLE_DEBUG =
    globalThis.__THREAD_OPTIMIZER_DEBUG__ === true ||
    DEFAULT_ENABLE_DEBUG;

export const ENABLE_STORE_PROFILER =
    globalThis.__THREAD_OPTIMIZER_STORE_PROFILER__ === true ||
    DEFAULT_ENABLE_STORE_PROFILER ||
    ENABLE_DEBUG;

export const ENABLE_CACHE_PROFILING =
    globalThis.__THREAD_OPTIMIZER_CACHE_PROFILING__ === true ||
    DEFAULT_ENABLE_CACHE_PROFILING ||
    ENABLE_DEBUG;

export const ENABLE_BRANCH_CALLSITE_STATS =
    globalThis.__THREAD_OPTIMIZER_BRANCH_CALLSITE_STATS__ === true ||
    DEFAULT_ENABLE_BRANCH_CALLSITE_STATS ||
    ENABLE_DEBUG;

export const ENABLE_NODE_CALLSITE_STATS =
    globalThis.__THREAD_OPTIMIZER_NODE_CALLSITE_STATS__ === true ||
    DEFAULT_ENABLE_NODE_CALLSITE_STATS ||
    ENABLE_DEBUG;

export const ENABLE_FIND_NODE_CALLSITE_STATS =
    globalThis.__THREAD_OPTIMIZER_FIND_NODE_CALLSITE_STATS__ === true ||
    DEFAULT_ENABLE_FIND_NODE_CALLSITE_STATS ||
    ENABLE_DEBUG;

export const ENABLE_MESSAGE_ID_INDEX_CACHE =
    CONFIG.flags.messageIdIndexCache;

export const ENABLE_EXISTING_NODE_STABLE_CACHE =
    CONFIG.flags.existingNodeStableCache;

export const ENABLE_BRANCH_CACHE =
    CONFIG.flags.branchCache;

export const ENABLE_RESOLVED_NODE_FRAME_CACHE =
    CONFIG.flags.resolvedNodeFrameCache;

export const ENABLE_GET_NODE_BY_ID_OR_MESSAGE_ID_CACHE =
    CONFIG.flags.getNodeByIdOrMessageIdCache;