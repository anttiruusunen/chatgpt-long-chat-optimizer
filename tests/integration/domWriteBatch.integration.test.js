import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    registeredHandlers: null,
    replyTimingHandlers: null,
    ensurePlaceholderState: vi.fn(),
    removePlaceholder: vi.fn(),
    ensureTopRestoreSentinelState: vi.fn(),
    ensureBottomPruneSentinelState: vi.fn(),
    scheduleOffscreenRefresh: vi.fn(),
    syncCssVisibilityWindow: vi.fn(() => []),
    clearCssVisibilityWindow: vi.fn(),
    syncStreamingSectionState: vi.fn(),
    runInitialPruneBase: vi.fn(),
    attachObserverToContainerBase: vi.fn(),
    ensureObserverAttachedBase: vi.fn(() => true),
    waitForContainerAndInitialPruneBase: vi.fn(),
    createObserverDeps: vi.fn(({ scheduleAutoPrune, getDidInitialPrune }) => ({
        scheduleAutoPrune,
        getDidInitialPrune,
    })),
}));

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        storage: {
            onChanged: {
                addListener: vi.fn(),
            },
        },
        runtime: {
            onMessage: {
                addListener: vi.fn(),
            },
        },
    },
    storageSyncGet: vi.fn(async (defaults = {}) => ({
        ...defaults,
        historyKeptExchanges: 10,
        autoPrune: true,
        enablePruning: true,
        enableOffscreenOptimization: true,
        enableLargeCodeBlockOptimization: true,
        enableStreamingSectionHiding: true,
        enableDebugLogging: false,
    })),
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: vi.fn((handlers) => {
        mockRefs.registeredHandlers = handlers;
    }),
}));

vi.mock("../../src/content/pruning/prune.js", () => ({
    pruneOldSections: vi.fn(() => []),
    restoreAllSections: vi.fn(() => []),
    runInitialPrune: mockRefs.runInitialPruneBase,
    enforceSoftPrunedLimit: vi.fn(),
}));

vi.mock("../../src/content/pruning/pruneUi.js", () => ({
    ensurePlaceholderState: mockRefs.ensurePlaceholderState,
    removePlaceholder: mockRefs.removePlaceholder,
    installStartupPruneMask: vi.fn(),
    removeStartupPruneMask: vi.fn(),
}));

vi.mock("../../src/content/pruning/pruneSentinels.js", () => ({
    ensureTopRestoreSentinelState: mockRefs.ensureTopRestoreSentinelState,
    ensureBottomPruneSentinelState: mockRefs.ensureBottomPruneSentinelState,
}));

vi.mock("../../src/content/pruning/sentinelObservers.js", () => ({
    invalidateSentinelObserversForRootChange: vi.fn(),
    refreshTopRestoreSentinelObservation: vi.fn(),
    refreshBottomPruneSentinelObservation: vi.fn(),
    disconnectSentinelObservers: vi.fn(),
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    ensureSectionCssOffscreenMode: vi.fn(),
    handleReplyStreamingStarted: vi.fn(),
    scheduleOffscreenRefresh: mockRefs.scheduleOffscreenRefresh,
    setOffscreenOptimizationEnabled: vi.fn(),
}));

vi.mock("../../src/content/pruning/cssVisibilityWindow.js", () => ({
    syncCssVisibilityWindow: mockRefs.syncCssVisibilityWindow,
    clearCssVisibilityWindow: mockRefs.clearCssVisibilityWindow,
}));

vi.mock("../../src/content/observers/observers.js", () => ({
    attachObserverToContainer: mockRefs.attachObserverToContainerBase,
    ensureObserverAttached: mockRefs.ensureObserverAttachedBase,
    waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPruneBase,
    createObserverDeps: mockRefs.createObserverDeps,
}));

vi.mock("../../src/content/streaming/streamingSection.js", () => ({
    setStreamingSectionHidingEnabled: vi.fn(),
    syncStreamingSectionState: mockRefs.syncStreamingSectionState,
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    installReplyTimingListeners: vi.fn((handlers = {}) => {
        mockRefs.replyTimingHandlers = handlers;
    }),
    ensureReplyCompletionPoll: vi.fn(),
    isReplyStreaming: vi.fn(() => false),
}));

function createConversationContainer() {
    const root = document.createElement("div");
    const wrapper = document.createElement("div");
    const container = document.createElement("div");

    root.appendChild(wrapper);
    wrapper.appendChild(container);
    document.body.appendChild(root);

    for (let i = 1; i <= 4; i += 1) {
        const section = document.createElement("section");
        section.setAttribute("data-testid", `conversation-turn-${i}`);
        section.setAttribute("data-turn", i % 2 === 0 ? "assistant" : "user");
        if (i === 4) {
            section.setAttribute("data-scroll-anchor", "true");
        }
        section.textContent = `section-${i}`;
        container.appendChild(section);
    }

    return container;
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("dom write batch integration", () => {
    let originalRAF;
    let originalCAF;

    beforeEach(() => {
        vi.resetModules();

        document.body.innerHTML = "";
        document.head.innerHTML = "";

        mockRefs.registeredHandlers = null;
        mockRefs.replyTimingHandlers = null;
        mockRefs.ensurePlaceholderState.mockClear();
        mockRefs.removePlaceholder.mockClear();
        mockRefs.ensureTopRestoreSentinelState.mockClear();
        mockRefs.ensureBottomPruneSentinelState.mockClear();
        mockRefs.scheduleOffscreenRefresh.mockClear();
        mockRefs.syncCssVisibilityWindow.mockClear();
        mockRefs.clearCssVisibilityWindow.mockClear();
        mockRefs.syncStreamingSectionState.mockClear();
        mockRefs.runInitialPruneBase.mockClear();

        originalRAF = globalThis.requestAnimationFrame;
        originalCAF = globalThis.cancelAnimationFrame;

        globalThis.requestAnimationFrame = (callback) => {
            return setTimeout(() => callback(performance.now()), 0);
        };
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    });

    afterEach(() => {
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("coalesces repeated reply-settled chrome sync requests into one DOM-write flush", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushMicrotasks();

        mockRefs.ensurePlaceholderState.mockClear();
        mockRefs.removePlaceholder.mockClear();
        mockRefs.ensureTopRestoreSentinelState.mockClear();
        mockRefs.ensureBottomPruneSentinelState.mockClear();
        mockRefs.syncCssVisibilityWindow.mockClear();
        mockRefs.syncStreamingSectionState.mockClear();

        mockRefs.replyTimingHandlers.onReplySettled?.();
        mockRefs.replyTimingHandlers.onReplySettled?.();
        mockRefs.replyTimingHandlers.onReplySettled?.();

        expect(mockRefs.ensurePlaceholderState).toHaveBeenCalledTimes(0);
        expect(mockRefs.ensureTopRestoreSentinelState).toHaveBeenCalledTimes(0);
        expect(mockRefs.syncCssVisibilityWindow).toHaveBeenCalledTimes(0);

        await flushMicrotasks();

        expect(mockRefs.ensurePlaceholderState.mock.calls.length).toBeLessThanOrEqual(1);
        expect(mockRefs.removePlaceholder.mock.calls.length).toBeLessThanOrEqual(1);
        expect(mockRefs.ensureTopRestoreSentinelState).toHaveBeenCalledTimes(1);
        expect(mockRefs.ensureBottomPruneSentinelState).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncCssVisibilityWindow).toHaveBeenCalledTimes(1);
        expect(mockRefs.syncStreamingSectionState).toHaveBeenCalledTimes(1);
    });
});