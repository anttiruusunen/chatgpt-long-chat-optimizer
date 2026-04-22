import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    configureDetachStore,
    storeDetachedCodeBlock,
    restoreDetachedCodeBlockEntry,
    restoreAllDetachedCodeBlocks,
    clearCollapsedCodeBlock,
    revealCollapsedCodeBlockFromPlaceholder,
} from "../../src/content/offscreen/codeBlockDetachStore.js";
import {
    ensurePlaceholderForPre,
    isPlaceholderHidden,
} from "../../src/content/offscreen/codeBlockPlaceholders.js";

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

function makePre(text) {
    const pre = document.createElement("pre");
    pre.textContent = text;
    return pre;
}

function buildConversation() {
    document.body.innerHTML = "";

    const page = document.createElement("div");
    const scrollWrap = document.createElement("div");
    const conversation = document.createElement("div");

    scrollWrap.style.overflowY = "auto";
    page.appendChild(scrollWrap);
    scrollWrap.appendChild(conversation);
    document.body.appendChild(page);

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

describe("codeBlockDetachStore", () => {
    let scheduleRefreshMock;

    beforeEach(() => {
        document.body.innerHTML = "";

        scheduleRefreshMock = vi.fn();
        configureDetachStore({
            scheduleRefresh: scheduleRefreshMock,
        });

        state.detachedCodeBlocks = new Map();
        state.nextDetachedCodeBlockId = 1;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("stores a detached code block entry keyed by placeholder id", () => {
        const { assistant2 } = buildConversation();
        const pre = makePre("const value = 1;");
        assistant2.appendChild(pre);

        const placeholder = ensurePlaceholderForPre(pre);
        const id = storeDetachedCodeBlock(pre, placeholder);

        expect(id).toBe("1");
        expect(state.detachedCodeBlocks.size).toBe(1);

        const entry = state.detachedCodeBlocks.get(id);
        expect(entry).toBeTruthy();
        expect(entry?.pre).toBe(pre);
        expect(entry?.placeholder).toBe(placeholder);
        expect(pre.dataset.threadOptimizerCodePlaceholderId).toBe(id);
    });

    it("restores a detached code block entry after its placeholder and hides the placeholder", () => {
        const { assistant2 } = buildConversation();
        const pre = makePre("const value = 1;");
        assistant2.appendChild(pre);

        const placeholder = ensurePlaceholderForPre(pre);
        const id = storeDetachedCodeBlock(pre, placeholder);

        pre.remove();

        const entry = state.detachedCodeBlocks.get(id);
        const restored = restoreDetachedCodeBlockEntry(entry, {
            removePlaceholder: true,
            preserveExpanded: true,
        });

        expect(restored).toBe(pre);
        expect(assistant2.contains(pre)).toBe(true);
        expect(assistant2.contains(placeholder)).toBe(true);
        expect(isPlaceholderHidden(placeholder)).toBe(true);
        expect(state.detachedCodeBlocks.size).toBe(0);
    });

    it("restores all detached code blocks", () => {
        const { assistant1, assistant2 } = buildConversation();

        const pre1 = makePre("const a = 1;");
        const pre2 = makePre("const b = 2;");

        assistant1.appendChild(pre1);
        assistant2.appendChild(pre2);

        const placeholder1 = ensurePlaceholderForPre(pre1);
        const placeholder2 = ensurePlaceholderForPre(pre2);

        storeDetachedCodeBlock(pre1, placeholder1);
        storeDetachedCodeBlock(pre2, placeholder2);

        pre1.remove();
        pre2.remove();

        restoreAllDetachedCodeBlocks({ preserveExpanded: true });

        expect(assistant1.contains(pre1)).toBe(true);
        expect(assistant2.contains(pre2)).toBe(true);
        expect(isPlaceholderHidden(placeholder1)).toBe(true);
        expect(isPlaceholderHidden(placeholder2)).toBe(true);
        expect(state.detachedCodeBlocks.size).toBe(0);
    });

    it("clears a collapsed code block using its detached entry", () => {
        const { assistant2 } = buildConversation();
        const pre = makePre("const value = 1;");
        assistant2.appendChild(pre);

        const placeholder = ensurePlaceholderForPre(pre);
        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();

        clearCollapsedCodeBlock(pre, { preserveExpanded: true });

        expect(assistant2.contains(pre)).toBe(true);
        expect(assistant2.contains(placeholder)).toBe(true);
        expect(isPlaceholderHidden(placeholder)).toBe(true);
        expect(state.detachedCodeBlocks.size).toBe(0);
    });

    it("reveals a collapsed code block from its placeholder and schedules refresh", () => {
        const { assistant2 } = buildConversation();
        const pre = makePre("const value = 1;");
        assistant2.appendChild(pre);

        const placeholder = ensurePlaceholderForPre(pre);
        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();

        revealCollapsedCodeBlockFromPlaceholder(placeholder);

        expect(assistant2.contains(pre)).toBe(true);
        expect(assistant2.contains(placeholder)).toBe(true);
        expect(isPlaceholderHidden(placeholder)).toBe(true);
        expect(pre.dataset.threadOptimizerCodeExpanded).toBe("true");
        expect(scheduleRefreshMock).toHaveBeenCalledTimes(1);
    });
});