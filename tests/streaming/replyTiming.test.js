import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: vi.fn(),
}));

import { state } from "../../src/content/core/state.js";
import {
    installReplyTimingListeners,
    ensureReplyCompletionPoll,
    isReplyStreaming,
} from "../../src/content/streaming/replyTiming.js";

const originalRAF = globalThis.requestAnimationFrame;
const originalCAF = globalThis.cancelAnimationFrame;

function makeConversationSection({
    turn = null,
    testId = null,
    text = "",
} = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn != null) {
        section.setAttribute("data-turn", turn);
    }

    if (testId != null) {
        section.setAttribute("data-testid", testId);
    }

    return section;
}

function buildConversationDom() {
    document.body.innerHTML = "";

    const page = document.createElement("div");
    const scrollWrap = document.createElement("div");
    const conversation = document.createElement("div");

    scrollWrap.style.overflowY = "auto";
    page.appendChild(scrollWrap);
    scrollWrap.appendChild(conversation);
    document.body.appendChild(page);

    const user1 = makeConversationSection({
        turn: "user",
        testId: "conversation-turn-1",
        text: "User 1",
    });

    const assistant1 = makeConversationSection({
        turn: "assistant",
        testId: "conversation-turn-2",
        text: "Assistant 1",
    });

    const user2 = makeConversationSection({
        turn: "user",
        testId: "conversation-turn-3",
        text: "User 2",
    });

    const assistant2 = makeConversationSection({
        turn: "assistant",
        testId: "conversation-turn-4",
        text: "Latest assistant",
    });

    conversation.appendChild(user1);
    conversation.appendChild(assistant1);
    conversation.appendChild(user2);
    conversation.appendChild(assistant2);

    return {
        page,
        scrollWrap,
        conversation,
        user1,
        assistant1,
        user2,
        assistant2,
    };
}

function addComposer() {
    const composer = document.createElement("div");

    const textarea = document.createElement("textarea");
    textarea.id = "prompt-textarea";

    const submitButton = document.createElement("button");
    submitButton.id = "composer-submit-button";
    submitButton.type = "button";
    submitButton.textContent = "Send";

    composer.appendChild(textarea);
    composer.appendChild(submitButton);
    document.body.appendChild(composer);

    return { composer, textarea, submitButton };
}

function addResponseActions(section) {
    const actions = document.createElement("div");
    actions.setAttribute("aria-label", "Response actions");
    section.appendChild(actions);
    return actions;
}

function resetReplyTimingState() {
    state.replyTiming = {
        pending: false,
        startedAt: 0,
        completedAt: 0,
        lastDurationMs: 0,
        trigger: null,
    };

    if (state.replyTimingCompletePollTimer) {
        clearInterval(state.replyTimingCompletePollTimer);
    }
    state.replyTimingCompletePollTimer = null;
    state.replyTimingListenersInstalled = false;
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    resetReplyTimingState();

    globalThis.requestAnimationFrame = (cb) => {
        cb(performance.now());
        return 1;
    };
    globalThis.cancelAnimationFrame = () => {};
});

afterEach(() => {
    document.body.innerHTML = "";
    resetReplyTimingState();
    vi.restoreAllMocks();
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
});

describe("replyTiming", () => {
    it("starts timing on Enter in the prompt textarea", () => {
        buildConversationDom();
        const { textarea } = addComposer();

        installReplyTimingListeners();

        const event = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
        });

        textarea.dispatchEvent(event);

        expect(isReplyStreaming()).toBe(true);
        expect(state.replyTiming.pending).toBe(true);
        expect(state.replyTiming.trigger).toBe("textarea-enter");
        expect(state.replyTiming.startedAt).toBeGreaterThan(0);
    });

    it("does not start timing on Shift+Enter", () => {
        buildConversationDom();
        const { textarea } = addComposer();

        installReplyTimingListeners();

        const event = new KeyboardEvent("keydown", {
            key: "Enter",
            shiftKey: true,
            bubbles: true,
        });

        textarea.dispatchEvent(event);

        expect(isReplyStreaming()).toBe(false);
        expect(state.replyTiming.pending).toBe(false);
        expect(state.replyTiming.startedAt).toBe(0);
    });

    it("starts timing on composer submit button click", () => {
        buildConversationDom();
        const { submitButton } = addComposer();

        installReplyTimingListeners();

        submitButton.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
            })
        );

        expect(isReplyStreaming()).toBe(true);
        expect(state.replyTiming.pending).toBe(true);
        expect(state.replyTiming.trigger).toBe("submit-button");
        expect(state.replyTiming.startedAt).toBeGreaterThan(0);
    });

    it("ignores duplicate starts while already pending", () => {
        buildConversationDom();
        const { textarea } = addComposer();

        installReplyTimingListeners();

        textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
            })
        );

        const firstStartedAt = state.replyTiming.startedAt;

        vi.advanceTimersByTime(50);

        textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
            })
        );

        expect(state.replyTiming.pending).toBe(true);
        expect(state.replyTiming.startedAt).toBe(firstStartedAt);
        expect(state.replyTiming.trigger).toBe("textarea-enter");
    });

    it("completes timing when response actions appear on the latest assistant section", async () => {
        const { assistant2 } = buildConversationDom();
        const { textarea } = addComposer();

        const onReplySettled = vi.fn();
        installReplyTimingListeners({ onReplySettled });

        textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
            })
        );

        expect(state.replyTiming.pending).toBe(true);

        ensureReplyCompletionPoll();

        vi.advanceTimersByTime(200);
        expect(state.replyTiming.pending).toBe(true);

        addResponseActions(assistant2);

        vi.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();

        expect(state.replyTiming.pending).toBe(false);
        expect(state.replyTiming.completedAt).toBeGreaterThan(0);
        expect(state.replyTiming.lastDurationMs).toBeGreaterThanOrEqual(0);
        expect(onReplySettled).toHaveBeenCalledTimes(1);
    });

    it("fires the settled callback only once", async () => {
        const { assistant2 } = buildConversationDom();
        const { submitButton } = addComposer();

        const onReplySettled = vi.fn();
        installReplyTimingListeners({ onReplySettled });

        submitButton.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
            })
        );

        expect(state.replyTiming.pending).toBe(true);

        ensureReplyCompletionPoll();
        addResponseActions(assistant2);

        vi.advanceTimersByTime(200);
        await Promise.resolve();
        await Promise.resolve();

        vi.advanceTimersByTime(400);
        await Promise.resolve();
        await Promise.resolve();

        expect(state.replyTiming.pending).toBe(false);
        expect(onReplySettled).toHaveBeenCalledTimes(1);
    });

    it("fires the started callback when timing begins", () => {
        buildConversationDom();
        const { textarea } = addComposer();

        const onReplyStarted = vi.fn();
        installReplyTimingListeners({ onReplyStarted });

        textarea.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
            })
        );

        expect(onReplyStarted).toHaveBeenCalledTimes(1);
    });
});