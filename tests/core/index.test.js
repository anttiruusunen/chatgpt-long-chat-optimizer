import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    storageChangeListener: null,

    getSettings: vi.fn(),
    getConversationContainer: vi.fn(),
    invalidateConversationDomCache: vi.fn(),

    ensureQolStyles: vi.fn(),
    syncCodeBlockScrollbarStyles: vi.fn(),
    syncUserMessageClampStyles: vi.fn(),

    installReplyTimingListeners: vi.fn(),
    ensureReplyCompletionPoll: vi.fn(),

    installConversationNavigationWatcher: vi.fn(),
    installDomMutationGuard: vi.fn(),
    withDomMutationGuard: vi.fn((fn) => fn()),

    syncFeatureFlagsFromSettings: vi.fn(),
    syncPruningStateToPageBridge: vi.fn(),
    syncStoreReadOptimizationToPageWithRetry: vi.fn(),

    configureConversationMaintenance: vi.fn(),
    flushDeferredCssVisibilityWindowSync: vi.fn(),
    scheduleConversationChromeSync: vi.fn(),
    scheduleRefreshPostPruneState: vi.fn(),

    handleReplyStreamingStarted: vi.fn(),
    setOffscreenOptimizationEnabled: vi.fn(),

    attachObserverToContainer: vi.fn(),
    ensureObserverAttached: vi.fn(),
    waitForContainerAndInitialPrune: vi.fn(),
    createObserverDeps: vi.fn(),
    resetVisibleMessagesReadyNotification: vi.fn(),

    registerRuntimeMessageHandlers: vi.fn(),
    debugLog: vi.fn(),

    createPruneController: vi.fn(),

    pruneOldSections: vi.fn(),
    runInitialPrune: vi.fn(),
    bootstrapInitialPruneFromObservedMutation: vi.fn(),
    clearPendingAutoPrune: vi.fn(),
    scheduleAutoPrune: vi.fn(),
    showInitialPrunePendingOverlay: vi.fn(),
}));

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        storage: {
            onChanged: {
                addListener: vi.fn((listener) => {
                    mockRefs.storageChangeListener = listener;
                }),
            },
        },
    },
}));

vi.mock("../../src/content/core/settings.js", () => ({
    getSettings: mockRefs.getSettings,
}));

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationContainer: mockRefs.getConversationContainer,
    invalidateConversationDomCache: mockRefs.invalidateConversationDomCache,
}));

vi.mock("../../src/content/ui/qolStyles.js", () => ({
    ensureQolStyles: mockRefs.ensureQolStyles,
    syncCodeBlockScrollbarStyles: mockRefs.syncCodeBlockScrollbarStyles,
    syncUserMessageClampStyles: mockRefs.syncUserMessageClampStyles,
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    installReplyTimingListeners: mockRefs.installReplyTimingListeners,
    ensureReplyCompletionPoll: mockRefs.ensureReplyCompletionPoll,
}));

vi.mock("../../src/content/core/navigation.js", () => {
    function getPathnameFromLocationKey(locationKey = null) {
        const fallbackPath =
            typeof window !== "undefined" && window.location
                ? `${window.location.pathname || "/"}${window.location.search || ""}${window.location.hash || ""}`
                : "/";

        const rawLocationKey =
            typeof locationKey === "string" && locationKey.trim()
                ? locationKey.trim()
                : fallbackPath;

        try {
            const url = new URL(rawLocationKey, window.location.origin);
            return url.pathname || "/";
        } catch {
            return String(rawLocationKey || "/").split(/[?#]/)[0] || "/";
        }
    }

    function normalizeChatGptLocationPath(locationKey = null) {
        const fallbackPath =
            typeof window !== "undefined" && window.location
                ? `${window.location.pathname || "/"}${window.location.search || ""}`
                : "/";

        const rawLocationKey =
            typeof locationKey === "string" && locationKey.trim()
                ? locationKey.trim()
                : fallbackPath;

        try {
            const url = new URL(rawLocationKey, window.location.origin);
            return `${url.pathname || "/"}${url.search || ""}`;
        } catch {
            return rawLocationKey;
        }
    }

    function isNewChatRouteLocation(locationKey = null) {
        return getPathnameFromLocationKey(locationKey) === "/";
    }

    function isExistingConversationRouteLocation(locationKey = null) {
        const pathname = getPathnameFromLocationKey(locationKey);

        return (
            /^\/c\/[^/]+/.test(pathname) ||
            /^\/g\/[^/]+\/c\/[^/]+/.test(pathname)
        );
    }

    function isChatRouteLocation(locationKey = null) {
        return (
            isNewChatRouteLocation(locationKey) ||
            isExistingConversationRouteLocation(locationKey)
        );
    }

    return {
        installConversationNavigationWatcher:
            mockRefs.installConversationNavigationWatcher,
        normalizeChatGptLocationPath,
        isNewChatRouteLocation,
        isExistingConversationRouteLocation,
        isChatRouteLocation,
    };
});

vi.mock("../../src/content/core/domMutationGuard.js", () => ({
    installDomMutationGuard: mockRefs.installDomMutationGuard,
    withDomMutationGuard: mockRefs.withDomMutationGuard,
}));

vi.mock("../../src/content/core/featureFlags.js", () => ({
    syncFeatureFlagsFromSettings: mockRefs.syncFeatureFlagsFromSettings,
}));

vi.mock("../../src/content/core/pageBridgeSync.js", () => ({
    syncPruningStateToPageBridge: mockRefs.syncPruningStateToPageBridge,
    syncStoreReadOptimizationToPageWithRetry:
        mockRefs.syncStoreReadOptimizationToPageWithRetry,
}));

vi.mock("../../src/content/core/conversationMaintenance.js", () => ({
    configureConversationMaintenance: mockRefs.configureConversationMaintenance,
    flushDeferredCssVisibilityWindowSync:
        mockRefs.flushDeferredCssVisibilityWindowSync,
    scheduleConversationChromeSync: mockRefs.scheduleConversationChromeSync,
    scheduleRefreshPostPruneState: mockRefs.scheduleRefreshPostPruneState,
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    handleReplyStreamingStarted: mockRefs.handleReplyStreamingStarted,
    setOffscreenOptimizationEnabled: mockRefs.setOffscreenOptimizationEnabled,
}));

vi.mock("../../src/content/observers/observers.js", () => ({
    attachObserverToContainer: mockRefs.attachObserverToContainer,
    ensureObserverAttached: mockRefs.ensureObserverAttached,
    waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPrune,
    createObserverDeps: mockRefs.createObserverDeps,
    resetVisibleMessagesReadyNotification:
        mockRefs.resetVisibleMessagesReadyNotification,
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: mockRefs.registerRuntimeMessageHandlers,
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: mockRefs.debugLog,
}));

vi.mock("../../src/content/pruning/pruneController.js", () => ({
    createPruneController: mockRefs.createPruneController,
}));

const DEFAULT_TEST_SETTINGS = {
    historyKeptExchanges: 10,
    autoPrune: true,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableUserMessageClamp: true,
};

function createReadyConversationContainer() {
    const container = document.createElement("main");

    const section = document.createElement("section");
    section.setAttribute("data-testid", "conversation-turn-1");
    section.setAttribute("data-turn", "user");
    section.textContent = "turn-1";

    container.appendChild(section);

    return container;
}

function createEmptyConversationContainer() {
    return document.createElement("main");
}

function setTestLocation(path = "/c/current-chat") {
    window.history.replaceState({}, "", path);
}

function ensureTestLocation(path = "/c/current-chat") {
    const currentPath = `${window.location.pathname || "/"}${window.location.search || ""}`;

    if (
        currentPath === "/" ||
        currentPath === "/blank" ||
        currentPath === "blank"
    ) {
        setTestLocation(path);
    }
}

async function importFreshIndex() {
    vi.resetModules();

    const stateModule = await import("../../src/content/core/state.js");
    const { state, DEFAULT_SETTINGS } = stateModule;

    Object.assign(state.settings, {
        ...DEFAULT_SETTINGS,
        ...DEFAULT_TEST_SETTINGS,
    });

    state.featureFlags = {
        pruning: true,
        offscreenOptimization: true,
        storeReadOptimization: false,
        codeBlockScrollbars: true,
        userMessageClamp: true,
    };

    state.debugLoggingEnabled = false;
    state.didInitialPrune = false;
    state.storeReadOptimizationReadyForPage = false;
    state.debounceTimer = null;
    state.isAutoPruneScheduled = false;
    state.observedContainer = null;

    window.__threadOptimizerState = state;

    await import("../../src/content/core/index.js");

    await Promise.resolve();
    await Promise.resolve();

    return { stateModule };
}

function resetMocks() {
    mockRefs.storageChangeListener = null;

    for (const value of Object.values(mockRefs)) {
        if (typeof value?.mockReset === "function") {
            value.mockReset();
        }
    }

    mockRefs.withDomMutationGuard.mockImplementation((fn) => fn());

    mockRefs.getSettings.mockResolvedValue({ ...DEFAULT_TEST_SETTINGS });

    mockRefs.getConversationContainer.mockReturnValue(
        createReadyConversationContainer()
    );

    mockRefs.ensureObserverAttached.mockReturnValue(true);
    mockRefs.createObserverDeps.mockImplementation((deps) => deps);

    mockRefs.createPruneController.mockReturnValue({
        pruneOldSections: mockRefs.pruneOldSections,
        runInitialPrune: mockRefs.runInitialPrune,
        bootstrapInitialPruneFromObservedMutation:
            mockRefs.bootstrapInitialPruneFromObservedMutation,
        clearPendingAutoPrune: mockRefs.clearPendingAutoPrune,
        scheduleAutoPrune: mockRefs.scheduleAutoPrune,
        showInitialPrunePendingOverlay:
            mockRefs.showInitialPrunePendingOverlay,
    });
}

describe("core/index", () => {
    beforeEach(() => {
        setTestLocation("/c/current-chat");
        document.body.innerHTML = "";
        delete window.__threadOptimizerState;
        resetMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
        setTestLocation("/c/current-chat");
        document.body.innerHTML = "";
        delete window.__threadOptimizerState;
        resetMocks();
    });

    it("initializes settings, bridge sync, observers, runtime handlers, and initial prune", async () => {
        await importFreshIndex();

        expect(mockRefs.installDomMutationGuard).toHaveBeenCalledTimes(1);
        expect(mockRefs.getSettings).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncFeatureFlagsFromSettings).toHaveBeenCalledTimes(1);

        expect(mockRefs.ensureQolStyles).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncCodeBlockScrollbarStyles).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncUserMessageClampStyles).toHaveBeenCalledTimes(1);

        expect(
            mockRefs.syncStoreReadOptimizationToPageWithRetry
        ).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncPruningStateToPageBridge).toHaveBeenCalledTimes(1);

        expect(mockRefs.installReplyTimingListeners).toHaveBeenCalledTimes(1);
        expect(mockRefs.installConversationNavigationWatcher).toHaveBeenCalledTimes(1);
        expect(mockRefs.configureConversationMaintenance).toHaveBeenCalledWith({
            ensureObserverAttached: expect.any(Function),
            withDomMutationGuard: mockRefs.withDomMutationGuard,
        });

        expect(mockRefs.ensureObserverAttached).toHaveBeenCalledTimes(1);
        expect(mockRefs.runInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).not.toHaveBeenCalled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "initialize",
            forceCss: true,
        });

        expect(mockRefs.ensureReplyCompletionPoll).toHaveBeenCalledTimes(1);
        expect(mockRefs.registerRuntimeMessageHandlers).toHaveBeenCalledTimes(1);
    });

    it("keeps page store-read optimization gated off during startup initial prune", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;

        expect(state.storeReadOptimizationReadyForPage).toBe(false);
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalledTimes(1);
    });

    it("marks page store-read optimization ready after initial prune finishes without a pending store request", async () => {
        mockRefs.runInitialPrune.mockImplementation((container, options = {}) => {
            window.__threadOptimizerState.didInitialPrune = true;

            options.onPruneFinished?.({
                reason: "initial-prune-no-store-request",
                result: {
                    posted: false,
                    deferred: false,
                },
            });

            return {};
        });

        await importFreshIndex();

        const state = window.__threadOptimizerState;

        expect(state.storeReadOptimizationReadyForPage).toBe(true);
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalledTimes(2);
    });

    it("does not mark page store-read optimization ready while initial store prune is still pending", async () => {
        mockRefs.runInitialPrune.mockImplementation((container, options = {}) => {
            window.__threadOptimizerState.didInitialPrune = true;

            const result = {
                posted: true,
                deferred: false,
                requestId: "initial-prune-1",
            };

            options.onPruneResult?.(result);
            options.onPruneFinished?.({
                reason: "initial-prune-pending-store-request",
                result,
            });

            return result;
        });

        await importFreshIndex();

        const state = window.__threadOptimizerState;

        expect(state.storeReadOptimizationReadyForPage).toBe(false);
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalledTimes(1);
    });

    it("marks page store-read optimization ready after initial store prune completion is reported", async () => {
        mockRefs.runInitialPrune.mockImplementation((container, options = {}) => {
            window.__threadOptimizerState.didInitialPrune = true;

            const result = {
                posted: true,
                deferred: false,
                requestId: "initial-prune-1",
            };

            options.onPruneResult?.(result);
            options.onPruneFinished?.({
                reason: "store-prune-completed",
                result: {
                    ...result,
                    completed: true,
                },
            });

            return result;
        });

        await importFreshIndex();

        const state = window.__threadOptimizerState;

        expect(state.storeReadOptimizationReadyForPage).toBe(true);
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalledTimes(2);
    });

    it("disables page store-read optimization again when navigation rearms initial prune", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        state.didInitialPrune = true;
        state.storeReadOptimizationReadyForPage = true;

        const navigationHandler =
            mockRefs.installConversationNavigationWatcher.mock.calls[0][0]
                .onNavigationDetected;

        navigationHandler({
            reason: "pushState",
            locationKey: "/c/next-chat",
        });

        expect(state.storeReadOptimizationReadyForPage).toBe(false);
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalled();
    });

    it("waits for a container when none is attached during initialization for an existing chat URL", async () => {
        mockRefs.ensureObserverAttached.mockReturnValue(false);
        mockRefs.getConversationContainer.mockReturnValue(null);

        await importFreshIndex();

        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledWith(
            expect.objectContaining({
                requireConversationTurns: true,
            })
        );
        expect(mockRefs.showInitialPrunePendingOverlay).toHaveBeenCalledWith({
            reason: "waiting-for-initial-prune",
        });
    });

    it("waits for conversation turns when an empty container exists during initialization for an existing chat URL", async () => {
        mockRefs.ensureObserverAttached.mockReturnValue(true);
        mockRefs.getConversationContainer.mockReturnValue(
            createEmptyConversationContainer()
        );

        await importFreshIndex();

        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledWith(
            expect.objectContaining({
                requireConversationTurns: true,
            })
        );
        expect(mockRefs.showInitialPrunePendingOverlay).toHaveBeenCalledWith({
            reason: "waiting-for-initial-prune",
        });
    });

    it("does not show initial prune overlay or wait for turns when opening ChatGPT to a new chat", async () => {
        setTestLocation("/");
        mockRefs.ensureObserverAttached.mockReturnValue(false);
        mockRefs.getConversationContainer.mockReturnValue(null);

        await importFreshIndex();

        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledWith(
            expect.objectContaining({
                requireConversationTurns: false,
            })
        );
        expect(mockRefs.showInitialPrunePendingOverlay).not.toHaveBeenCalled();
    });

    it("does not attach observers or show prune overlay when opening a non-chat ChatGPT page", async () => {
        setTestLocation("/pricing");

        mockRefs.ensureObserverAttached.mockReturnValue(false);
        mockRefs.getConversationContainer.mockReturnValue(null);

        await importFreshIndex();

        expect(mockRefs.ensureObserverAttached).not.toHaveBeenCalled();
        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.showInitialPrunePendingOverlay).not.toHaveBeenCalled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "initialize-non-chat-route",
            forceCss: false,
            includeStreaming: false,
        });

        expect(mockRefs.ensureReplyCompletionPoll).toHaveBeenCalledTimes(1);
    });

    it("does not prune on storage changes while on a non-chat ChatGPT page", async () => {
        setTestLocation("/pricing");

        await importFreshIndex();

        mockRefs.runInitialPrune.mockClear();
        mockRefs.scheduleAutoPrune.mockClear();
        mockRefs.waitForContainerAndInitialPrune.mockClear();
        mockRefs.scheduleConversationChromeSync.mockClear();

        mockRefs.storageChangeListener(
            {
                historyKeptExchanges: { newValue: 4 },
            },
            "sync"
        );

        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.clearPendingAutoPrune).toHaveBeenCalled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "storage-changed-non-chat-route",
            forceCss: false,
            includeStreaming: false,
        });
    });

    it("does not show initial prune overlay or wait for turns when navigating to New chat", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        state.didInitialPrune = true;
        state.observedContainer = createReadyConversationContainer();

        mockRefs.showInitialPrunePendingOverlay.mockClear();
        mockRefs.waitForContainerAndInitialPrune.mockClear();

        const navigationHandler =
            mockRefs.installConversationNavigationWatcher.mock.calls[0][0]
                .onNavigationDetected;

        navigationHandler({
            reason: "new-chat-click",
            locationKey: "/",
        });

        expect(mockRefs.showInitialPrunePendingOverlay).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledWith(
            expect.objectContaining({
                requireConversationTurns: false,
            })
        );
    });

    it("does not show initial prune overlay or wait for turns when sidebar navigation lands on an empty chat route", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        state.didInitialPrune = true;
        state.observedContainer = createReadyConversationContainer();

        mockRefs.showInitialPrunePendingOverlay.mockClear();
        mockRefs.waitForContainerAndInitialPrune.mockClear();

        const navigationHandler =
            mockRefs.installConversationNavigationWatcher.mock.calls[0][0]
                .onNavigationDetected;

        navigationHandler({
            reason: "sidebar-click",
            locationKey: "/",
        });

        expect(mockRefs.showInitialPrunePendingOverlay).not.toHaveBeenCalled();
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.waitForContainerAndInitialPrune).toHaveBeenCalledWith(
            expect.objectContaining({
                requireConversationTurns: false,
            })
        );
    });

    it("schedules only maintenance when pruning is disabled at startup", async () => {
        mockRefs.getSettings.mockResolvedValue({
            ...DEFAULT_TEST_SETTINGS,
            enablePruning: false,
        });

        mockRefs.syncFeatureFlagsFromSettings.mockImplementation(() => {
            window.__threadOptimizerState.featureFlags.pruning = false;
        });

        await importFreshIndex();

        expect(mockRefs.runInitialPrune).not.toHaveBeenCalled();
        expect(mockRefs.scheduleRefreshPostPruneState).toHaveBeenCalledTimes(1);
        expect(mockRefs.showInitialPrunePendingOverlay).not.toHaveBeenCalled();
    });

    it("handles reply lifecycle callbacks", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        const options = mockRefs.installReplyTimingListeners.mock.calls[0][0];

        state.didInitialPrune = true;

        options.onBeforeReplyStarted();

        expect(mockRefs.pruneOldSections).toHaveBeenCalledWith(
            state.settings.historyKeptExchanges,
            {
                reason: "before-send",
                showOverlay: false,
                guardComposerCaret: false,
            }
        );

        options.onReplyStarted();

        expect(mockRefs.handleReplyStreamingStarted).toHaveBeenCalledTimes(1);

        options.onReplySettled();

        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledWith("reply-settled");
        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });
    });

    it("does not schedule reply-settled auto-prune when an incomplete initial prune is retried", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        const options = mockRefs.installReplyTimingListeners.mock.calls[0][0];

        state.didInitialPrune = false;

        mockRefs.getConversationContainer.mockReturnValue(
            createReadyConversationContainer()
        );

        mockRefs.scheduleAutoPrune.mockClear();
        mockRefs.runInitialPrune.mockClear();

        options.onReplySettled();

        expect(mockRefs.runInitialPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });
    });

    it("schedules reply-settled auto-prune after a deferred before-send prune", async () => {
        await importFreshIndex();

        const state = window.__threadOptimizerState;
        const options = mockRefs.installReplyTimingListeners.mock.calls[0][0];

        state.didInitialPrune = true;

        mockRefs.pruneOldSections.mockReturnValue({
            posted: false,
            deferred: true,
            reason: "conversation turns unstable",
        });

        options.onBeforeReplyStarted();

        expect(mockRefs.pruneOldSections).toHaveBeenCalledWith(
            state.settings.historyKeptExchanges,
            {
                reason: "before-send",
                showOverlay: false,
                guardComposerCaret: false,
            }
        );

        mockRefs.scheduleAutoPrune.mockClear();

        options.onReplySettled();

        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledWith("reply-settled");
    });

    it("reacts to storage changes by syncing affected feature paths", async () => {
        await importFreshIndex();

        expect(mockRefs.storageChangeListener).toBeTypeOf("function");

        mockRefs.storageChangeListener(
            {
                historyKeptExchanges: { newValue: 4 },
                enableOffscreenOptimization: { newValue: false },
                enableStoreReadOptimization: { newValue: true },
                enableCodeBlockScrollbars: { newValue: false },
                enableUserMessageClamp: { newValue: false },
                enableDebugLogging: { newValue: true },
            },
            "sync"
        );

        expect(mockRefs.syncFeatureFlagsFromSettings).toHaveBeenCalled();
        expect(mockRefs.syncPruningStateToPageBridge).toHaveBeenCalled();
        expect(mockRefs.syncStoreReadOptimizationToPageWithRetry).toHaveBeenCalled();
        expect(mockRefs.syncCodeBlockScrollbarStyles).toHaveBeenCalled();
        expect(mockRefs.syncUserMessageClampStyles).toHaveBeenCalled();
        expect(mockRefs.setOffscreenOptimizationEnabled).toHaveBeenCalled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "storage-changed",
            forceCss: true,
            includeStreaming: true,
        });
    });

    it("ignores storage changes outside sync storage", async () => {
        await importFreshIndex();

        mockRefs.syncFeatureFlagsFromSettings.mockClear();
        mockRefs.scheduleConversationChromeSync.mockClear();

        mockRefs.storageChangeListener(
            {
                enablePruning: { newValue: false },
            },
            "local"
        );

        expect(mockRefs.syncFeatureFlagsFromSettings).not.toHaveBeenCalled();
        expect(mockRefs.scheduleConversationChromeSync).not.toHaveBeenCalled();
    });
});