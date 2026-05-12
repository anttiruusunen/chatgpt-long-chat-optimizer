import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    pruneOldSectionsBase: vi.fn(),
    runInitialPruneBase: vi.fn(),
    clearCssVisibilityWindow: vi.fn(),
    scheduleConversationChromeSync: vi.fn(),
    scheduleRefreshPostPruneState: vi.fn(),
    syncPruningStateToPageBridge: vi.fn(),
    getConversationContainer: vi.fn(),
    waitForContainerAndInitialPrune: vi.fn(),
    ensureObserverAttached: vi.fn(),
    withDomMutationGuard: vi.fn((fn) => fn()),
}));

vi.mock("../../src/content/pruning/prune.js", () => ({
    pruneOldSections: mockRefs.pruneOldSectionsBase,
    runInitialPrune: mockRefs.runInitialPruneBase,
}));

vi.mock("../../src/content/pruning/cssVisibilityWindow.js", () => ({
    clearCssVisibilityWindow: mockRefs.clearCssVisibilityWindow,
}));

vi.mock("../../src/content/core/conversationMaintenance.js", () => ({
    scheduleConversationChromeSync: mockRefs.scheduleConversationChromeSync,
    scheduleRefreshPostPruneState: mockRefs.scheduleRefreshPostPruneState,
}));

vi.mock("../../src/content/core/pageBridgeSync.js", () => ({
    syncPruningStateToPageBridge: mockRefs.syncPruningStateToPageBridge,
}));

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationContainer: mockRefs.getConversationContainer,
}));

async function loadController() {
    const stateModule = await import("../../src/content/core/state.js");
    const controllerModule = await import("../../src/content/pruning/pruneController.js");

    return {
        state: stateModule.state,
        createPruneController: controllerModule.createPruneController,
    };
}

describe("pruneController", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        for (const value of Object.values(mockRefs)) {
            if (typeof value?.mockReset === "function") {
                value.mockReset();
            }
        }

        mockRefs.ensureObserverAttached.mockReturnValue(true);
        mockRefs.withDomMutationGuard.mockImplementation((fn) => fn());
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("retries auto-prune after latest-assistant deferral clears", async () => {
        const { state, createPruneController } = await loadController();

        state.settings.autoPrune = true;
        state.settings.historyKeptExchanges = 1;
        state.featureFlags.pruning = true;
        state.didInitialPrune = true;
        state.isApplyingDomChanges = false;
        state.isAutoPruneScheduled = false;
        state.debounceTimer = null;

        mockRefs.pruneOldSectionsBase
            .mockReturnValueOnce({
                visibleSectionsChanged: false,
                placeholderChanged: false,
                posted: false,
                pruneDeferred: true,
                reason: "latest-assistant-incomplete",
            })
            .mockReturnValueOnce({
                visibleSectionsChanged: true,
                placeholderChanged: false,
                posted: true,
                deferred: false,
                reason: null,
            });

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.scheduleAutoPrune("reply-settled-idle");

        await vi.advanceTimersByTimeAsync(300);

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(1);
        expect(mockRefs.pruneOldSectionsBase.mock.results[0].value).toMatchObject({
            pruneDeferred: true,
            reason: "latest-assistant-incomplete",
        });

        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(300);

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(2);
        expect(mockRefs.pruneOldSectionsBase.mock.calls[1][0]).toBe(1);

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: "auto-prune-finally",
            })
        );

        expect(state.isAutoPruneScheduled).toBe(false);
        expect(state.debounceTimer).toBe(null);
    });

    it("forwards initial prune through the base initial prune runner", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container);

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledWith(
            container,
            expect.objectContaining({
                pruneOldSections: expect.any(Function),
                refreshObservedSections: expect.any(Function),
            })
        );
    });

    it("uses a delayed refresh reason for navigation initial prune", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container, {
            postPruneRefreshDelayMs: 500,
        });

        const baseArgs = mockRefs.runInitialPruneBase.mock.calls[0];
        const deps = baseArgs[1];

        deps.refreshObservedSections();

        expect(mockRefs.scheduleRefreshPostPruneState).toHaveBeenCalledWith({
            delayMs: 500,
            reason: "navigation-initial-prune-refresh",
        });
    });
});