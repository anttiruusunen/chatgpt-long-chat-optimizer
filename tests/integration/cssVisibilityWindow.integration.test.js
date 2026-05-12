import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushAsyncWork } from "../utils/async.js";
import { buildConversation } from "../utils/conversationDom.js";

async function flushScheduledUiWork() {
    await flushAsyncWork();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flushAsyncWork();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await flushAsyncWork();
}

function getCurrentConversationSections() {
    return Array.from(
        document.querySelectorAll('section[data-testid^="conversation-turn-"]')
    );
}

const mockRefs = vi.hoisted(() => ({
    registeredHandlers: null,
    storageListener: null,
    replySettledListener: null,
    isReplyStreamingValue: false,

    pruneOldSectionsBase: vi.fn((historyKeptExchanges, options = {}) => {
        const sections = Array.from(
            document.querySelectorAll('section[data-testid^="conversation-turn-"]')
        );

        const keepCount = 2;
        const sectionsToRemove = sections.slice(
            0,
            Math.max(0, sections.length - keepCount)
        );

        for (const section of sectionsToRemove) {
            section.remove();
        }

        return {
            visibleSectionsChanged: sectionsToRemove.length > 0,
            placeholderChanged: false,
            historyKeptExchanges,
            options,
            removedSections: sectionsToRemove,
        };
    }),

    runInitialPruneBase: vi.fn(() => {}),
    attachObserverToContainerBase: vi.fn(() => {}),
    ensureObserverAttachedBase: vi.fn(() => true),
    waitForContainerAndInitialPruneBase: vi.fn(() => {}),
    createObserverDeps: vi.fn((deps) => deps),
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
        enableOffscreenOptimization: true,
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
    pruneOldSections: mockRefs.pruneOldSectionsBase,
    runInitialPrune: mockRefs.runInitialPruneBase,
}));

vi.mock("../../src/content/pruning/pruneUi.js", () => ({
    hideContainer: vi.fn((container) => {
        if (container) container.style.visibility = "hidden";
    }),
    revealContainer: vi.fn((container) => {
        if (container) container.style.visibility = "";
    }),
    installStartupPruneMask: vi.fn(),
    removeStartupPruneMask: vi.fn(),
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => {
    function clearOutOfWindowMarkers() {
        for (const section of document.querySelectorAll(
            'section[data-testid^="conversation-turn-"]'
        )) {
            section.removeAttribute("data-thread-optimizer-out-of-window");
        }
    }

    return {
        ensureSectionCssOffscreenMode: vi.fn(),
        handleReplyStreamingStarted: vi.fn(),
        scheduleOffscreenRefresh: vi.fn(),
        setOffscreenOptimizationEnabled: vi.fn((enabled) => {
            if (!enabled) {
                clearOutOfWindowMarkers();
            }
        }),
    };
});

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

        delete window.__threadOptimizerState;

        document.body.innerHTML = "";
        document.head.innerHTML = "";

        mockRefs.registeredHandlers = null;
        mockRefs.storageListener = null;
        mockRefs.replySettledListener = null;
        mockRefs.isReplyStreamingValue = false;

        mockRefs.pruneOldSectionsBase.mockClear();
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

    it("marks the same old sections immediately that delayed auto-prune eventually removes", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;

        mockRefs.registeredHandlers.scheduleAutoPrune();

        const cssHidden = sections.filter((section) =>
            section.hasAttribute(OUT_OF_WINDOW_ATTR)
        );

        expect(cssHidden).toEqual(sections.slice(0, 4));

        vi.advanceTimersByTime(300);
        await flushScheduledUiWork();

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalledTimes(1);
    });

    it("offscreen optimization toggle off clears all out-of-window markers", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        expect(sections[0].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(true);

        mockRefs.storageListener(
            {
                enableOffscreenOptimization: {
                    newValue: false,
                },
            },
            "sync"
        );

        await flushScheduledUiWork();

        for (const section of sections) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }
    });

    it("offscreen optimization toggle back on reapplies correct visibility markers", async () => {
        buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        mockRefs.storageListener(
            {
                enableOffscreenOptimization: {
                    newValue: false,
                },
            },
            "sync"
        );

        await flushScheduledUiWork();

        for (const section of getCurrentConversationSections()) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }

        mockRefs.storageListener(
            {
                enableOffscreenOptimization: {
                    newValue: true,
                },
            },
            "sync"
        );

        await flushScheduledUiWork();

        const currentSections = getCurrentConversationSections();

        expect(currentSections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(currentSections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(currentSections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(currentSections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(currentSections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(currentSections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not schedule auto-prune while DOM mutation guard is active", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

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
        await flushScheduledUiWork();

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
        await flushScheduledUiWork();

        expect(mockRefs.pruneOldSectionsBase.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it("prune-now path triggers immediate CSS hide and real prune", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        mockRefs.registeredHandlers.pruneOldSections(10);
        await flushScheduledUiWork();

        expect(mockRefs.pruneOldSectionsBase).toHaveBeenCalled();
        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("kept sections do not retain stale out-of-window markers after delayed prune", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        state.didInitialPrune = true;

        mockRefs.registeredHandlers.scheduleAutoPrune();

        expect(sections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(sections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");

        vi.advanceTimersByTime(300);
        await flushScheduledUiWork();

        expect(sections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not hide the newest active assistant section while reply streaming is active", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { OUT_OF_WINDOW_ATTR } = stateModule;

        mockRefs.isReplyStreamingValue = true;
        mockRefs.replySettledListener?.();

        await flushScheduledUiWork();

        expect(sections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("defers css visibility resync during active reply and reapplies after settle", async () => {
        const { sections } = buildConversation();

        const stateModule = await import("../../src/content/core/state.js");
        const maintenanceModule = await import(
            "../../src/content/core/conversationMaintenance.js"
        );

        await import("../../src/content/core/index.js");
        await flushScheduledUiWork();

        const { state, OUT_OF_WINDOW_ATTR } = stateModule;
        const {
            scheduleConversationChromeSync,
        } = maintenanceModule;

        state.didInitialPrune = true;
        mockRefs.isReplyStreamingValue = true;

        for (const section of sections) {
            section.removeAttribute(OUT_OF_WINDOW_ATTR);
        }

        scheduleConversationChromeSync({
            reason: "test-streaming-css-deferral",
            includeStreaming: true,
        });

        await flushScheduledUiWork();

        for (const section of getCurrentConversationSections()) {
            expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        }

        mockRefs.isReplyStreamingValue = false;
        mockRefs.replySettledListener();

        await flushScheduledUiWork();

        const settledSections = getCurrentConversationSections();

        expect(settledSections[0].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(settledSections[1].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(settledSections[2].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(settledSections[3].getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(settledSections[4].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(settledSections[5].hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });
});