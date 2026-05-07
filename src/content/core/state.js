export const STATE_KEY = "__threadOptimizerState";

export const PRUNED_ATTR = "data-thread-optimizer-pruned";
export const PLACEHOLDER_ATTR = "data-thread-optimizer-placeholder";
export const OFFSCREEN_OPT_ATTR = "data-thread-optimizer-offscreen-opt";
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
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableUserMessageClamp: true,
};

function createDefaultFeatureFlags() {
    return {
        pruning: DEFAULT_SETTINGS.enablePruning,
        offscreenOptimization: DEFAULT_SETTINGS.enableOffscreenOptimization,
        storeReadOptimization: DEFAULT_SETTINGS.enableStoreReadOptimization,
        codeBlockScrollbars: DEFAULT_SETTINGS.enableCodeBlockScrollbars,
        userMessageClamp: DEFAULT_SETTINGS.enableUserMessageClamp,
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

function removeLegacyCodeBlockOptimizationState() {
    delete state.codeBlockRefreshTimer;
    delete state.isCodeBlockRefreshScheduled;
    delete state.codeBlockStructureObserver;
    delete state.observedCodeBlockStructureRoot;
    delete state.observedCodeBlockStructureSection;
    delete state.streamingCodeBlockLastSection;
    delete state.streamingCodeBlockLastPre;
    delete state.streamingCodeBlockLastCount;
    delete state.nextDetachedCodeBlockId;
}

function migrateLegacyState() {
    removeLegacyCodeBlockOptimizationState();
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

function normalizeSettingsAndFlags() {
    const {
        ...existingSettings
    } = state.settings && typeof state.settings === "object"
        ? state.settings
        : {};

    state.settings = {
        ...DEFAULT_SETTINGS,
        ...existingSettings,
    };

    const {
        ...existingFeatureFlags
    } = state.featureFlags && typeof state.featureFlags === "object"
        ? state.featureFlags
        : {};

    state.featureFlags = {
        ...createDefaultFeatureFlags(),
        ...existingFeatureFlags,
    };

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
normalizeSettingsAndFlags();
normalizeMiscState();