import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    runtimeListener: null,
    debugLog: vi.fn(),
}));

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        runtime: {
            onMessage: {
                addListener: vi.fn((listener) => {
                    mockRefs.runtimeListener = listener;
                }),
            },
        },
    },
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: mockRefs.debugLog,
}));

async function importFreshModules() {
    vi.resetModules();

    const stateModule = await import("../../src/content/core/state.js");
    const messagesModule = await import("../../src/content/core/messages.js");

    return {
        stateModule,
        messagesModule,
    };
}

describe("core/messages", () => {
    beforeEach(async () => {
        mockRefs.runtimeListener = null;
        mockRefs.debugLog.mockClear();

        const { stateModule } = await importFreshModules();
        const { state, DEFAULT_SETTINGS } = stateModule;

        state.hiddenCount = 0;
        state.didInitialPrune = false;
        state.debugLoggingEnabled = false;
        state.replyTiming.pending = false;
        state.replyTiming.lastDurationMs = 0;
        state.featureFlags.pruning = DEFAULT_SETTINGS.enablePruning;
        state.featureFlags.offscreenOptimization = DEFAULT_SETTINGS.enableOffscreenOptimization;
        state.featureFlags.largeCodeBlockOptimization = DEFAULT_SETTINGS.enableLargeCodeBlockOptimization;
        state.featureFlags.streamingSectionHiding = DEFAULT_SETTINGS.enableStreamingSectionHiding;

        state.settings = {
            ...DEFAULT_SETTINGS,
        };
    });

    it("handles prune-now and updates historyKeptExchanges", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;
        const { registerRuntimeMessageHandlers } = messagesModule;

        const pruneOldSections = vi.fn();
        const restoreAllSections = vi.fn();
        const scheduleAutoPrune = vi.fn();
        const waitForContainerAndInitialPrune = vi.fn();
        const refreshObservedSections = vi.fn();
        const applySoftPrunedLimitToCurrentState = vi.fn();
        const setOffscreenOptimizationEnabled = vi.fn();
        const setStreamingSectionHidingEnabled = vi.fn();
        const syncFeatureFlagsFromSettings = vi.fn();

        registerRuntimeMessageHandlers({
            pruneOldSections,
            restoreAllSections,
            scheduleAutoPrune,
            waitForContainerAndInitialPrune,
            refreshObservedSections,
            applySoftPrunedLimitToCurrentState,
            setOffscreenOptimizationEnabled,
            setStreamingSectionHidingEnabled,
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = mockRefs.runtimeListener(
            {
                action: "prune-now",
                historyKeptExchanges: 4,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(state.settings.historyKeptExchanges).toBe(4);
        expect(state.didInitialPrune).toBe(true);
        expect(pruneOldSections).toHaveBeenCalledWith(4, { showPlaceholder: true });
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("handles restore-all", async () => {
        const { messagesModule } = await importFreshModules();
        const { registerRuntimeMessageHandlers } = messagesModule;

        const pruneOldSections = vi.fn();
        const restoreAllSections = vi.fn();
        const scheduleAutoPrune = vi.fn();
        const waitForContainerAndInitialPrune = vi.fn();
        const refreshObservedSections = vi.fn();
        const applySoftPrunedLimitToCurrentState = vi.fn();
        const setOffscreenOptimizationEnabled = vi.fn();
        const setStreamingSectionHidingEnabled = vi.fn();
        const syncFeatureFlagsFromSettings = vi.fn();

        registerRuntimeMessageHandlers({
            pruneOldSections,
            restoreAllSections,
            scheduleAutoPrune,
            waitForContainerAndInitialPrune,
            refreshObservedSections,
            applySoftPrunedLimitToCurrentState,
            setOffscreenOptimizationEnabled,
            setStreamingSectionHidingEnabled,
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = mockRefs.runtimeListener(
            { action: "restore-all" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(restoreAllSections).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("handles settings-updated and refreshes the active feature paths", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;
        const { registerRuntimeMessageHandlers } = messagesModule;

        state.didInitialPrune = true;
        state.featureFlags.offscreenOptimization = false;
        state.featureFlags.streamingSectionHiding = false;

        const pruneOldSections = vi.fn();
        const restoreAllSections = vi.fn();
        const scheduleAutoPrune = vi.fn();
        const waitForContainerAndInitialPrune = vi.fn();
        const refreshObservedSections = vi.fn();
        const applySoftPrunedLimitToCurrentState = vi.fn();
        const setOffscreenOptimizationEnabled = vi.fn();
        const setStreamingSectionHidingEnabled = vi.fn();
        const syncFeatureFlagsFromSettings = vi.fn(() => {
            state.featureFlags.pruning = Boolean(state.settings.enablePruning);
            state.featureFlags.offscreenOptimization = Boolean(state.settings.enableOffscreenOptimization);
            state.featureFlags.largeCodeBlockOptimization = Boolean(state.settings.enableLargeCodeBlockOptimization);
            state.featureFlags.streamingSectionHiding = Boolean(state.settings.enableStreamingSectionHiding);
        });

        registerRuntimeMessageHandlers({
            pruneOldSections,
            restoreAllSections,
            scheduleAutoPrune,
            waitForContainerAndInitialPrune,
            refreshObservedSections,
            applySoftPrunedLimitToCurrentState,
            setOffscreenOptimizationEnabled,
            setStreamingSectionHidingEnabled,
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = mockRefs.runtimeListener(
            {
                action: "settings-updated",
                historyKeptExchanges: 6,
                autoPrune: true,
                enablePruning: true,
                enableOffscreenOptimization: true,
                enableLargeCodeBlockOptimization: true,
                enableStreamingSectionHiding: true,
                enableDebugLogging: true,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);

        expect(state.settings.historyKeptExchanges).toBe(6);
        expect(state.settings.autoPrune).toBe(true);
        expect(state.settings.enablePruning).toBe(true);
        expect(state.settings.enableOffscreenOptimization).toBe(true);
        expect(state.settings.enableLargeCodeBlockOptimization).toBe(true);
        expect(state.settings.enableStreamingSectionHiding).toBe(true);
        expect(state.settings.enableDebugLogging).toBe(true);
        expect(state.debugLoggingEnabled).toBe(true);

        expect(syncFeatureFlagsFromSettings).toHaveBeenCalledTimes(1);
        expect(applySoftPrunedLimitToCurrentState).toHaveBeenCalledTimes(1);
        expect(setOffscreenOptimizationEnabled).toHaveBeenCalledWith(true);
        expect(setStreamingSectionHidingEnabled).toHaveBeenCalledWith(true);
        expect(scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(refreshObservedSections).not.toHaveBeenCalled();
        expect(waitForContainerAndInitialPrune).not.toHaveBeenCalled();

        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("returns current popup state", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;
        const { registerRuntimeMessageHandlers } = messagesModule;

        state.hiddenCount = 7;
        state.replyTiming.pending = true;
        state.replyTiming.lastDurationMs = 987;
        state.debugLoggingEnabled = true;

        registerRuntimeMessageHandlers({
            pruneOldSections: vi.fn(),
            restoreAllSections: vi.fn(),
            scheduleAutoPrune: vi.fn(),
            waitForContainerAndInitialPrune: vi.fn(),
            refreshObservedSections: vi.fn(),
            applySoftPrunedLimitToCurrentState: vi.fn(),
            setOffscreenOptimizationEnabled: vi.fn(),
            setStreamingSectionHidingEnabled: vi.fn(),
            syncFeatureFlagsFromSettings: vi.fn(),
        });

        const sendResponse = vi.fn();

        const returned = mockRefs.runtimeListener(
            { action: "get-popup-state" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            ok: true,
            hiddenExchanges: 3,
            hiddenSections: 7,
            lastReplyDurationMs: 987,
            replyPending: true,
            debugLoggingEnabled: true,
        });
    });

    it("returns an unknown-action error for unsupported actions", async () => {
        const { messagesModule } = await importFreshModules();
        const { registerRuntimeMessageHandlers } = messagesModule;

        registerRuntimeMessageHandlers({
            pruneOldSections: vi.fn(),
            restoreAllSections: vi.fn(),
            scheduleAutoPrune: vi.fn(),
            waitForContainerAndInitialPrune: vi.fn(),
            refreshObservedSections: vi.fn(),
            applySoftPrunedLimitToCurrentState: vi.fn(),
            setOffscreenOptimizationEnabled: vi.fn(),
            setStreamingSectionHidingEnabled: vi.fn(),
            syncFeatureFlagsFromSettings: vi.fn(),
        });

        const sendResponse = vi.fn();

        const returned = mockRefs.runtimeListener(
            { action: "not-a-real-action" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            ok: false,
            error: "Unknown action",
        });
    });

    it("catches thrown errors and returns them in the response", async () => {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
            const { messagesModule } = await importFreshModules();
            const { registerRuntimeMessageHandlers } = messagesModule;

            registerRuntimeMessageHandlers({
                pruneOldSections: vi.fn(() => {
                    throw new Error("boom");
                }),
                restoreAllSections: vi.fn(),
                scheduleAutoPrune: vi.fn(),
                waitForContainerAndInitialPrune: vi.fn(),
                refreshObservedSections: vi.fn(),
                applySoftPrunedLimitToCurrentState: vi.fn(),
                setOffscreenOptimizationEnabled: vi.fn(),
                setStreamingSectionHidingEnabled: vi.fn(),
                syncFeatureFlagsFromSettings: vi.fn(),
            });

            const sendResponse = vi.fn();

            const returned = mockRefs.runtimeListener(
                {
                    action: "prune-now",
                    historyKeptExchanges: 3,
                },
                {},
                sendResponse
            );

            expect(returned).toBe(true);
            expect(sendResponse).toHaveBeenCalledWith({
                ok: false,
                error: "Error: boom",
            });
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
        }
    });
});