export const STATE_KEY = "__threadOptimizerState";
export const PRUNED_ATTR = "data-thread-optimizer-pruned";
export const PLACEHOLDER_ATTR = "data-thread-optimizer-placeholder";
export const OFFSCREEN_OPT_ATTR = "data-thread-optimizer-offscreen-opt";
export const STREAMING_SECTION_HIDDEN_ATTR = "data-thread-optimizer-stream-hidden";
export const CODE_BLOCK_OFFSCREEN_OPT_ATTR = "data-thread-optimizer-code-offscreen-opt";
export const CODE_BLOCK_COLLAPSED_ATTR = "data-thread-optimizer-code-collapsed";
export const CODE_BLOCK_PLACEHOLDER_ATTR = "data-thread-optimizer-code-placeholder";
export const TOP_RESTORE_SENTINEL_ATTR = "data-thread-optimizer-top-restore-sentinel";
export const BOTTOM_PRUNE_SENTINEL_ATTR = "data-thread-optimizer-bottom-prune-sentinel";
export const UNPRUNEABLE_ATTR = "data-thread-optimizer-unpruneable";
export const OUT_OF_WINDOW_ATTR = "data-thread-optimizer-out-of-window";

export const DEFAULT_SETTINGS = {
    historyKeptExchanges: 10,
    autoPrune: true,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableLargeCodeBlockOptimization: true,
    enableStreamingSectionHiding: true,
    enableDebugLogging: false,
};

if (!window[STATE_KEY]) {
    window[STATE_KEY] = {
        softPrunedSections: [],
        hiddenCount: 0,
        totalHiddenCount: 0,
        hardEvictedCount: 0,

        placeholder: null,

        topRestoreSentinel: null,
        topRestoreObserver: null,
        topRestoreObserverRoot: null,
        isTopRestoreScheduled: false,
        isTopRestoreArmed: true,

        bottomPruneSentinel: null,
        bottomPruneObserver: null,
        bottomPruneObserverRoot: null,
        isBottomPruneScheduled: false,
        isBottomPruneArmed: true,

        observer: null,
        observedContainer: null,
        initObserver: null,

        debounceTimer: null,
        offscreenRefreshTimer: null,
        isAutoPruneScheduled: false,
        isOffscreenRefreshScheduled: false,

        replyTiming: {
            pending: false,
            startedAt: 0,
            completedAt: 0,
            lastDurationMs: 0,
            trigger: null,
        },
        replyTimingCompletePollTimer: null,
        replyTimingListenersInstalled: false,

        settings: { ...DEFAULT_SETTINGS },
        featureFlags: {
            pruning: DEFAULT_SETTINGS.enablePruning,
            offscreenOptimization: DEFAULT_SETTINGS.enableOffscreenOptimization,
            largeCodeBlockOptimization: DEFAULT_SETTINGS.enableLargeCodeBlockOptimization,
            streamingSectionHiding: DEFAULT_SETTINGS.enableStreamingSectionHiding,
        },

        debugLoggingEnabled: DEFAULT_SETTINGS.enableDebugLogging,
        didInitialPrune: false,

        codeBlockRefreshTimer: null,
        isCodeBlockRefreshScheduled: false,
        codeBlockStructureObserver: null,
        observedCodeBlockStructureRoot: null,
        observedCodeBlockStructureSection: null,
        streamingCodeBlockLastSection: null,
        streamingCodeBlockLastPre: null,
        streamingCodeBlockLastCount: 0,

        detachedCodeBlocks: new Map(),
        nextDetachedCodeBlockId: 1,

        isApplyingDomChanges: false,

        initPollTimer: null,
        
        offscreenLiveSection: null,
    };
}

export const state = window[STATE_KEY];

if (!Array.isArray(state.softPrunedSections)) {
    state.softPrunedSections = Array.isArray(state.removedSections)
        ? state.removedSections
        : [];
}

delete state.removedSections;
delete state.streamingSectionObserver;
delete state.observedStreamingSection;
delete state.streamingSectionTimer;
delete state.streamingSectionPlaceholderInterval;
delete state.streamingSectionPlaceholderStartedAt;
delete state.codeBlockTimer;
delete state.codeBlockState;

delete state.intersectionObserver;
delete state.intersectionObserverRoot;
delete state.resizeObserver;
delete state.observedSections;

delete state.codeBlockIntersectionObserver;
delete state.codeBlockIntersectionObserverRoot;
delete state.observedCodeBlocks;
delete state.codeBlockMutationObserver;
delete state.observedCodeBlockMutationSection;
delete state.codeBlockStreamingTimer;

if (typeof state.totalHiddenCount !== "number") {
    state.totalHiddenCount = Number(state.hiddenCount) || 0;
}

if (typeof state.hardEvictedCount !== "number") {
    state.hardEvictedCount = Math.max(
        0,
        (Number(state.totalHiddenCount) || 0) - state.softPrunedSections.length
    );
}

if (!("codeBlockRefreshTimer" in state)) {
    state.codeBlockRefreshTimer = null;
}

if (typeof state.isCodeBlockRefreshScheduled !== "boolean") {
    state.isCodeBlockRefreshScheduled = false;
}

if (!("codeBlockStructureObserver" in state)) {
    state.codeBlockStructureObserver = null;
}

if (!("observedCodeBlockStructureRoot" in state)) {
    state.observedCodeBlockStructureRoot = null;
}

if (!("observedCodeBlockStructureSection" in state)) {
    state.observedCodeBlockStructureSection = null;
}

if (!("streamingCodeBlockLastSection" in state)) {
    state.streamingCodeBlockLastSection = null;
}

if (!("streamingCodeBlockLastPre" in state)) {
    state.streamingCodeBlockLastPre = null;
}

if (typeof state.streamingCodeBlockLastCount !== "number") {
    state.streamingCodeBlockLastCount = 0;
}

if (!("topRestoreObserverRoot" in state)) {
    state.topRestoreObserverRoot = null;
}

if (!("bottomPruneObserverRoot" in state)) {
    state.bottomPruneObserverRoot = null;
}

if (!(state.detachedCodeBlocks instanceof Map)) {
    state.detachedCodeBlocks = new Map();
}

if (typeof state.nextDetachedCodeBlockId !== "number") {
    state.nextDetachedCodeBlockId = 1;
}

if (typeof state.debugLoggingEnabled !== "boolean") {
    state.debugLoggingEnabled = DEFAULT_SETTINGS.enableDebugLogging;
}

if (typeof state.isAutoPruneScheduled !== "boolean") {
    state.isAutoPruneScheduled = false;
}

if (typeof state.isOffscreenRefreshScheduled !== "boolean") {
    state.isOffscreenRefreshScheduled = false;
}

if (typeof state.isTopRestoreScheduled !== "boolean") {
    state.isTopRestoreScheduled = false;
}

if (typeof state.isTopRestoreArmed !== "boolean") {
    state.isTopRestoreArmed = true;
}

if (typeof state.isBottomPruneScheduled !== "boolean") {
    state.isBottomPruneScheduled = false;
}

if (typeof state.isBottomPruneArmed !== "boolean") {
    state.isBottomPruneArmed = true;
}

if (!("offscreenRefreshTimer" in state)) {
    state.offscreenRefreshTimer = null;
}

if (
    !("replyTiming" in state) ||
    typeof state.replyTiming !== "object" ||
    state.replyTiming === null
) {
    state.replyTiming = {
        pending: false,
        startedAt: 0,
        completedAt: 0,
        lastDurationMs: 0,
        trigger: null,
    };
}

if (!("replyTimingCompletePollTimer" in state)) {
    state.replyTimingCompletePollTimer = null;
}

if (typeof state.replyTimingListenersInstalled !== "boolean") {
    state.replyTimingListenersInstalled = false;
}

state.settings = {
    ...DEFAULT_SETTINGS,
    ...state.settings,
};

delete state.settings.largeCodeBlockMinChars;

if (!("initPollTimer" in state)) {
    state.initPollTimer = null;
}

if (!("offscreenLiveSection" in state)) {
    state.offscreenLiveSection = null;
}