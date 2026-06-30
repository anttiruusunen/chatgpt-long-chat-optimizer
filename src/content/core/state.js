import { DEFAULT_SETTINGS } from "../../shared/settingsDefaults.js";

export const STATE_KEY = "__threadOptimizerState";

export const OFFSCREEN_OPT_ATTR = "data-thread-optimizer-offscreen-opt";

export { DEFAULT_SETTINGS };

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
        storeReadOptimizationReadyForPage: false,
        currentPagePrunedTurnCount: 0,
        currentPageHistoryWasReduced: false,

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

function removeLegacySoftPruningState() {
    delete state.softPrunedSections;
    delete state.hiddenCount;
    delete state.totalHiddenCount;
    delete state.hardEvictedCount;

    delete state.placeholder;

    delete state.topRestoreSentinel;
    delete state.topRestoreObserver;
    delete state.topRestoreObserverRoot;
    delete state.isTopRestoreScheduled;
    delete state.isTopRestoreArmed;

    delete state.bottomPruneSentinel;
    delete state.bottomPruneObserver;
    delete state.bottomPruneObserverRoot;
    delete state.isBottomPruneScheduled;
    delete state.isBottomPruneArmed;

    delete state.deferredReactPruneSections;

    delete state.scrollIntentContainer;
    delete state.scrollIntentEventTarget;
    delete state.scrollIntentLastTop;
    delete state.topEdgeKeyAccum;
    delete state.bottomEdgeKeyAccum;
}

function migrateLegacyState() {
    removeLegacyCodeBlockOptimizationState();
    removeLegacySoftPruningState();
}

function normalizeRuntimeState() {
    ensureProperty("observer", null);
    ensureProperty("observedContainer", null);
    ensureProperty("initObserver", null);
    ensureProperty("initPollTimer", null);

    ensureProperty("debounceTimer", null);
    ensureProperty("offscreenRefreshTimer", null);

    ensureBooleanProperty("isAutoPruneScheduled");
    ensureBooleanProperty("isOffscreenRefreshScheduled");
    ensureBooleanProperty("isApplyingDomChanges");
    ensureBooleanProperty("storeReadOptimizationReadyForPage");

    ensureProperty("currentPagePrunedTurnCount", 0);
    ensureBooleanProperty("currentPageHistoryWasReduced");
    ensureProperty("offscreenLiveSection", null);
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
    const existingSettings =
        state.settings && typeof state.settings === "object"
            ? state.settings
            : {};

    state.settings = {
        ...DEFAULT_SETTINGS,
        ...existingSettings,
    };

    const existingFeatureFlags =
        state.featureFlags && typeof state.featureFlags === "object"
            ? state.featureFlags
            : {};

    state.featureFlags = {
        ...createDefaultFeatureFlags(),
        ...existingFeatureFlags,
    };

    ensureBooleanProperty(
        "debugLoggingEnabled",
        DEFAULT_SETTINGS.enableDebugLogging
    );
}

migrateLegacyState();
normalizeRuntimeState();
normalizeReplyTimingState();
normalizeSettingsAndFlags();