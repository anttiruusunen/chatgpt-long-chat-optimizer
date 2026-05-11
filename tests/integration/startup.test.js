import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
        historyKeptExchanges: 2,
        autoPrune: true,
        enablePruning: true,
        enableOffscreenOptimization: true,
        enableDebugLogging: false,
    })),
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: vi.fn(),
}));

vi.mock("../../src/content/streaming/replyTiming.js", async () => {
    const actual = await vi.importActual(
        "../../src/content/streaming/replyTiming.js"
    );

    return {
        ...actual,
        installReplyTimingListeners: vi.fn(),
        ensureReplyCompletionPoll: vi.fn(),
        isReplyStreaming: vi.fn(() => false),
    };
});

vi.mock("../../src/content/offscreen/codeBlockObservers.js", async () => {
    const actual = await vi.importActual(
        "../../src/content/offscreen/codeBlockObservers.js"
    );

    return {
        ...actual,
        ensureLiveCodeBlockMutationObserver: vi.fn(),
        disconnectCodeBlockMutationObserver: vi.fn(),
        disconnectCodeBlockIntersectionObserver: vi.fn(),
        isStreamingLatestAssistantSection: vi.fn(() => false),
    };
});

const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;
const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalResizeObserver = globalThis.ResizeObserver;
const originalMutationObserver = globalThis.MutationObserver;

class FakeIntersectionObserver {
    constructor(callback) {
        this.callback = callback;
        this.observed = new Set();
    }

    observe(target) {
        this.observed.add(target);
    }

    unobserve(target) {
        this.observed.delete(target);
    }

    disconnect() {
        this.observed.clear();
    }
}

class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
    }

    observe() {}
    disconnect() {}
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    await Promise.resolve();
}

function buildConversation({
    exchangeCount = 6,
    includeAnchor = true,
    latestAssistantFinished = true,
} = {}) {
    document.body.innerHTML = "";

    const root = document.createElement("main");
    const scrollRoot = document.createElement("div");
    const conversation = document.createElement("div");

    scrollRoot.id = "scroll-root";
    conversation.id = "conversation";

    root.appendChild(scrollRoot);
    scrollRoot.appendChild(conversation);
    document.body.appendChild(root);

    for (let i = 0; i < exchangeCount; i += 1) {
        const user = document.createElement("section");
        user.setAttribute("data-testid", `conversation-turn-${i * 2 + 1}`);
        user.setAttribute("data-turn", "user");
        user.textContent = `User ${i + 1}`;

        const assistant = document.createElement("section");
        assistant.setAttribute("data-testid", `conversation-turn-${i * 2 + 2}`);
        assistant.setAttribute("data-turn", "assistant");

        if (includeAnchor && i === exchangeCount - 1) {
            assistant.setAttribute("data-scroll-anchor", "true");
        }

        const body = document.createElement("div");
        body.className = "assistant-body";

        const markdown = document.createElement("div");
        markdown.className = "markdown";
        markdown.textContent = `Assistant ${i + 1}`;
        body.appendChild(markdown);

        assistant.appendChild(body);

        if (latestAssistantFinished || i !== exchangeCount - 1) {
            const actions = document.createElement("div");
            actions.setAttribute("aria-label", "Response actions");
            actions.textContent = "Actions";
            assistant.appendChild(actions);
        }

        conversation.appendChild(user);
        conversation.appendChild(assistant);
    }

    return conversation;
}

describe("startup integration", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        document.body.innerHTML = "";
        document.head.innerHTML = "";

        globalThis.requestAnimationFrame = (cb) => {
            cb(performance.now());
            return 1;
        };
        globalThis.cancelAnimationFrame = () => {};
        globalThis.IntersectionObserver = FakeIntersectionObserver;
        globalThis.ResizeObserver = FakeResizeObserver;
        globalThis.MutationObserver = FakeMutationObserver;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();

        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;
        globalThis.IntersectionObserver = originalIntersectionObserver;
        globalThis.ResizeObserver = originalResizeObserver;
        globalThis.MutationObserver = originalMutationObserver;
    });

    it(
        "initializes, attaches, and marks older mounted sections out of window on startup",
        async () => {
            buildConversation({
                exchangeCount: 6,
                includeAnchor: true,
                latestAssistantFinished: true,
            });

            const stateModule = await import("../../src/content/core/state.js");
            await import("../../src/content/core/index.js");
            await flush();

            const { OUT_OF_WINDOW_ATTR } = stateModule;

            const sections = Array.from(
                document.querySelectorAll("section[data-turn]")
            );

            expect(sections).toHaveLength(12);

            const outOfWindowSections = sections.filter((section) =>
                section.hasAttribute(OUT_OF_WINDOW_ATTR)
            );

            expect(outOfWindowSections).toHaveLength(10);

            for (const section of sections.slice(0, 10)) {
                expect(section.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
            }

            for (const section of sections.slice(-2)) {
                expect(section.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
            }

            expect(
                document.querySelector('[data-thread-optimizer-placeholder="true"]')
            ).toBeNull();
        },
        15000
    );

    it("still initializes and finds conversation sections when no scroll anchor exists", async () => {
        buildConversation({
            exchangeCount: 4,
            includeAnchor: false,
            latestAssistantFinished: true,
        });

        const domModule = await import("../../src/content/core/dom.js");
        await import("../../src/content/core/index.js");
        await flush();

        const sections = domModule.getConversationSections();
        expect(sections.length).toBe(8);
    });

    it("can activate code block placeholder pipeline after startup on a real conversation DOM", async () => {
        buildConversation({
            exchangeCount: 4,
            includeAnchor: true,
            latestAssistantFinished: true,
        });

        const domModule = await import("../../src/content/core/dom.js");

        await import("../../src/content/core/index.js");
        await flush();

        const latestAssistant = domModule.getLatestAssistantSection();

        expect(latestAssistant).not.toBeNull();
    });

    it("reports the latest assistant as actively streaming when unfinished", async () => {
        buildConversation({
            exchangeCount: 4,
            includeAnchor: true,
            latestAssistantFinished: false,
        });

        const domModule = await import("../../src/content/core/dom.js");
        const assistantSignalsModule = await import(
            "../../src/content/streaming/assistantSignals.js"
        );

        await import("../../src/content/core/index.js");
        await flush();

        const latestAssistant = domModule.getLatestAssistantSection();

        expect(latestAssistant).not.toBeNull();
        expect(
            assistantSignalsModule.hasResponseActions(latestAssistant)
        ).toBe(false);
    });
});