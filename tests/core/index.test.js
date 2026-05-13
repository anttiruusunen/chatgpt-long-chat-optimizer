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

vi.mock("../../src/content/core/navigation.js", () => ({
    installConversationNavigationWatcher: mockRefs.installConversationNavigationWatcher,
}));

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
    });
}

describe("core/index", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        delete window.__threadOptimizerState;
        resetMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
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

    it("waits for a container when none is attached during initialization", async () => {
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
    });

    it("waits for conversation turns when an empty container exists during initialization", async () => {
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
    });

    it("handles reply lifecycle callbacks", async () => {
        await importFreshIndex();

        const options = mockRefs.installReplyTimingListeners.mock.calls[0][0];

        options.onReplyStarted();

        expect(mockRefs.handleReplyStreamingStarted).toHaveBeenCalledTimes(1);

        options.onReplySettled();

        expect(mockRefs.scheduleConversationChromeSync).toHaveBeenCalledWith({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });
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