import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushAsyncWork } from "../utils/async.js";
import {
    buildConversation,
} from "../utils/conversationDom.js";

const mockRefs = vi.hoisted(() => ({
    registeredHandlers: null,
    storageListener: null,
    replySettledListener: null,
    isReplyStreamingValue: false,
    pruneOldSectionsBase: vi.fn((historyKeptExchanges, options = {}) => {
        const allSections = Array.from(
            document.querySelectorAll('section[data-testid^="conversation-turn-"]')
        );
        const visibleSections = allSections.filter(
            (section) => !section.hasAttribute("data-thread-optimizer-unpruneable")
        );
        const sectionsToRemove = visibleSections.slice(
            0,
            Math.max(0, visibleSections.length - 2)
        );

        for (const section of sectionsToRemove) {
            section.remove();
        }

        return {
            historyKeptExchanges,
            options,
            removedSections: sectionsToRemove,
        };
    }),
    restoreAllSectionsBase: vi.fn(() => []),
    runInitialPruneBase: vi.fn(() => {}),
    enforceSoftPrunedLimit: vi.fn(() => {}),
    attachObserverToContainerBase: vi.fn(() => {}),
    ensureObserverAttachedBase: vi.fn(() => true),
    waitForContainerAndInitialPruneBase: vi.fn(() => {}),
    createObserverDeps: vi.fn(({ scheduleAutoPrune, getDidInitialPrune }) => ({
        scheduleAutoPrune,
        getDidInitialPrune,
    })),
}));

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        storage: {
            onChanged: {
                addListener: vi.fn((listener) => {
                    mockRefs.storageListener = listener;
                }),
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
        enableLargeCodeBlockOptimization: false,
        enableDebugLogging: false,
        largeCodeBlockMinChars: 1,
    })),
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: vi.fn((handlers) => {
        mockRefs.registeredHandlers = handlers;
    }),
}));

vi.mock("../../src/content/pruning/prune.js", () => ({
    pruneOldSections: mockRefs.pruneOldSectionsBase,
    restoreAllSections: mockRefs.restoreAllSectionsBase,
    runInitialPrune: mockRefs.runInitialPruneBase,
    enforceSoftPrunedLimit: mockRefs.enforceSoftPrunedLimit,
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
    installReplyTimingListeners: vi.fn(({ onReplySettled } = {}) => {
        mockRefs.replySettledListener = onReplySettled || null;
    }),
    ensureReplyCompletionPoll: vi.fn(),
    isReplyStreaming: vi.fn(() => mockRefs.isReplyStreamingValue),
}));

describe("cssVisibilityWindow integration", () => {
    let originalRAF;
    let originalCAF;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        document.body.innerHTML = "";
        document.head.innerHTML = "";

        mockRefs.registeredHandlers = null;
        mockRefs.storageListener = null;
        mockRefs.replySettledListener = null;
        mockRefs.isReplyStreamingValue = false;
        mockRefs.pruneOldSectionsBase.mockClear();
        mockRefs.restoreAllSectionsBase.mockClear();
        mockRefs.runInitialPruneBase.mockClear();
        mockRefs.enforceSoftPrunedLimit.mockClear();
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

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();

        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;

        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("startup initialization applies CSS visibility markers immediately", async () => {
        vi.useRealTimers();

        try {
            const { sections } = buildConversation();

            const stateModule = await import("../../src/content/core/state.js");
            await import("../../src/content/core/index.js");

            await new Promise((resolve) => setTimeout(resolve, 0));
            await Promise.resolve();

            const { OUT_OF_WINDOW_ATTR } = stateModule;

            expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
            expect(sections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
            expect(sections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
            expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
            expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
            expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        } finally {
            vi.useFakeTimers();
        }
    });

    it("marks the same old sections immediately that the delayed prune eventually targets", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;

        mockRefs.registeredHandlers.scheduleAutoPrune();

        const cssHidden = sections.filter((section) =>
            section.hasAttribute(OUT_OF_WINDOW_ATTR)
        );

        expect(cssHidden).toEqual(sections.slice(0, 4));

        vi.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(1);
    });

    it("storage toggle off clears all out-of-window markers", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        expect(sections[0].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(true);

        mockRefs.storageListener(
            {
                enablePruning: {
                    newValue: false,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        for (const section of sections) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }
    });

    it("storage toggle back on reapplies correct visibility markers", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        mockRefs.storageListener(
            {
                enablePruning: {
                    newValue: false,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        mockRefs.storageListener(
            {
                enablePruning: {
                    newValue: true,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not schedule CSS visibility updates while DOM mutation guard is active", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;
        state.isApplyingDomChanges = true;

        for (const section of sections) {
            section.removeAttribute(OUT_OF_WINDOW_ATTR);
        }

        mockRefs.registeredHandlers.scheduleAutoPrune();

        for (const section of sections) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }

        expect(mockRefs.pruneOldSectionsBase).not.toHaveBeenCalled();
    });

    it("duplicate auto-prune scheduling does not thrash CSS markers", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;

        mockRefs.registeredHandlers.scheduleAutoPrune();

        const firstSnapshot = sections.map((section) =>
            section.getAttribute(OUT_OF_WINDOW_ATTR)
        );

        expect(state.isAutoPruneScheduled).toBe(true);

        mockRefs.registeredHandlers.scheduleAutoPrune();

        const secondSnapshot = sections.map((section) =>
            section.getAttribute(OUT_OF_WINDOW_ATTR)
        );

        expect(secondSnapshot).toEqual(firstSnapshot);
        expect(state.isAutoPruneScheduled).toBe(true);

        vi.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(mockRefs.pruneOldSectionsBase.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it("restoreAllSections keeps a protected section visible after resync", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { OUT_OF_WINDOW_ATTR, UNPRUNEABLE_ATTR } = stateModule;

        sections[1].setAttribute(UNPRUNEABLE_ATTR, "true");
        sections[4].setAttribute(OUT_OF_WINDOW_ATTR, "true");
        sections[5].setAttribute(OUT_OF_WINDOW_ATTR, "true");

        mockRefs.registeredHandlers.restoreAllSections();
        await flushAsyncWork();

        expect(mockRefs.restoreAllSectionsBase).toHaveBeenCalledTimes(1);
        expect(sections[1].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("prune-now message path triggers immediate CSS hide and real prune", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        const sendResponse = vi.fn();
        mockRefs.registeredHandlers.pruneOldSections(10, { showPlaceholder: true });
        await flushAsyncWork();

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalled();
        expect(typeof mockRefs.registeredHandlers.pruneOldSections).toBe("function");
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);

        sendResponse({ ok: true });
        expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    });

    it("settings-updated message path can disable and re-enable CSS visibility markers", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        const messagesModule = await import("../../src/content/core/messages.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");

        const runtimeListener = messagesModule.registerRuntimeMessageHandlers.mock.calls[0]?.[0];
        expect(runtimeListener).toBeDefined();

        state.settings.enablePruning = true;
        state.settings.autoPrune = true;

        mockRefs.storageListener(
            {
                enablePruning: {
                    newValue: false,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        for (const section of sections) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }

        mockRefs.storageListener(
            {
                enablePruning: {
                    newValue: true,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
    });

    it("kept sections do not retain stale out-of-window markers after the delayed prune cycle", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;

        mockRefs.registeredHandlers.scheduleAutoPrune();

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");

        vi.advanceTimersByTime(300);
        await flushAsyncWork();

        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not hide the newest active assistant section while reply streaming is active", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        mockRefs.isReplyStreamingValue = true;
        mockRefs.replySettledListener?.();
        await flushAsyncWork();

        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("defers css visibility resync during active reply and flushes it on settle", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushAsyncWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);

        state.didInitialPrune = true;
        mockRefs.isReplyStreamingValue = true;

        for (const section of sections) {
            section.removeAttribute(OUT_OF_WINDOW_ATTR);
        }

        mockRefs.storageListener(
            {
                historyKeptExchanges: {
                    newValue: 2,
                },
            },
            "sync"
        );
        await flushAsyncWork();

        for (const section of sections) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }

        mockRefs.isReplyStreamingValue = false;
        mockRefs.replySettledListener();
        await flushAsyncWork();

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });
});