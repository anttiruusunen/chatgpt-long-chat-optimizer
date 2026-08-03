import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefs = vi.hoisted(() => {
    const state = {
        settings: {
            autoPrune: true,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableStoreReadOptimization: true,
            enableDebugLogging: false,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
            historyKeptExchanges: 5,
        },

        featureFlags: {
            pruning: true,
            offscreenOptimization: true,
        },

        didInitialPrune: true,
        isApplyingDomChanges: false,
        isAutoPruneScheduled: false,
        debounceTimer: null,

        currentPagePrunedTurnCount: 0,
        currentPageHistoryWasReduced: false,

        observedContainer: null,
        storeReadOptimizationReadyForPage: true,

        debugLoggingEnabled: false,
    };

    return {
        state,

        installedReplyTimingListeners: null,
        storageChangedListener: null,
        navigationListener: null,

        getSettings: vi.fn(),

        getConversationContainer: vi.fn(),
        invalidateConversationDomCache: vi.fn(),

        handleReplyStreamingStarted: vi.fn(),
        optimizeUnoptimizedConversationSections: vi.fn(),
        setOffscreenOptimizationEnabled: vi.fn(),

        attachObserverToContainerBase: vi.fn(),
        ensureObserverAttachedBase: vi.fn(),
        waitForContainerAndInitialPruneBase: vi.fn(),
        createObserverDeps: vi.fn(),
        resetVisibleMessagesReadyNotification: vi.fn(),

        registerRuntimeMessageHandlers: vi.fn(),

        debugLog: vi.fn(),

        installReplyTimingListeners: vi.fn(),
        ensureReplyCompletionPoll: vi.fn(),

        ensureQolStyles: vi.fn(),
        syncCodeBlockScrollbarStyles: vi.fn(),
        syncUserMessageClampStyles: vi.fn(),

        installConversationNavigationWatcher: vi.fn(),
        isChatRouteLocation: vi.fn(),
        isNewChatRouteLocation: vi.fn(),
        normalizeChatGptLocationPath: vi.fn(),

        configureConversationMaintenance: vi.fn(),
        scheduleConversationChromeSync: vi.fn(),
        scheduleRefreshPostPruneState: vi.fn(),

        installDomMutationGuard: vi.fn(),
        withDomMutationGuard: vi.fn(),

        syncFeatureFlagsFromSettings: vi.fn(),

        syncPruningStateToPageBridge: vi.fn(),
        syncStoreReadOptimizationToPageWithRetry: vi.fn(),

        requestBranchCacheClear: vi.fn(),

        pruneOldSections: vi.fn(),
        runInitialPrune: vi.fn(),
        bootstrapInitialPruneFromObservedMutation: vi.fn(),
        clearPendingAutoPrune: vi.fn(),
        scheduleAutoPrune: vi.fn(),
        showInitialPrunePendingOverlay: vi.fn(),
        cancelInitialPrunePendingState: vi.fn(),
        getPruneStatus: vi.fn(),

        createPruneController: vi.fn(),
    };
});

vi.mock("../../src/content/core/state.js", () => ({
    state: mockRefs.state,
}));

vi.mock("../../src/content/core/settings.js", () => ({
    getSettings: mockRefs.getSettings,
}));

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationContainer: mockRefs.getConversationContainer,
    invalidateConversationDomCache: mockRefs.invalidateConversationDomCache,
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    handleReplyStreamingStarted: mockRefs.handleReplyStreamingStarted,
    optimizeUnoptimizedConversationSections:
        mockRefs.optimizeUnoptimizedConversationSections,
    setOffscreenOptimizationEnabled:
        mockRefs.setOffscreenOptimizationEnabled,
}));

vi.mock("../../src/content/observers/observers.js", () => ({
    attachObserverToContainer:
        mockRefs.attachObserverToContainerBase,
    ensureObserverAttached:
        mockRefs.ensureObserverAttachedBase,
    waitForContainerAndInitialPrune:
        mockRefs.waitForContainerAndInitialPruneBase,
    createObserverDeps:
        mockRefs.createObserverDeps,
    resetVisibleMessagesReadyNotification:
        mockRefs.resetVisibleMessagesReadyNotification,
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers:
        mockRefs.registerRuntimeMessageHandlers,
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: mockRefs.debugLog,
}));

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        storage: {
            onChanged: {
                addListener: vi.fn((listener) => {
                    mockRefs.storageChangedListener = listener;
                }),
            },
        },
    },
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    installReplyTimingListeners:
        mockRefs.installReplyTimingListeners,
    ensureReplyCompletionPoll:
        mockRefs.ensureReplyCompletionPoll,
}));

vi.mock("../../src/content/ui/qolStyles.js", () => ({
    ensureQolStyles:
        mockRefs.ensureQolStyles,
    syncCodeBlockScrollbarStyles:
        mockRefs.syncCodeBlockScrollbarStyles,
    syncUserMessageClampStyles:
        mockRefs.syncUserMessageClampStyles,
}));

vi.mock("../../src/content/core/navigation.js", () => ({
    installConversationNavigationWatcher:
        mockRefs.installConversationNavigationWatcher,
    isChatRouteLocation:
        mockRefs.isChatRouteLocation,
    isNewChatRouteLocation:
        mockRefs.isNewChatRouteLocation,
    normalizeChatGptLocationPath:
        mockRefs.normalizeChatGptLocationPath,
}));

vi.mock("../../src/content/core/conversationMaintenance.js", () => ({
    configureConversationMaintenance:
        mockRefs.configureConversationMaintenance,
    scheduleConversationChromeSync:
        mockRefs.scheduleConversationChromeSync,
    scheduleRefreshPostPruneState:
        mockRefs.scheduleRefreshPostPruneState,
}));

vi.mock("../../src/content/core/domMutationGuard.js", () => ({
    installDomMutationGuard:
        mockRefs.installDomMutationGuard,
    withDomMutationGuard:
        mockRefs.withDomMutationGuard,
}));

vi.mock("../../src/content/core/featureFlags.js", () => ({
    syncFeatureFlagsFromSettings:
        mockRefs.syncFeatureFlagsFromSettings,
}));

vi.mock("../../src/content/core/pageBridgeSync.js", () => ({
    syncPruningStateToPageBridge:
        mockRefs.syncPruningStateToPageBridge,
    syncStoreReadOptimizationToPageWithRetry:
        mockRefs.syncStoreReadOptimizationToPageWithRetry,
}));

vi.mock("../../src/content/bridge/chatStoreBridgeClient.js", () => ({
    requestBranchCacheClear:
        mockRefs.requestBranchCacheClear,
}));

vi.mock("../../src/content/pruning/pruneController.js", () => ({
    createPruneController:
        mockRefs.createPruneController,
}));

function resetMockState() {
    mockRefs.state.settings = {
        autoPrune: true,
        enablePruning: true,
        enableOffscreenOptimization: true,
        enableStoreReadOptimization: true,
        enableDebugLogging: false,
        enableCodeBlockScrollbars: true,
        enableUserMessageClamp: true,
        historyKeptExchanges: 5,
    };

    mockRefs.state.featureFlags = {
        pruning: true,
        offscreenOptimization: true,
    };

    mockRefs.state.didInitialPrune = true;
    mockRefs.state.isApplyingDomChanges = false;
    mockRefs.state.isAutoPruneScheduled = false;
    mockRefs.state.debounceTimer = null;

    mockRefs.state.currentPagePrunedTurnCount = 0;
    mockRefs.state.currentPageHistoryWasReduced = false;

    mockRefs.state.observedContainer = null;
    mockRefs.state.storeReadOptimizationReadyForPage = true;

    mockRefs.state.debugLoggingEnabled = false;

    mockRefs.installedReplyTimingListeners = null;
    mockRefs.storageChangedListener = null;
    mockRefs.navigationListener = null;
}

function resetMocks() {
    for (const value of Object.values(mockRefs)) {
        if (typeof value?.mockReset === "function") {
            value.mockReset();
        }
    }
}

function configureDefaultMocks() {
    mockRefs.getSettings.mockResolvedValue({
        ...mockRefs.state.settings,
    });

    mockRefs.getConversationContainer.mockReturnValue(null);
    mockRefs.ensureObserverAttachedBase.mockReturnValue(false);
    mockRefs.waitForContainerAndInitialPruneBase.mockReturnValue(false);

    mockRefs.createObserverDeps.mockImplementation((deps) => deps);

    mockRefs.isChatRouteLocation.mockReturnValue(true);
    mockRefs.isNewChatRouteLocation.mockReturnValue(false);
    mockRefs.normalizeChatGptLocationPath.mockReturnValue("/c/test-conversation");

    mockRefs.installReplyTimingListeners.mockImplementation((listeners) => {
        mockRefs.installedReplyTimingListeners = listeners;
    });

    mockRefs.installConversationNavigationWatcher.mockImplementation(
        ({ onNavigationDetected } = {}) => {
            mockRefs.navigationListener = onNavigationDetected;
        }
    );

    mockRefs.withDomMutationGuard.mockImplementation((callback) => callback());

    mockRefs.syncFeatureFlagsFromSettings.mockImplementation(() => {
        mockRefs.state.featureFlags.pruning = true;
        mockRefs.state.featureFlags.offscreenOptimization = true;
    });

    mockRefs.getPruneStatus.mockReturnValue({
        currentPagePrunedTurnCount: 0,
        currentPageHistoryWasReduced: false,
        currentPageHasPrunedTurns: false,
        historyKeptExchanges: 5,
        pruningEnabled: true,
        autoPrune: true,
        didInitialPrune: true,
    });

    mockRefs.createPruneController.mockReturnValue({
        pruneOldSections:
            mockRefs.pruneOldSections,
        runInitialPrune:
            mockRefs.runInitialPrune,
        bootstrapInitialPruneFromObservedMutation:
            mockRefs.bootstrapInitialPruneFromObservedMutation,
        clearPendingAutoPrune:
            mockRefs.clearPendingAutoPrune,
        scheduleAutoPrune:
            mockRefs.scheduleAutoPrune,
        showInitialPrunePendingOverlay:
            mockRefs.showInitialPrunePendingOverlay,
        cancelInitialPrunePendingState:
            mockRefs.cancelInitialPrunePendingState,
        getPruneStatus:
            mockRefs.getPruneStatus,
    });
}

async function loadIndex() {
    vi.resetModules();

    await import("../../src/content/core/index.js");

    await Promise.resolve();
    await Promise.resolve();

    expect(mockRefs.installReplyTimingListeners).toHaveBeenCalledTimes(1);
    expect(mockRefs.installedReplyTimingListeners).toBeTruthy();

    return mockRefs.installedReplyTimingListeners;
}

beforeEach(() => {
    vi.useFakeTimers();

    document.body.innerHTML = "";

    resetMocks();
    resetMockState();
    configureDefaultMocks();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();

    document.body.innerHTML = "";
});

describe("reply-settled auto-prune lifecycle", () => {
    it("cancels a pending reply-settled prune when the next reply begins", async () => {
        const listeners = await loadIndex();

        listeners.onReplySettled();

        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(500);

        listeners.onBeforeReplyStarted({
            trigger: "textarea-enter",
        });

        listeners.onReplyStarted({
            trigger: "textarea-enter",
        });

        await vi.advanceTimersByTimeAsync(1000);

        expect(mockRefs.clearPendingAutoPrune).toHaveBeenCalled();
        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();
    });

    it("cancels handed-off auto-prune work when a new reply starts after the settled delay", async () => {
        const listeners = await loadIndex();

        listeners.onReplySettled();

        await vi.advanceTimersByTimeAsync(1000);

        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledWith(
            "reply-settled-stable"
        );

        mockRefs.clearPendingAutoPrune.mockClear();

        listeners.onBeforeReplyStarted({
            trigger: "submit-button",
        });

        expect(mockRefs.clearPendingAutoPrune).toHaveBeenCalledTimes(1);
    });

    it("also invalidates pending settled-prune work from the reply-start callback", async () => {
        const listeners = await loadIndex();

        listeners.onReplySettled();

        await vi.advanceTimersByTimeAsync(500);

        listeners.onReplyStarted({
            trigger: "submit-button",
        });

        await vi.advanceTimersByTimeAsync(1000);

        expect(mockRefs.clearPendingAutoPrune).toHaveBeenCalled();
        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        expect(
            mockRefs.handleReplyStreamingStarted
        ).toHaveBeenCalledTimes(1);
    });

    it("runs reply-settled auto-prune normally when no newer reply starts", async () => {
        const listeners = await loadIndex();

        listeners.onReplySettled();

        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(999);

        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);

        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledWith(
            "reply-settled-stable"
        );
    });

    it("rearms settled pruning for the new reply after stale work was cancelled", async () => {
        const listeners = await loadIndex();

        /*
         * Reply A settles and schedules its delayed prune.
         */
        listeners.onReplySettled();

        await vi.advanceTimersByTimeAsync(500);

        /*
         * Reply B begins before A's delayed prune is allowed to fire.
         */
        listeners.onBeforeReplyStarted({
            trigger: "textarea-enter",
        });

        listeners.onReplyStarted({
            trigger: "textarea-enter",
        });

        await vi.advanceTimersByTimeAsync(1000);

        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        /*
         * Reply B genuinely settles. It should now receive its own fresh
         * delayed prune.
         */
        listeners.onReplySettled();

        await vi.advanceTimersByTimeAsync(999);

        expect(mockRefs.scheduleAutoPrune).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);

        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledTimes(1);
        expect(mockRefs.scheduleAutoPrune).toHaveBeenCalledWith(
            "reply-settled-stable"
        );
    });

    it("requests one branch-cache clear when a reply settles", async () => {
        const listeners = await loadIndex();

        listeners.onReplySettled();

        expect(
            mockRefs.requestBranchCacheClear
        ).toHaveBeenCalledTimes(1);

        expect(
            mockRefs.requestBranchCacheClear
        ).toHaveBeenCalledWith({
            reason: "reply-settled",
        });
    });

    it("does not request a branch-cache clear when a reply starts", async () => {
        const listeners = await loadIndex();

        listeners.onBeforeReplyStarted({
            trigger: "textarea-enter",
        });

        listeners.onReplyStarted({
            trigger: "textarea-enter",
        });

        expect(
            mockRefs.requestBranchCacheClear
        ).not.toHaveBeenCalled();
    });

    it("does not request a branch-cache clear after settlement on a non-chat route", async () => {
        const listeners = await loadIndex();

        mockRefs.isChatRouteLocation.mockReturnValue(false);

        listeners.onReplySettled();

        expect(
            mockRefs.requestBranchCacheClear
        ).not.toHaveBeenCalled();
    });
});