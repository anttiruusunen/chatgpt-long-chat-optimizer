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
        expect(handlers.pruneOldSections).toHaveBeenCalledWith(4, {
            showPlaceholder: true,
        });
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("handles restore-all", async () => {
        const { messagesModule } = await importFreshModules();

        const { handlers, listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
            { action: "restore-all" },
            {},
            sendResponse
        );

        expect(returned).toBe(true);
        expect(handlers.restoreAllSections).toHaveBeenCalledTimes(1);
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
                enableLargeCodeBlockOptimization: true,
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
        expect(state.settings.enableDebugLogging).toBe(true);
        expect(state.debugLoggingEnabled).toBe(true);

        expect(handlers.syncFeatureFlagsFromSettings).toHaveBeenCalledTimes(1);
        expect(handlers.applySoftPrunedLimitToCurrentState).toHaveBeenCalledTimes(1);
        expect(handlers.setOffscreenOptimizationEnabled).toHaveBeenCalledWith(true);
        expect(handlers.scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(handlers.refreshObservedSections).not.toHaveBeenCalled();
        expect(handlers.waitForContainerAndInitialPrune).not.toHaveBeenCalled();

        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("returns current popup state", async () => {
        const { stateModule, messagesModule } = await importFreshModules();
        const { state } = stateModule;

        state.hiddenCount = 7;
        state.replyTiming.pending = true;
        state.replyTiming.lastDurationMs = 987;
        state.debugLoggingEnabled = true;

        const { listener } = setupRuntimeHandlers(messagesModule);
        const sendResponse = vi.fn();

        const returned = listener(
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
            enableLargeCodeBlockOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
            enableCodeBlockCollapse: true,
            autoPrune: true,
            historyKeptExchanges: 10,
        };

        state.featureFlags = {
            pruning: true,
            offscreenOptimization: true,
            largeCodeBlockOptimization: true,
            storeReadOptimization: true,
            codeBlockScrollbars: true,
            userMessageClamp: true,
            codeBlockCollapse: true,
        };

        const { listener } = setupRuntimeHandlers(messagesModule, {
            syncFeatureFlagsFromSettings: createFeatureFlagSyncMock(state),
        });

        expect(listener).toBeDefined();

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
        expect(state.settings.enableLargeCodeBlockOptimization).toBe(true);
        expect(state.settings.enableDebugLogging).toBe(true);
        expect(state.settings.enableStoreReadOptimization).toBe(true);
        expect(state.settings.enableCodeBlockScrollbars).toBe(true);
        expect(state.settings.enableUserMessageClamp).toBe(true);
        expect(state.settings.enableCodeBlockCollapse).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });
});