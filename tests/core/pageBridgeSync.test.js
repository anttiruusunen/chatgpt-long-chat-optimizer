import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetCoreStateForTests } from "../utils/state.js";

const mockRefs = vi.hoisted(() => ({
    postThreadOptimizerBridgeMessage: vi.fn(),
}));

vi.mock("../../src/content/bridge/chatStoreBridgeClient.js", () => ({
    postThreadOptimizerBridgeMessage: mockRefs.postThreadOptimizerBridgeMessage,
}));

async function importFreshModules() {
    vi.resetModules();

    const stateModule = await import("../../src/content/core/state.js");
    const pageBridgeSyncModule = await import(
        "../../src/content/core/pageBridgeSync.js"
    );

    return {
        stateModule,
        pageBridgeSyncModule,
    };
}

function installPageBridge() {
    window.__threadOptimizerChatStoreBridge = {
        __installed: true,
    };
}

describe("pageBridgeSync", () => {
    beforeEach(async () => {
        vi.useFakeTimers();

        delete window.__threadOptimizerChatStoreBridge;
        mockRefs.postThreadOptimizerBridgeMessage.mockClear();

        const { stateModule } = await importFreshModules();
        const { state, DEFAULT_SETTINGS } = stateModule;

        resetCoreStateForTests(state, DEFAULT_SETTINGS);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();

        delete window.__threadOptimizerChatStoreBridge;
        mockRefs.postThreadOptimizerBridgeMessage.mockClear();
    });

    it("sends pruning disabled state to the page bridge", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncPruningStateToPageBridge } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.pruning = false;
        state.settings.historyKeptExchanges = 7;

        syncPruningStateToPageBridge();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-pruning-state",
            enabled: false,
            historyKeptExchanges: 7,
        });
    });

    it("sends pruning enabled state and normalizes historyKeptExchanges", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncPruningStateToPageBridge } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 0;

        syncPruningStateToPageBridge();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-pruning-state",
            enabled: true,
            historyKeptExchanges: 1,
        });
    });

    it("sends store-read optimization disabled state to the page bridge", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.storeReadOptimization = false;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = true;

        syncStoreReadOptimizationToPageWithRetry();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: false,
            debug: true,
        });
    });

    it("sends store-read optimization enabled state to the page bridge", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.storeReadOptimization = true;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = false;

        syncStoreReadOptimizationToPageWithRetry();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: true,
            debug: false,
        });
    });

    it("posts store-read optimization immediately and retries until the bridge is installed", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        state.featureFlags.storeReadOptimization = false;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = false;

        syncStoreReadOptimizationToPageWithRetry(2);

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledTimes(1);
        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenLastCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: false,
            debug: false,
        });

        installPageBridge();

        await vi.advanceTimersByTimeAsync(200);

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledTimes(2);
        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenLastCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: false,
            debug: false,
        });
    });

    it("posts store-read optimization once when the bridge is missing and retries are exhausted", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        state.featureFlags.storeReadOptimization = true;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = false;

        syncStoreReadOptimizationToPageWithRetry(2);

        await vi.advanceTimersByTimeAsync(1000);

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledTimes(1);
        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenLastCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: true,
            debug: false,
        });
    });

    it("gates store-read optimization off until initial prune is ready for the page", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.storeReadOptimization = true;
        state.storeReadOptimizationReadyForPage = false;
        state.debugLoggingEnabled = false;

        syncStoreReadOptimizationToPageWithRetry();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: false,
            debug: false,
        });
    });

    it("sends store-read optimization enabled after initial prune is ready for the page", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.storeReadOptimization = true;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = false;

        syncStoreReadOptimizationToPageWithRetry();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: true,
            debug: false,
        });
    });

    it("keeps store-read optimization disabled when the user setting is disabled even after initial prune is ready", async () => {
        const { stateModule, pageBridgeSyncModule } = await importFreshModules();
        const { state } = stateModule;
        const { syncStoreReadOptimizationToPageWithRetry } = pageBridgeSyncModule;

        installPageBridge();

        state.featureFlags.storeReadOptimization = false;
        state.storeReadOptimizationReadyForPage = true;
        state.debugLoggingEnabled = true;

        syncStoreReadOptimizationToPageWithRetry();

        expect(mockRefs.postThreadOptimizerBridgeMessage).toHaveBeenCalledWith({
            type: "thread-optimizer:set-store-read-optimization",
            enabled: false,
            debug: true,
        });
    });
});