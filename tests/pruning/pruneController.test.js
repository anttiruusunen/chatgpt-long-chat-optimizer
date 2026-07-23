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
    debugLog: vi.fn(),

    showInitialPruneOverlay: vi.fn(),
    hideInitialPruneOverlay: vi.fn(),
    isPruneOverlayActive: vi.fn(),

    storePruneCompletionListeners: [],
    initialLoadHistoryReducedListeners: [],
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

vi.mock("../../src/content/bridge/chatStoreBridgeClient.js", () => ({
    onStoreHistoryPruneCompleted: vi.fn((listener) => {
        mockRefs.storePruneCompletionListeners.push(listener);

        return () => {
            mockRefs.storePruneCompletionListeners =
                mockRefs.storePruneCompletionListeners.filter(
                    (current) => current !== listener
                );
        };
    }),
    onInitialLoadHistoryReduced: vi.fn((listener) => {
        mockRefs.initialLoadHistoryReducedListeners.push(listener);

        return () => {
            mockRefs.initialLoadHistoryReducedListeners =
                mockRefs.initialLoadHistoryReducedListeners.filter(
                    (current) => current !== listener
                );
        };
    }),
}));

vi.mock("../../src/content/ui/pruneOverlay.js", () => ({
    showPruneOverlay: mockRefs.showInitialPruneOverlay,
    hidePruneOverlay: mockRefs.hideInitialPruneOverlay,
    isPruneOverlayActive: mockRefs.isPruneOverlayActive,
    showInitialPruneOverlay: mockRefs.showInitialPruneOverlay,
    hideInitialPruneOverlay: mockRefs.hideInitialPruneOverlay,
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: mockRefs.debugLog,
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

        mockRefs.storePruneCompletionListeners = [];
        mockRefs.initialLoadHistoryReducedListeners = [];

        for (const value of Object.values(mockRefs)) {
            if (typeof value?.mockReset === "function") {
                value.mockReset();
            }
        }

        mockRefs.ensureObserverAttached.mockReturnValue(true);
        mockRefs.withDomMutationGuard.mockImplementation((fn) => fn());
        mockRefs.isPruneOverlayActive.mockReturnValue(false);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("retries auto-prune after latest-assistant deferral clears without showing overlay", async () => {
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
                requestId: "auto-prune-request",
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

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(300);

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(2);
        expect(mockRefs.pruneOldSectionsBase.mock.calls[1][0]).toBe(1);

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

        expect(mockRefs.storePruneCompletionListeners).toHaveLength(1);

        mockRefs.storePruneCompletionListeners[0]({
            requestId: "auto-prune-request",
            result: {
                ok: true,
                requestId: "auto-prune-request",
            },
        });

        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

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
                onPruneStarted: expect.any(Function),
                onPruneResult: expect.any(Function),
                onPruneFinished: expect.any(Function),
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

    it("retries auto-prune after active-generation deferral clears without showing overlay", async () => {
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
                deferred: true,
                reason: "assistant generation active",
            })
            .mockReturnValueOnce({
                visibleSectionsChanged: true,
                placeholderChanged: false,
                posted: true,
                requestId: "active-generation-request",
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
            deferred: true,
            reason: "assistant generation active",
        });

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(300);

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(2);
        expect(mockRefs.pruneOldSectionsBase.mock.calls[1][0]).toBe(1);

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

        mockRefs.storePruneCompletionListeners[0]({
            requestId: "active-generation-request",
            result: {
                ok: true,
                requestId: "active-generation-request",
            },
        });

        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();

        expect(state.isAutoPruneScheduled).toBe(false);
        expect(state.debounceTimer).toBe(null);
    });

    it("keeps initial prune overlay visible until matching store prune completion", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");
        const onPruneFinished = vi.fn();

        mockRefs.pruneOldSectionsBase.mockReturnValue({
            visibleSectionsChanged: true,
            placeholderChanged: false,
            posted: true,
            requestId: "initial-prune-request",
            deferred: false,
            reason: null,
        });

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container, {
            onPruneFinished,
        });

        const deps = mockRefs.runInitialPruneBase.mock.calls[0][1];

        deps.pruneOldSections(1, {
            reason: "initial-prune",
        });

        deps.onPruneResult({
            posted: true,
            deferred: false,
            requestId: "initial-prune-request",
        });

        deps.onPruneFinished({
            reason: "initial-prune-finished",
            result: {
                posted: true,
                deferred: false,
                requestId: "initial-prune-request",
            },
        });

        expect(mockRefs.showInitialPruneOverlay).toHaveBeenCalledTimes(1);
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();
        expect(onPruneFinished).not.toHaveBeenCalled();

        mockRefs.storePruneCompletionListeners[0]({
            requestId: "initial-prune-request",
            result: {
                ok: true,
                requestId: "initial-prune-request",
            },
        });

        expect(onPruneFinished).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: "store-prune-completed",
            })
        );
        expect(mockRefs.hideInitialPruneOverlay).toHaveBeenCalledWith({
            reason: "store-prune-completed",
        });
    });

    it("fails closed when auto-prune throws", async () => {
        const { state, createPruneController } = await loadController();

        state.settings.autoPrune = true;
        state.settings.historyKeptExchanges = 1;
        state.featureFlags.pruning = true;
        state.didInitialPrune = true;
        state.isApplyingDomChanges = false;
        state.isAutoPruneScheduled = false;
        state.debounceTimer = null;

        const error = new Error("auto prune exploded");
        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        mockRefs.pruneOldSectionsBase.mockImplementation(() => {
            throw error;
        });

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.scheduleAutoPrune("reply-settled");

        await vi.advanceTimersByTimeAsync(300);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[Long Chat Optimizer] Auto-prune failed",
            error
        );

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "auto-prune-finally",
        });

        expect(mockRefs.debugLog).toHaveBeenCalledWith(
            "Prune controller: auto-prune failed",
            expect.objectContaining({
                reason: "reply-settled",
                error: "auto prune exploded",
            })
        );

        expect(state.isAutoPruneScheduled).toBe(false);
        expect(state.debounceTimer).toBe(null);

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();
    });

    it("shows a later initial prune overlay after the user manually hides the previous one", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container, {
            reason: "first-initial-prune",
        });

        const firstDeps = mockRefs.runInitialPruneBase.mock.calls[0][1];

        mockRefs.isPruneOverlayActive.mockReturnValue(false);

        firstDeps.onPruneStarted();

        expect(mockRefs.showInitialPruneOverlay).toHaveBeenCalledWith({
            reason: "first-initial-prune",
        });

        mockRefs.showInitialPruneOverlay.mockClear();

        controller.runInitialPrune(container, {
            reason: "second-initial-prune",
        });

        const secondDeps = mockRefs.runInitialPruneBase.mock.calls[1][1];

        mockRefs.isPruneOverlayActive.mockReturnValue(false);

        secondDeps.onPruneStarted();

        expect(mockRefs.showInitialPruneOverlay).toHaveBeenCalledWith({
            reason: "second-initial-prune",
        });
    });

    it("does not duplicate the initial prune overlay while it is still active", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container, {
            reason: "initial-prune",
        });

        const deps = mockRefs.runInitialPruneBase.mock.calls[0][1];

        mockRefs.isPruneOverlayActive.mockReturnValue(false);
        deps.onPruneStarted();

        mockRefs.showInitialPruneOverlay.mockClear();

        mockRefs.isPruneOverlayActive.mockReturnValue(true);
        deps.onPruneStarted();

        expect(mockRefs.showInitialPruneOverlay).not.toHaveBeenCalled();
    });


    it("marks current page history reduced from initial-load history-reduced signal", async () => {
        const { createPruneController } = await loadController();

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        expect(controller.getPruneStatus()).toMatchObject({
            currentPageHistoryWasReduced: false,
            currentPageHasPrunedTurns: false,
            currentPagePrunedTurnCount: 0,
        });

        mockRefs.initialLoadHistoryReducedListeners[0]?.({
            deletedNodeCount: 6,
            historyKeptExchanges: 5,
        });

        expect(controller.getPruneStatus()).toMatchObject({
            currentPageHistoryWasReduced: true,
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 6,
        });
    });

    it("marks current page history reduced from auto-prune result", async () => {
        const { state, createPruneController } = await loadController();

        state.currentPagePrunedTurnCount = 0;
        state.currentPageHistoryWasReduced = false;

        state.settings.autoPrune = true;
        state.settings.historyKeptExchanges = 5;
        state.featureFlags.pruning = true;
        state.didInitialPrune = true;
        state.isApplyingDomChanges = false;
        state.isAutoPruneScheduled = false;
        state.debounceTimer = null;

        mockRefs.pruneOldSectionsBase.mockReturnValueOnce({
            deletedCount: 2,
            posted: false,
            deferred: false,
            pruneDeferred: false,
            failed: false,
        });

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.scheduleAutoPrune("reply-settled");

        await vi.advanceTimersByTimeAsync(100);
        await Promise.resolve();

        expect(controller.getPruneStatus()).toMatchObject({
            currentPageHistoryWasReduced: true,
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 2,
        });
    });

    it("force-cancels an active initial prune overlay and ignores stale store completion", async () => {
        const { createPruneController } = await loadController();

        const container = document.createElement("main");
        const onPruneFinished = vi.fn();

        mockRefs.pruneOldSectionsBase.mockReturnValue({
            visibleSectionsChanged: true,
            placeholderChanged: false,
            posted: true,
            requestId: "stale-initial-prune-request",
            deferred: false,
            reason: null,
        });

        const controller = createPruneController({
            ensureObserverAttached: mockRefs.ensureObserverAttached,
            waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        controller.runInitialPrune(container, {
            onPruneFinished,
        });

        const deps = mockRefs.runInitialPruneBase.mock.calls[0][1];

        deps.pruneOldSections(1, {
            reason: "initial-prune",
        });

        deps.onPruneResult({
            posted: true,
            deferred: false,
            requestId: "stale-initial-prune-request",
        });

        deps.onPruneFinished({
            reason: "initial-prune-finished",
            result: {
                posted: true,
                deferred: false,
                requestId: "stale-initial-prune-request",
            },
        });

        expect(mockRefs.showInitialPruneOverlay).toHaveBeenCalledTimes(1);
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();
        expect(onPruneFinished).not.toHaveBeenCalled();

        controller.cancelInitialPrunePendingState({
            reason: "empty-chat-navigation",
        });

        expect(mockRefs.hideInitialPruneOverlay).toHaveBeenCalledWith({
            force: true,
            reason: "empty-chat-navigation",
        });

        mockRefs.hideInitialPruneOverlay.mockClear();

        mockRefs.storePruneCompletionListeners[0]({
            requestId: "stale-initial-prune-request",
            result: {
                ok: true,
                requestId: "stale-initial-prune-request",
            },
        });

        expect(onPruneFinished).not.toHaveBeenCalled();
        expect(mockRefs.hideInitialPruneOverlay).not.toHaveBeenCalled();
    });

});
