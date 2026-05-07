import { vi } from "vitest";

export function createRuntimeMessageHandlers(overrides = {}) {
    return {
        pruneOldSections: vi.fn(),
        restoreAllSections: vi.fn(),
        scheduleAutoPrune: vi.fn(),
        waitForContainerAndInitialPrune: vi.fn(),
        refreshObservedSections: vi.fn(),
        applySoftPrunedLimitToCurrentState: vi.fn(),
        setOffscreenOptimizationEnabled: vi.fn(),
        syncFeatureFlagsFromSettings: vi.fn(),
        ...overrides,
    };
}

export function createFeatureFlagSyncMock(state) {
    return vi.fn(() => {
        state.featureFlags.pruning = Boolean(state.settings.enablePruning);
        state.featureFlags.offscreenOptimization = Boolean(
            state.settings.enableOffscreenOptimization
        );
        state.featureFlags.largeCodeBlockOptimization = Boolean(
            state.settings.enableLargeCodeBlockOptimization
        );
        state.featureFlags.storeReadOptimization = Boolean(
            state.settings.enableStoreReadOptimization
        );
        state.featureFlags.codeBlockScrollbars = Boolean(
            state.settings.enableCodeBlockScrollbars
        );
        state.featureFlags.userMessageClamp = Boolean(
            state.settings.enableUserMessageClamp
        );
        state.featureFlags.codeBlockCollapse = Boolean(
            state.settings.enableCodeBlockCollapse
        );
    });
}