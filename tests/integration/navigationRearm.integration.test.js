import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    dispatchClick,
} from "../utils/domEvents.js";

const mockRefs = vi.hoisted(() => ({
    registeredHandlers: null,
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
        enableOffscreenOptimization: false,
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
    ensurePlaceholderState: vi.fn(),
    removePlaceholder: vi.fn(),
    installStartupPruneMask: vi.fn(),
    removeStartupPruneMask: vi.fn(),
}));

vi.mock("../../src/content/pruning/pruneSentinels.js", () => ({
    ensureTopRestoreSentinelState: vi.fn(),
    ensureBottomPruneSentinelState: vi.fn(),
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
    scheduleOffscreenRefresh: vi.fn(),
    setOffscreenOptimizationEnabled: vi.fn(),
}));

vi.mock("../../src/content/observers/observers.js", () => ({
    attachObserverToContainer: mockRefs.attachObserverToContainerBase,
    ensureObserverAttached: mockRefs.ensureObserverAttachedBase,
    waitForContainerAndInitialPrune: mockRefs.waitForContainerAndInitialPruneBase,
    createObserverDeps: mockRefs.createObserverDeps,
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    installReplyTimingListeners: vi.fn(),
    ensureReplyCompletionPoll: vi.fn(),
    isReplyStreaming: vi.fn(() => false),
}));

function createConversationContainer({ anchorId = "4" } = {}) {
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

        await resetNavigationWatcher();

        document.body.innerHTML = "";
        document.head.innerHTML = "";
        history.replaceState({}, "", "/");

        mockRefs.registeredHandlers = null;
        mockRefs.runInitialPruneBase.mockClear();
        mockRefs.attachObserverToContainerBase.mockClear();
        mockRefs.ensureObserverAttachedBase.mockClear();
        mockRefs.waitForContainerAndInitialPruneBase.mockClear();
        mockRefs.createObserverDeps.mockClear();

        originalRAF = globalThis.requestAnimationFrame;
        originalCAF = globalThis.cancelAnimationFrame;

        globalThis.requestAnimationFrame = (callback) =>
            setTimeout(() => callback(performance.now()), 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    });

    afterEach(async () => {
        vi.useRealTimers();
        await resetNavigationWatcher();
        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        history.replaceState({}, "", "/");
    });

    it("reruns initial prune after a route change", async () => {
        createConversationContainer();
        await import("../../src/content/core/index.js");
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        history.pushState({}, "", "/c/chat-2");
        vi.runAllTimers();
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
    });

    it("waits for a fresh container before rearming initial prune from a sidebar click hint", async () => {
        createConversationContainer();
        await import("../../src/content/core/index.js");
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.setAttribute("data-sidebar-item", "true");
        link.href = "/c/chat-from-sidebar";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
    });

    it("waits for a fresh container before rearming from a Recents conversation link without data-sidebar-item", async () => {
        createConversationContainer();
        await import("../../src/content/core/index.js");
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/c/chat-from-recents";
        link.textContent = "Recents chat";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);

        // ✅ NEW ASSERTION: ensure delayed refresh option was passed
        expect(mockRefs.runInitialPruneBase).toHaveBeenLastCalledWith(
            expect.any(Element),
            expect.any(Object),
            expect.objectContaining({
                useStartupMask: false,
                postPruneRefreshDelayMs: 500,
            })
        );
    });

    it("does not double-prune from the follow-up rearm after a Recents conversation link click", async () => {
        createConversationContainer();
        await import("../../src/content/core/index.js");
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/c/chat-from-recents-followup";
        link.textContent = "Recents chat followup";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        replaceConversationDom();

        vi.advanceTimersByTime(150);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(450);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(2);
    });

    it("does not rearm initial prune from a non-conversation link click", async () => {
        createConversationContainer();
        await import("../../src/content/core/index.js");
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);

        const link = document.createElement("a");
        link.href = "/settings";
        link.textContent = "Settings";
        document.body.appendChild(link);

        dispatchClick(link);

        replaceConversationDom();

        vi.advanceTimersByTime(1000);
        await flush();

        expect(mockRefs.runInitialPruneBase).toHaveBeenCalledTimes(1);
    });
});