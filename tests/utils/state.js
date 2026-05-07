export function resetCoreStateForTests(state, DEFAULT_SETTINGS) {
    state.hiddenCount = 0;
    state.totalHiddenCount = 0;
    state.hardEvictedCount = 0;
    state.softPrunedSections = [];

    state.didInitialPrune = false;
    state.debugLoggingEnabled = false;

    state.replyTiming = {
        pending: false,
        startedAt: 0,
        completedAt: 0,
        lastDurationMs: 0,
        trigger: null,
    };

    state.featureFlags = {
        pruning: DEFAULT_SETTINGS.enablePruning,
        offscreenOptimization: DEFAULT_SETTINGS.enableOffscreenOptimization,
        storeReadOptimization: DEFAULT_SETTINGS.enableStoreReadOptimization,
        codeBlockScrollbars: DEFAULT_SETTINGS.enableCodeBlockScrollbars,
        userMessageClamp: DEFAULT_SETTINGS.enableUserMessageClamp,
    };

    state.settings = {
        ...DEFAULT_SETTINGS,
    };
}