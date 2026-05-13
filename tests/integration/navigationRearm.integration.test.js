import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchClick } from "../utils/domEvents.js";

const mockRefs = vi.hoisted(() => {
    function getTestConversationContainer() {
        return document.querySelector("main > div > div");
    }

    return {
        registeredHandlers: null,
        runInitialPruneBase: vi.fn(() => {
            if (window.__threadOptimizerState) {
                window.__threadOptimizerState.didInitialPrune = true;
            }

            return {};
        }),
        attachObserverToContainerBase: vi.fn((container) => {
            if (window.__threadOptimizerState) {
                window.__threadOptimizerState.observedContainer = container;
            }
        }),
        ensureObserverAttachedBase: vi.fn(() => {
            const container = getTestConversationContainer();

            if (container && window.__threadOptimizerState) {
                window.__threadOptimizerState.observedContainer = container;
            }

            return Boolean(container);
        }),
        waitForContainerAndInitialPruneBase: vi.fn(),
        resetVisibleMessagesReadyNotification: vi.fn(),
        createObserverDeps: vi.fn(
            ({ scheduleAutoPrune, getDidInitialPrune, bootstrapInitialPrune }) => ({
                scheduleAutoPrune,
                getDidInitialPrune,
                bootstrapInitialPrune,
            })
        ),
    };
});

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
        enableOffscreenOptimization: false,
        enableDebugLogging: false,
        enableStoreReadOptimization: false,
        enableCodeBlockScrollbars: true,
        enableUserMessageClamp: true,
    })),
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: vi.fn((handlers) => {
        mockRefs.registeredHandlers = handlers;
    }),
}));

vi.mock("../../src/content/pruning/prune.js", () => ({
    pruneOldSections: vi.fn(() => []),
    runInitialPrune: mockRefs.runInitialPruneBase,
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    ensureSectionCssOffscreenMode: vi.fn(),
    handleReplyStreamingStarted: vi.fn(),
    scheduleOffscreenRefresh: vi.fn(),
    setOffscreenOptimizationEnabled: vi.fn(),
}));

vi.mock("../../src/content/observers/observers.js", () => ({
    attachObserverToContainer: mockRefs.attachObserverToContainerBase,
    ensureObserverAttached: mockRefs.ensureObserverAttachedBase,
    waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPruneBase,
    resetVisibleMessagesReadyNotification:
        mockRefs.resetVisibleMessagesReadyNotification,
    createObserverDeps: mockRefs.createObserverDeps,
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    installReplyTimingListeners: vi.fn(),
    ensureReplyCompletionPoll: vi.fn(),
    isReplyStreaming: vi.fn(() => false),
}));

function createConversationContainer({ anchorId = "4" } = {}) {
    const root = document.createElement("main");
    const wrapper = document.createElement("div");
    const container = document.createElement("div");

    root.appendChild(wrapper);
    wrapper.appendChild(container);
    document.body.appendChild(root);

    for (let i = 1; i <= 4; i += 1) {
        const section = document.createElement("section");
        section.setAttribute("data-testid", `conversation-turn-${i}`);
        section.setAttribute("data-turn", i % 2 === 0 ? "assistant" : "user");

        if (String(i) === anchorId) {
            section.setAttribute("data-scroll-anchor", "true");
        }

        section.textContent = `section-${i}`;
        container.appendChild(section);
    }

    return container;
}

function replaceConversationDom() {
    document.body.innerHTML = "";
    return createConversationContainer();
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

async function flushScheduledWork() {
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await flush();
}

async function advanceNavigationDetection() {
    await vi.advanceTimersByTimeAsync(150);
    await flushScheduledWork();
}

async function advanceFreshContainerPoll() {
    await vi.advanceTimersByTimeAsync(100);
    await flushScheduledWork();
    await vi.advanceTimersByTimeAsync(100);
    await flushScheduledWork();
}

async function advancePastFollowupWindow() {
    await vi.advanceTimersByTimeAsync(500);
    await flushScheduledWork();
}

function navigateTo(path) {
    history.pushState({}, "", path);
}

async function resetNavigationWatcher() {
    const navigationModule = await import("../../src/content/core/navigation.js");
    navigationModule.resetConversationNavigationWatcherForTests();
}

describe("navigation rearm integration", () => {
    let originalRAF;
    let originalCAF;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();

        document.body.innerHTML = "";
        document.head.innerHTML = "";
        history.replaceState({}, "", "/");

        delete window.__threadOptimizerState;

        await resetNavigationWatcher();

        mockRefs.registeredHandlers = null;
        mockRefs.runInitialPruneBase.mockClear();
        mockRefs.attachObserverToContainerBase.mockClear();
        mockRefs.ensureObserverAttachedBase.mockClear();
        mockRefs.waitForContainerAndInitialPruneBase.mockClear();
        mockRefs.resetVisibleMessagesReadyNotification.mockClear();
        mockRefs.createObserverDeps.mockClear();

        originalRAF = globalThis.requestAnimationFrame;
        originalCAF = globalThis.cancelAnimationFrame;

        globalThis.requestAnimationFrame = (callback) =>
            setTimeout(() => callback(performance.now()), 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    });

    afterEach(async () => {
        vi.clearAllTimers();
        vi.useRealTimers();

        await resetNavigationWatcher();

        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;

        document.body.innerHTML = "";
        document.head.innerHTML = "";
        history.replaceState({}, "", "/");
        delete window.__threadOptimizerState;
    });

    it("reruns initial prune after a route change", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();
        navigateTo("/c/chat-2");

        await advanceNavigationDetection();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
    });

    it("rearms initial prune from a sidebar click hint after navigation", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.setAttribute("data-sidebar-item", "true");
        link.href = "/c/chat-from-sidebar";
        document.body.appendChild(link);

        dispatchClick(link);
        navigateTo("/c/chat-from-sidebar");

        await advanceNavigationDetection();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        await advanceFreshContainerPoll();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
        expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
            expect.any(Element),
            expect.objectContaining({
                pruneOldSections: expect.any(Function),
                refreshObservedSections: expect.any(Function),
            })
        );
    });

    it("rearms from a Recents conversation link without data-sidebar-item after navigation", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/c/chat-from-recents";
        link.textContent = "Recents chat";
        document.body.appendChild(link);

        dispatchClick(link);
        navigateTo("/c/chat-from-recents");

        await advanceNavigationDetection();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        await advanceFreshContainerPoll();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
        expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
            expect.any(Element),
            expect.objectContaining({
                pruneOldSections: expect.any(Function),
                refreshObservedSections: expect.any(Function),
            })
        );
    });

    it("does not double-prune from the follow-up rearm after a Recents conversation link click", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/c/chat-from-recents-followup";
        link.textContent = "Recents chat followup";
        document.body.appendChild(link);

        dispatchClick(link);
        navigateTo("/c/chat-from-recents-followup");

        await advanceNavigationDetection();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        await advanceFreshContainerPoll();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);

        await advancePastFollowupWindow();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
    });

    it("does not rearm initial prune from a non-conversation link click", async () => {
        createConversationContainer();

        await import("../../src/content/core/index.js");
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/settings";
        link.textContent = "Settings";
        document.body.appendChild(link);

        dispatchClick(link);
        replaceConversationDom();

        await vi.advanceTimersByTimeAsync(1000);
        await flushScheduledWork();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
    });
});