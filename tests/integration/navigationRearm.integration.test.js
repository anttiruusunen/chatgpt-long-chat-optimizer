import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dispatchClick } from "../utils/domEvents.js";

const NAVIGATION_REARM_TEST_TIMEOUT_MS = 15000;

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

function appendConversationTurns(
    container,
    { anchorId = "4", start = 1, end = 4 } = {}
) {
    for (let i = start; i <= end; i += 1) {
        const section = document.createElement("section");
        section.setAttribute("data-testid", `conversation-turn-${i}`);
        section.setAttribute("data-turn", i % 2 === 0 ? "assistant" : "user");

        if (String(i) === anchorId) {
            section.setAttribute("data-scroll-anchor", "true");
        }

        section.textContent = `section-${i}`;
        container.appendChild(section);
    }
}

function createConversationContainer({ anchorId = "4", withTurns = true } = {}) {
    const root = document.createElement("main");
    const wrapper = document.createElement("div");
    const container = document.createElement("div");

    root.appendChild(wrapper);
    wrapper.appendChild(container);
    document.body.appendChild(root);

    if (withTurns) {
        appendConversationTurns(container, { anchorId });
    }

    return container;
}

function replaceConversationDom({ withTurns = true } = {}) {
    document.body.innerHTML = "";
    return createConversationContainer({ withTurns });
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function flushScheduledWork() {
    await flushMicrotasks();
    vi.advanceTimersByTime(0);
    await flushMicrotasks();
    vi.advanceTimersByTime(0);
    await flushMicrotasks();
}

async function waitForStartupToSettle() {
    await flushScheduledWork();

    expect(
        mockRefs.runInitialPruneBase.mock.calls.length +
            mockRefs.waitForContainerAndInitialPruneBase.mock.calls.length
    ).toBeGreaterThan(0);

    await flushScheduledWork();
}

async function advanceNavigationDetection() {
    vi.advanceTimersByTime(150);
    await flushScheduledWork();
}

async function advanceFreshContainerPoll() {
    vi.advanceTimersByTime(100);
    await flushScheduledWork();
    vi.advanceTimersByTime(100);
    await flushScheduledWork();
}

async function advancePastFollowupWindow() {
    vi.advanceTimersByTime(500);
    await flushScheduledWork();
}

function navigateTo(path) {
    history.pushState({}, "", path);
}

async function resetNavigationWatcher() {
    const navigationModule = await import("../../src/content/core/navigation.js");
    navigationModule.resetConversationNavigationWatcherForTests();
}

function clearNavigationMocks() {
    mockRefs.runInitialPruneBase.mockClear();
    mockRefs.attachObserverToContainerBase.mockClear();
    mockRefs.ensureObserverAttachedBase.mockClear();
    mockRefs.waitForContainerAndInitialPruneBase.mockClear();
    mockRefs.resetVisibleMessagesReadyNotification.mockClear();
}

async function importIndexAndClearStartupPruneCount() {
    await import("../../src/content/core/index.js");
    await waitForStartupToSettle();

    clearNavigationMocks();
}

describe("navigation rearm integration", () => {
    let originalRAF;
    let originalCAF;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();

        document.documentElement.innerHTML = "<head></head><body></body>";
        history.replaceState({}, "", "/");

        delete window.__threadOptimizerState;

        await resetNavigationWatcher();

        mockRefs.registeredHandlers = null;
        clearNavigationMocks();
        mockRefs.createObserverDeps.mockClear();

        originalRAF = globalThis.requestAnimationFrame;
        originalCAF = globalThis.cancelAnimationFrame;

        globalThis.requestAnimationFrame = (callback) =>
            setTimeout(() => callback(performance.now()), 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    });

    afterEach(async () => {
        await resetNavigationWatcher();

        vi.clearAllTimers();
        vi.useRealTimers();

        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;

        document.documentElement.innerHTML = "<head></head><body></body>";
        history.replaceState({}, "", "/");
        delete window.__threadOptimizerState;

        vi.resetModules();
    });

    it(
        "reruns initial prune after a route change",
        async () => {
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            replaceConversationDom();
            navigateTo("/c/chat-2");

            await flushScheduledWork();
            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
            expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
                expect.any(Element),
                expect.objectContaining({
                    pruneOldSections: expect.any(Function),
                    refreshObservedSections: expect.any(Function),
                })
            );
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );

    it(
        "rearms initial prune from a sidebar click hint after navigation",
        async () => {
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            const link = document.createElement("a");
            link.setAttribute("data-sidebar-item", "true");
            link.href = "/c/chat-from-sidebar";
            document.body.appendChild(link);

            dispatchClick(link);
            navigateTo("/c/chat-from-sidebar");

            await advanceNavigationDetection();

            const callsAfterNavigationHint =
                mockRefs.runInitialPruneBase.mock.calls.length;

            replaceConversationDom();

            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase.mock.calls.length).toBeGreaterThan(
                callsAfterNavigationHint
            );
            expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
                expect.any(Element),
                expect.objectContaining({
                    pruneOldSections: expect.any(Function),
                    refreshObservedSections: expect.any(Function),
                })
            );
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );

    it(
        "rearms from a Recents conversation link without data-sidebar-item after navigation",
        async () => {
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            const link = document.createElement("a");
            link.href = "/c/chat-from-recents";
            link.textContent = "Recents chat";
            document.body.appendChild(link);

            dispatchClick(link);
            navigateTo("/c/chat-from-recents");

            await advanceNavigationDetection();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            replaceConversationDom();

            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
            expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
                expect.any(Element),
                expect.objectContaining({
                    pruneOldSections: expect.any(Function),
                    refreshObservedSections: expect.any(Function),
                })
            );
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );

    it(
        "does not double-prune from the follow-up rearm after a Recents conversation link click",
        async () => {
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            const link = document.createElement("a");
            link.href = "/c/chat-from-recents-followup";
            link.textContent = "Recents chat followup";
            document.body.appendChild(link);

            dispatchClick(link);
            navigateTo("/c/chat-from-recents-followup");

            await advanceNavigationDetection();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            replaceConversationDom();

            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

            await advancePastFollowupWindow();

            expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );

    it(
        "does not consume initial prune on an empty New Chat container",
        async () => {
            history.replaceState({}, "", "/c/current-chat");
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            const newChatButton = document.createElement("button");
            newChatButton.setAttribute("aria-label", "New chat");
            document.body.appendChild(newChatButton);

            dispatchClick(newChatButton);
            navigateTo("/");

            replaceConversationDom({ withTurns: false });

            await advanceNavigationDetection();
            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            clearNavigationMocks();

            const recentsLink = document.createElement("a");
            recentsLink.href = "/c/real-chat-after-new";
            recentsLink.textContent = "Real chat after new";
            document.body.appendChild(recentsLink);

            dispatchClick(recentsLink);
            navigateTo("/c/real-chat-after-new");

            await advanceNavigationDetection();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            replaceConversationDom({ withTurns: true });

            await advanceFreshContainerPoll();
            await advanceFreshContainerPoll();

            expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
            expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
                expect.any(Element),
                expect.objectContaining({
                    pruneOldSections: expect.any(Function),
                    refreshObservedSections: expect.any(Function),
                })
            );
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );

    it(
        "does not rearm initial prune from a non-conversation link click",
        async () => {
            createConversationContainer();

            await importIndexAndClearStartupPruneCount();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();

            const link = document.createElement("a");
            link.href = "/settings";
            link.textContent = "Settings";
            document.body.appendChild(link);

            dispatchClick(link);
            replaceConversationDom();

            vi.advanceTimersByTime(1000);
            await flushScheduledWork();

            expect(mockRefs.runInitialPruneBase).not.toHaveBeenCalled();
        },
        NAVIGATION_REARM_TEST_TIMEOUT_MS
    );
});