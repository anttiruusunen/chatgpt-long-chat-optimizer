import { describe, it, expect, beforeEach, vi } from "vitest";
import { silenceConsole } from "../utils/console.js";
import {
    createRuntimeMessageHandlers,
    createFeatureFlagSyncMock,
} from "../utils/runtimeMessages.js";
import { resetCoreStateForTests } from "../utils/state.js";

const mockRefs = vi.hoisted(() => ({
    runtimeListener: null,
    debugLog: vi.fn(),
    postThreadOptimizerBridgeMessage: vi.fn(),
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

vi.mock("../../src/content/ui/qolStyles.js", () => ({
    syncCodeBlockScrollbarStyles: vi.fn(),
    syncUserMessageClampStyles: vi.fn(),
}));

vi.mock("../../src/content/bridge/chatStoreBridgeClient.js", () => ({
    postThreadOptimizerBridgeMessage: mockRefs.postThreadOptimizerBridgeMessage,
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

function setupRuntimeHandlers(messagesModule, overrides = {}) {
    const handlers = createRuntimeMessageHandlers(overrides);

    messagesModule.registerRuntimeMessageHandlers(handlers);

    return {
        handlers,
        listener: mockRefs.runtimeListener,
    };
}

describe("core/messages", () => {
    beforeEach(async () => {
        mockRefs.runtimeListener = null;
        mockRefs.debugLog.mockClear();
        mockRefs.postThreadOptimizerBridgeMessage.mockClear();

        const { stateModule } = await importFreshModules();
        const { state, DEFAULT_SETTINGS } = stateModule;

        resetCoreStateForTests(state, DEFAULT_SETTINGS);
    });

    it("handles prune-now and updates historyKeptExchanges", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;

        const { handlers, listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
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
        expect(handlers.pruneOldSections).toHaveBeenCalledWith(4);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("handles settings-updated and refreshes the active feature paths", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;

        state.didInitialPrune = true;
        state.featureFlags.offscreenOptimization = false;

        const syncFeatureFlagsFromSettings = createFeatureFlagSyncMock(state);

        const { handlers, listener } = setupRuntimeHandlers(messagesModule, {
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = listener(
            {
                action: "settings-updated",
                historyKeptExchanges: 6,
                autoPrune: true,
                enablePruning: true,
                enableOffscreenOptimization: true,
                enableDebugLogging: true,
                enableStoreReadOptimization: true,
                enableCodeBlockScrollbars: true,
                enableUserMessageClamp: true,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);

        expect(state.settings.historyKeptExchanges).toBe(6);
        expect(state.settings.autoPrune).toBe(true);
        expect(state.settings.enablePruning).toBe(true);
        expect(state.settings.enableOffscreenOptimization).toBe(true);
        expect(state.settings.enableDebugLogging).toBe(true);
        expect(state.settings.enableStoreReadOptimization).toBe(true);
        expect(state.settings.enableCodeBlockScrollbars).toBe(true);
        expect(state.settings.enableUserMessageClamp).toBe(true);
        expect(state.debugLoggingEnabled).toBe(true);

        expect(handlers.syncFeatureFlagsFromSettings).toHaveBeenCalledTimes(1);
        expect(handlers.setOffscreenOptimizationEnabled).toHaveBeenCalledWith(true);
        expect(handlers.scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(handlers.refreshObservedSections).not.toHaveBeenCalled();
        expect(handlers.waitForContainerAndInitialPrune).not.toHaveBeenCalled();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: state.featureFlags.storeReadOptimization,
            debug: true,
        });

        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("settings-updated prunes immediately when pruning was just enabled", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;

        state.didInitialPrune = false;
        state.featureFlags.pruning = false;
        state.settings.enablePruning = false;

        const syncFeatureFlagsFromSettings = createFeatureFlagSyncMock(state);

        const { handlers, listener } = setupRuntimeHandlers(messagesModule, {
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = listener(
            {
                action: "settings-updated",
                historyKeptExchanges: 3,
                autoPrune: true,
                enablePruning: true,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(state.featureFlags.pruning).toBe(true);
        expect(state.didInitialPrune).toBe(true);
        expect(handlers.pruneOldSections).toHaveBeenCalledWith(3);
        expect(handlers.refreshObservedSections).toHaveBeenCalledTimes(2);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("settings-updated refreshes observed sections when auto-prune is disabled", async () => {
        const { messagesModule } = await importFreshModules();

        const { handlers, listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
            {
                action: "settings-updated",
                autoPrune: false,
                enablePruning: true,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(handlers.scheduleAutoPrune).not.toHaveBeenCalled();
        expect(handlers.pruneOldSections).not.toHaveBeenCalled();
        expect(handlers.refreshObservedSections).toHaveBeenCalledTimes(2);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("handles debug-log-state", async () => {
        const { messagesModule } = await importFreshModules();

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        globalThis.__THREAD_OPTIMIZER_DEBUG__ = {
            getState: vi.fn(() => ({ ok: true })),
        };

        const returned = listener(
            { action: "debug-log-state" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(logSpy).toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });

        delete globalThis.__THREAD_OPTIMIZER_DEBUG__;
        logSpy.mockRestore();
    });

    it("handles debug-log-buckets", async () => {
        const { messagesModule } = await importFreshModules();

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        globalThis.__THREAD_OPTIMIZER_DEBUG__ = {
            getBuckets: vi.fn(() => ({ buckets: [] })),
        };

        const returned = listener(
            { action: "debug-log-buckets" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(logSpy).toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });

        delete globalThis.__THREAD_OPTIMIZER_DEBUG__;
        logSpy.mockRestore();
    });

    it("handles debug-log-logical", async () => {
        const { messagesModule } = await importFreshModules();

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        globalThis.__THREAD_OPTIMIZER_DEBUG__ = {
            getLogicalSections: vi.fn(() => []),
        };

        const returned = listener(
            { action: "debug-log-logical" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(logSpy).toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });

        delete globalThis.__THREAD_OPTIMIZER_DEBUG__;
        logSpy.mockRestore();
    });

    it("requests a store-performance debug log through the page bridge", async () => {
        const { messagesModule } = await importFreshModules();

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
            { action: "log-debug-store-performance" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:log-store-performance",
        });
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("returns an unknown-action error for unsupported actions", async () => {
        const { messagesModule } = await importFreshModules();

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
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
        const restoreConsole = silenceConsole(["error"]);
        const errorSpy = console.error;

        try {
            const { messagesModule } = await importFreshModules();

            const { listener } = setupRuntimeHandlers(messagesModule, {
                pruneOldSections: vi.fn(() => {
                    throw new Error("boom");
                }),
            });

            const sendResponse = vi.fn();

            const returned = listener(
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
            restoreConsole();
        }
    });

    it("settings-updated preserves existing settings when optional keys are omitted", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state, DEFAULT_SETTINGS } = stateModule;

        state.settings = {
            ...DEFAULT_SETTINGS,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
            autoPrune: true,
            historyKeptExchanges: 10,
        };

        state.featureFlags = {
            pruning: true,
            offscreenOptimization: true,
            storeReadOptimization: true,
            codeBlockScrollbars: true,
            userMessageClamp: true,
        };

        const { listener } = setupRuntimeHandlers(messagesModule, {
            syncFeatureFlagsFromSettings: createFeatureFlagSyncMock(state),
        });

        const sendResponse = vi.fn();

        listener(
            {
                action: "settings-updated",
                historyKeptExchanges: 5,
                autoPrune: true,
                enablePruning: true,
            },
            {},
            sendResponse
        );

        expect(state.settings.historyKeptExchanges).toBe(5);
        expect(state.settings.autoPrune).toBe(true);
        expect(state.settings.enablePruning).toBe(true);
        expect(state.settings.enableOffscreenOptimization).toBe(true);
        expect(state.settings.enableDebugLogging).toBe(true);
        expect(state.settings.enableStoreReadOptimization).toBe(true);
        expect(state.settings.enableCodeBlockScrollbars).toBe(true);
        expect(state.settings.enableUserMessageClamp).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("settings-updated re-enables pruning feature flag", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;

        state.settings.enablePruning = false;
        state.featureFlags.pruning = false;

        const syncFeatureFlagsFromSettings = createFeatureFlagSyncMock(state);

        const { listener } = setupRuntimeHandlers(messagesModule, {
            syncFeatureFlagsFromSettings,
        });

        const sendResponse = vi.fn();

        const returned = listener(
            {
                action: "settings-updated",
                enablePruning: true,
                autoPrune: false,
            },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        expect(state.settings.enablePruning).toBe(true);
        expect(state.featureFlags.pruning).toBe(true);
    });
});