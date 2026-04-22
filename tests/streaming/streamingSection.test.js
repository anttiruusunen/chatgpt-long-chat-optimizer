import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    STREAM_HIDDEN_ATTR,
    STREAM_FORCE_VISIBLE_ATTR,
    STREAM_MARKDOWN_HIDDEN_ATTR,
    STREAM_MARKDOWN_MISSING_ATTR,
    getActiveStreamingSection,
    syncStreamingSectionState,
    setStreamingSectionHidingEnabled,
} from "../../src/content/streaming/streamingSection.js";

function makeSection({ turn = null, testId = null, text = "" } = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn) {
        section.setAttribute("data-turn", turn);
    }

    if (testId) {
        section.setAttribute("data-testid", testId);
    }

    return section;
}

function addMarkdown(section, text = "Assistant body") {
    const markdown = document.createElement("div");
    markdown.className = "markdown";
    markdown.textContent = text;
    section.appendChild(markdown);
    return markdown;
}

function addResponseActions(section) {
    const actions = document.createElement("div");
    actions.setAttribute("aria-label", "Response actions");
    section.appendChild(actions);
    return actions;
}

function buildConversation() {
    document.body.innerHTML = "";

    const conversation = document.createElement("div");
    document.body.appendChild(conversation);

    const user1 = makeSection({
        turn: "user",
        testId: "conversation-turn-1",
        text: "User 1",
    });
    const assistant1 = makeSection({
        turn: "assistant",
        testId: "conversation-turn-2",
        text: "Assistant 1",
    });
    const user2 = makeSection({
        turn: "user",
        testId: "conversation-turn-3",
        text: "User 2",
    });
    const assistant2 = makeSection({
        turn: "assistant",
        testId: "conversation-turn-4",
        text: "Assistant 2",
    });

    assistant2.setAttribute("data-scroll-anchor", "true");

    conversation.appendChild(user1);
    conversation.appendChild(assistant1);
    conversation.appendChild(user2);
    conversation.appendChild(assistant2);

    return {
        conversation,
        user1,
        assistant1,
        user2,
        assistant2,
    };
}

function getRevealControl() {
    return document.querySelector('[data-thread-optimizer-stream-reveal-control="true"]');
}

describe("streamingSection", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("returns the latest unfinished assistant section as active streaming", () => {
        const { assistant2 } = buildConversation();

        expect(getActiveStreamingSection()).toBe(assistant2);
    });

    it("returns null when there is no assistant section", () => {
        document.body.innerHTML = `<div><section data-turn="user">User only</section></div>`;

        expect(getActiveStreamingSection()).toBeNull();
    });

    it("returns null when the latest assistant has normal response actions", () => {
        const { assistant2 } = buildConversation();
        addResponseActions(assistant2);

        expect(getActiveStreamingSection()).toBeNull();
    });

    it("installs the streaming style tag when enabled", () => {
        buildConversation();

        setStreamingSectionHidingEnabled(true);

        const styleEl = document.getElementById("thread-optimizer-streaming-section-style");
        expect(styleEl).not.toBeNull();
        expect(styleEl?.textContent).toContain(STREAM_MARKDOWN_HIDDEN_ATTR);
    });

    it("marks only the active streaming section and hides its markdown subtree", () => {
        const { assistant1, assistant2 } = buildConversation();
        addMarkdown(assistant1, "Older");
        const markdown2 = addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);

        expect(assistant2.getAttribute(STREAM_HIDDEN_ATTR)).toBe("true");
        expect(markdown2.getAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe("true");
        expect(assistant1.hasAttribute(STREAM_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).not.toBeNull();
    });

    it("falls back to whole-section hiding state when markdown is missing", () => {
        const { assistant2 } = buildConversation();

        setStreamingSectionHidingEnabled(true);

        expect(assistant2.getAttribute(STREAM_HIDDEN_ATTR)).toBe("true");
        expect(assistant2.getAttribute(STREAM_MARKDOWN_MISSING_ATTR)).toBe("true");
        expect(getRevealControl()).not.toBeNull();
    });

    it("does not create duplicate reveal controls across repeated syncs", () => {
        const { assistant2 } = buildConversation();
        addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);
        syncStreamingSectionState();
        syncStreamingSectionState();

        expect(
            document.querySelectorAll('[data-thread-optimizer-stream-reveal-control="true"]').length
        ).toBe(1);
    });

    it("force-reveals the active streaming section when the reveal button is clicked", () => {
        const { assistant2 } = buildConversation();
        const markdown2 = addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);

        const button = document.querySelector('[data-thread-optimizer-stream-reveal-button="true"]');
        expect(button).not.toBeNull();

        button.click();

        expect(assistant2.getAttribute(STREAM_FORCE_VISIBLE_ATTR)).toBe("true");
        expect(markdown2.hasAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).toBeNull();
    });

    it("keeps force-visible state while the same section is still active streaming", () => {
        const { assistant2 } = buildConversation();
        const markdown2 = addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);

        const button = document.querySelector('[data-thread-optimizer-stream-reveal-button="true"]');
        button.click();

        syncStreamingSectionState();

        expect(assistant2.getAttribute(STREAM_FORCE_VISIBLE_ATTR)).toBe("true");
        expect(markdown2.hasAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).toBeNull();
    });

    it("removes streaming state when the latest assistant completes", () => {
        const { assistant2 } = buildConversation();
        const markdown2 = addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);
        addResponseActions(assistant2);

        syncStreamingSectionState();

        expect(assistant2.hasAttribute(STREAM_HIDDEN_ATTR)).toBe(false);
        expect(assistant2.hasAttribute(STREAM_FORCE_VISIBLE_ATTR)).toBe(false);
        expect(assistant2.hasAttribute(STREAM_MARKDOWN_MISSING_ATTR)).toBe(false);
        expect(markdown2.hasAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).toBeNull();
    });

    it("moves the reveal control to a new latest unfinished assistant section", () => {
        const { conversation, assistant2 } = buildConversation();
        addMarkdown(assistant2, "Assistant 2");

        setStreamingSectionHidingEnabled(true);

        const assistant3 = makeSection({
            turn: "assistant",
            testId: "conversation-turn-5",
            text: "Assistant 3",
        });
        assistant3.setAttribute("data-scroll-anchor", "true");
        addMarkdown(assistant3, "Assistant 3");
        conversation.appendChild(assistant3);

        syncStreamingSectionState();

        expect(assistant2.hasAttribute(STREAM_HIDDEN_ATTR)).toBe(false);
        expect(assistant3.getAttribute(STREAM_HIDDEN_ATTR)).toBe("true");
        expect(
            assistant3.querySelector(".markdown")?.getAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)
        ).toBe("true");
        expect(getRevealControl()).not.toBeNull();
    });

    it("clears reveal controls and state when hiding is disabled", () => {
        const { assistant2 } = buildConversation();
        const markdown2 = addMarkdown(assistant2, "Newest");

        setStreamingSectionHidingEnabled(true);
        setStreamingSectionHidingEnabled(false);

        expect(assistant2.hasAttribute(STREAM_HIDDEN_ATTR)).toBe(false);
        expect(assistant2.hasAttribute(STREAM_FORCE_VISIBLE_ATTR)).toBe(false);
        expect(markdown2.hasAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).toBeNull();
        expect(
            document.getElementById("thread-optimizer-streaming-section-style")
        ).toBeNull();
    });

    it("does not create a reveal control when the latest assistant is already complete", () => {
        const { assistant2 } = buildConversation();
        addMarkdown(assistant2, "Newest");
        addResponseActions(assistant2);

        setStreamingSectionHidingEnabled(true);

        expect(assistant2.hasAttribute(STREAM_HIDDEN_ATTR)).toBe(false);
        expect(getRevealControl()).toBeNull();
    });
});