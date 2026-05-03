export const STATE_KEY = "__threadOptimizerState";

export const PRUNED_ATTR = "data-thread-optimizer-pruned";
export const PLACEHOLDER_ATTR = "data-thread-optimizer-placeholder";
export const OFFSCREEN_OPT_ATTR = "data-thread-optimizer-offscreen-opt";
export const CODE_BLOCK_OFFSCREEN_OPT_ATTR =
    "data-thread-optimizer-code-offscreen-opt";
export const CODE_BLOCK_COLLAPSED_ATTR =
    "data-thread-optimizer-code-collapsed";
export const CODE_BLOCK_PLACEHOLDER_ATTR =
    "data-thread-optimizer-code-placeholder";
export const TOP_RESTORE_SENTINEL_ATTR =
    "data-thread-optimizer-top-restore-sentinel";
export const BOTTOM_PRUNE_SENTINEL_ATTR =
    "data-thread-optimizer-bottom-prune-sentinel";
export const UNPRUNEABLE_ATTR = "data-thread-optimizer-unpruneable";
export const OUT_OF_WINDOW_ATTR = "data-thread-optimizer-out-of-window";

export const DEFAULT_SETTINGS = {
    historyKeptExchanges: 10,
    autoPrune: true,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableLargeCodeBlockOptimization: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableUserMessageClamp: true,
    enableCodeBlockCollapse: true,
};

function createDefaultFeatureFlags() {
    return {
        pruning: DEFAULT_SETTINGS.enablePruning,
        offscreenOptimization: DEFAULT_SETTINGS.enableOffscreenOptimization,
        largeCodeBlockOptimization:
            DEFAULT_SETTINGS.enableLargeCodeBlockOptimization,
        storeReadOptimization: DEFAULT_SETTINGS.enableStoreReadOptimization,
        codeBlockScrollbars: DEFAULT_SETTINGS.enableCodeBlockScrollbars,
        userMessageClamp: DEFAULT_SETTINGS.enableUserMessageClamp,
        codeBlockCollapse: DEFAULT_SETTINGS.enableCodeBlockCollapse,
    };
}

function createDefaultReplyTimingState() {
    return {
        pending: false,
        startedAt: 0,
        completedAt: 0,
        lastDurationMs: 0,
        trigger: null,
    };
}

/**
 * State is stored on window so hot reloads / repeated script injection do not
 * lose bookkeeping while the page is still alive.
 */
function createDefaultState() {
    return {
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
        initPollTimer: null,

        debounceTimer: null,
        offscreenRefreshTimer: null,
        isAutoPruneScheduled: false,
        isOffscreenRefreshScheduled: false,

        replyTiming: createDefaultReplyTimingState(),
        replyTimingCompletePollTimer: null,
        replyTimingListenersInstalled: false,

        settings: { ...DEFAULT_SETTINGS },
        featureFlags: createDefaultFeatureFlags(),

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
        offscreenLiveSection: null,
    };
}

if (!window[STATE_KEY]) {
    window[STATE_KEY] = createDefaultState();
}

export const state = window[STATE_KEY];

function ensureProperty(name, fallbackValue) {
    if (!(name in state)) {
        state[name] = fallbackValue;
    }
}

function ensureBooleanProperty(name, fallbackValue = false) {
    if (typeof state[name] !== "boolean") {
        state[name] = fallbackValue;
    }
}

function ensureNumberProperty(name, fallbackValue = 0) {
    if (typeof state[name] !== "number") {
        state[name] = fallbackValue;
    }
}

/**
 * State migration hook.
 *
 * Runs on every content script load to normalize or migrate
 * persisted window-level state across extension versions.
 *
 * Currently a no-op (RC1).
 */
function migrateLegacyState() {
    // Intentionally a no-op for RC1.
    // 
    // This hook exists for forward compatibility:
    // once the extension is released, we may need to migrate
    // existing in-page state when users upgrade versions
    // without reloading ChatGPT tabs.
}

function normalizePruningState() {
    ensureNumberProperty("totalHiddenCount", Number(state.hiddenCount) || 0);

    if (typeof state.hardEvictedCount !== "number") {
        state.hardEvictedCount = Math.max(
            0,
            (Number(state.totalHiddenCount) || 0) -
                state.softPrunedSections.length
        );
    }

    ensureBooleanProperty("isAutoPruneScheduled");
    ensureBooleanProperty("isTopRestoreScheduled");
    ensureBooleanProperty("isBottomPruneScheduled");
    ensureBooleanProperty("isTopRestoreArmed", true);
    ensureBooleanProperty("isBottomPruneArmed", true);

    ensureProperty("topRestoreObserverRoot", null);
    ensureProperty("bottomPruneObserverRoot", null);
    ensureProperty("offscreenRefreshTimer", null);
    ensureProperty("initPollTimer", null);
}

function normalizeReplyTimingState() {
    if (
        !("replyTiming" in state) ||
        typeof state.replyTiming !== "object" ||
        state.replyTiming === null
    ) {
        state.replyTiming = createDefaultReplyTimingState();
    }

    ensureProperty("replyTimingCompletePollTimer", null);
    ensureBooleanProperty("replyTimingListenersInstalled");
}

function normalizeCodeBlockState() {
    ensureProperty("codeBlockRefreshTimer", null);
    ensureBooleanProperty("isCodeBlockRefreshScheduled");

    ensureProperty("codeBlockStructureObserver", null);
    ensureProperty("observedCodeBlockStructureRoot", null);
    ensureProperty("observedCodeBlockStructureSection", null);
    ensureProperty("streamingCodeBlockLastSection", null);
    ensureProperty("streamingCodeBlockLastPre", null);

    ensureNumberProperty("streamingCodeBlockLastCount", 0);

    if (!(state.detachedCodeBlocks instanceof Map)) {
        state.detachedCodeBlocks = new Map();
    }

    ensureNumberProperty("nextDetachedCodeBlockId", 1);
}

function normalizeSettingsAndFlags() {
    state.settings = {
        ...DEFAULT_SETTINGS,
        ...state.settings,
    };

    if (
        !("featureFlags" in state) ||
        typeof state.featureFlags !== "object" ||
        state.featureFlags === null
    ) {
        state.featureFlags = createDefaultFeatureFlags();
    }

    ensureBooleanProperty("debugLoggingEnabled", DEFAULT_SETTINGS.enableDebugLogging);
}

function normalizeMiscState() {
    ensureBooleanProperty("isOffscreenRefreshScheduled");
    ensureBooleanProperty("isApplyingDomChanges");
    ensureProperty("offscreenLiveSection", null);
}

migrateLegacyState();
normalizePruningState();
normalizeReplyTimingState();
normalizeCodeBlockState();
normalizeSettingsAndFlags();
normalizeMiscState();