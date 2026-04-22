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
        enableLargeCodeBlockOptimization: true,
        enableStreamingSectionHiding: true,
        enableDebugLogging: false,
        largeCodeBlockMinChars: 1,
    })),
}));

vi.mock("../../src/content/core/messages.js", () => ({
    registerRuntimeMessageHandlers: vi.fn(),
}));

vi.mock("../../src/content/offscreen/codeBlockObservers.js", async () => {
    const actual = await vi.importActual(
        "../../src/content/offscreen/codeBlockObservers.js"
    );

    return {
        ...actual,
        ensureLiveCodeBlockMutationObserver: vi.fn(),
        disconnectCodeBlockMutationObserver: vi.fn(),
        disconnectCodeBlockIntersectionObserver: vi.fn(),
        isStreamingLatestAssistantSection: vi.fn(() => true),
    };
});

function buildConversation() {
    const root = document.createElement("div");
    const scrollRoot = document.createElement("div");
    const conversation = document.createElement("div");

    root.appendChild(scrollRoot);
    scrollRoot.appendChild(conversation);
    document.body.appendChild(root);

    const olderAssistant = document.createElement("section");
    olderAssistant.setAttribute("data-testid", "conversation-turn-1");
    olderAssistant.setAttribute("data-turn", "assistant");
    olderAssistant.textContent = "Older assistant";

    const latestAssistant = document.createElement("section");
    latestAssistant.setAttribute("data-testid", "conversation-turn-2");
    latestAssistant.setAttribute("data-turn", "assistant");
    latestAssistant.setAttribute("data-scroll-anchor", "true");

    const markdown = document.createElement("div");
    markdown.className = "markdown";
    markdown.textContent = "Latest assistant markdown";

    latestAssistant.appendChild(markdown);

    conversation.appendChild(olderAssistant);
    conversation.appendChild(latestAssistant);

    return { latestAssistant, markdown };
}

function addComposer() {
    const composer = document.createElement("div");

    const textarea = document.createElement("textarea");
    textarea.id = "prompt-textarea";

    composer.appendChild(textarea);
    document.body.appendChild(composer);

    return { textarea };
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("reply start streaming hide integration", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();

        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("hides the newest assistant markdown immediately when a reply starts", async () => {
        const { latestAssistant, markdown } = buildConversation();
        const { textarea } = addComposer();

        const stateModule = await import("../../src/content/core/state.js");
        const { state, STREAMING_SECTION_HIDDEN_ATTR } = stateModule;

        state.replyTiming = {
            pending: false,
            startedAt: 0,
            completedAt: 0,
            lastDurationMs: 0,
            trigger: null,
        };
        state.replyTimingListenersInstalled = false;
        state.replyTimingCompletePollTimer = null;

        await import("../../src/content/core/index.js");
        await flush();

        textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
            })
        );

        expect(state.replyTiming.pending).toBe(true);

        vi.runOnlyPendingTimers();
        await flush();

        expect(
            latestAssistant.hasAttribute(STREAMING_SECTION_HIDDEN_ATTR)
        ).toBe(true);
        expect(
            markdown.getAttribute("data-thread-optimizer-stream-markdown-hidden")
        ).toBe("true");
    });
});