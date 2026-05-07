import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    configureDetachStore,
    storeDetachedCodeBlock,
    restoreDetachedCodeBlockEntry,
    restoreAllDetachedCodeBlocks,
    clearCollapsedCodeBlock,
    revealCollapsedCodeBlockFromPlaceholder,
    selfHealDetachedCodeBlockEntry,
    cleanupDetachedCodeBlocksForSection,
} from "../../src/content/offscreen/codeBlockDetachStore.js";
import {
    createCodeBlockPlaceholder,
    ensurePlaceholderForPre,
    getPlaceholderIdForPre,
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
        expect(assistant2.contains(placeholder)).toBe(false);
        expect(placeholder.isConnected).toBe(false);
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
        expect(assistant2.contains(placeholder)).toBe(false);
        expect(placeholder.isConnected).toBe(false);
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
        expect(assistant2.contains(placeholder)).toBe(false);
        expect(placeholder.isConnected).toBe(false);
        expect(pre.dataset.threadOptimizerCodeExpanded).toBe("true");
        expect(scheduleRefreshMock).toHaveBeenCalledTimes(1);
    });

    it("cleans up a corrupted detached entry instead of leaving an empty placeholder area", () => {
        const { assistant2 } = buildConversation();

        const pre = makePre("const value = 1;");
        assistant2.appendChild(pre);

        const placeholder = ensurePlaceholderForPre(pre);
        const id = storeDetachedCodeBlock(pre, placeholder);

        pre.remove();

        state.detachedCodeBlocks.set(id, {
            id,
            pre: null,
            placeholder,
            originalParent: assistant2,
            originalNextSibling: null,
        });

        expect(() => {
            revealCollapsedCodeBlockFromPlaceholder(placeholder);
        }).not.toThrow();

        expect(assistant2.contains(placeholder)).toBe(false);
        expect(placeholder.isConnected).toBe(false);
        expect(state.detachedCodeBlocks.has(id)).toBe(false);
        expect(scheduleRefreshMock).toHaveBeenCalledTimes(1);
    });

    it("clears the pre placeholder id when restoring and removing the placeholder", () => {
        const wrapper = document.createElement("div");
        const pre = document.createElement("pre");
        pre.textContent = "const a = 1;";

        const placeholder = createCodeBlockPlaceholder();

        wrapper.appendChild(placeholder);
        wrapper.appendChild(pre);
        document.body.appendChild(wrapper);

        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();

        expect(getPlaceholderIdForPre(pre)).not.toBe(null);

        restoreDetachedCodeBlockEntry(state.detachedCodeBlocks.values().next().value, {
            removePlaceholder: true,
            preserveExpanded: true,
        });

        expect(getPlaceholderIdForPre(pre)).toBe(null);
    });

    it("self-heals a detached code block when its placeholder is removed", () => {
        document.body.innerHTML = `
            <section data-turn="assistant">
                <div class="markdown"></div>
            </section>
        `;

        const markdown = document.querySelector(".markdown");
        const pre = document.createElement("pre");
        pre.textContent = "const a = 1;";

        const placeholder = createCodeBlockPlaceholder();

        markdown.appendChild(placeholder);
        markdown.appendChild(pre);

        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();
        placeholder.remove();

        const entry = state.detachedCodeBlocks.values().next().value;

        const healed = selfHealDetachedCodeBlockEntry(entry);

        expect(healed).toBe(pre);
        expect(markdown.querySelector("pre")).toBe(pre);
        expect(getPlaceholderIdForPre(pre)).toBe(null);
        expect(state.detachedCodeBlocks.size).toBe(0);
    });

    it("self-heals a detached code block before its original next sibling when possible", () => {
        document.body.innerHTML = `
            <section data-turn="assistant">
                <div class="markdown"></div>
            </section>
        `;

        const markdown = document.querySelector(".markdown");

        const pre = document.createElement("pre");
        pre.textContent = "const a = 1;";

        const next = document.createElement("p");
        next.textContent = "after code";

        const placeholder = createCodeBlockPlaceholder();

        markdown.appendChild(placeholder);
        markdown.appendChild(pre);
        markdown.appendChild(next);

        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();
        placeholder.remove();

        const entry = state.detachedCodeBlocks.values().next().value;

        selfHealDetachedCodeBlockEntry(entry);

        expect(pre.nextSibling).toBe(next);
        expect(markdown.contains(pre)).toBe(true);
    });

    it("does not self-heal into another assistant section when the original parent is gone", () => {
        document.body.innerHTML = `
            <section data-turn="assistant">
                <div class="markdown" id="old-markdown"></div>
            </section>
            <section data-turn="assistant">
                <div class="markdown" id="new-markdown"></div>
            </section>
        `;

        const oldMarkdown = document.querySelector("#old-markdown");
        const newMarkdown = document.querySelector("#new-markdown");

        const pre = document.createElement("pre");
        pre.textContent = "const old = true;";

        const placeholder = createCodeBlockPlaceholder();

        oldMarkdown.appendChild(placeholder);
        oldMarkdown.appendChild(pre);

        storeDetachedCodeBlock(pre, placeholder);
        pre.remove();

        oldMarkdown.remove();
        placeholder.remove();

        const entry = state.detachedCodeBlocks.values().next().value;
        const healed = selfHealDetachedCodeBlockEntry(entry);

        expect(healed).toBe(null);
        expect(newMarkdown.querySelector("pre")).toBe(null);
        expect(state.detachedCodeBlocks.size).toBe(0);
        expect(getPlaceholderIdForPre(pre)).toBe(null);
    });

    it("cleans detached code block entries that belong to a hard-evicted section", () => {
        const { assistant1, assistant2 } = buildConversation();

        const oldMarkdown = document.createElement("div");
        const oldPre = makePre("const old = true;");
        const oldPlaceholder = ensurePlaceholderForPre(oldPre);

        oldMarkdown.appendChild(oldPlaceholder);
        oldMarkdown.appendChild(oldPre);
        assistant1.appendChild(oldMarkdown);

        const newPre = makePre("const new = true;");
        const newPlaceholder = ensurePlaceholderForPre(newPre);

        assistant2.appendChild(newPlaceholder);
        assistant2.appendChild(newPre);

        const oldId = storeDetachedCodeBlock(oldPre, oldPlaceholder);
        const newId = storeDetachedCodeBlock(newPre, newPlaceholder);

        oldPre.remove();
        newPre.remove();

        expect(state.detachedCodeBlocks.size).toBe(2);

        const cleaned = cleanupDetachedCodeBlocksForSection(assistant1);

        expect(cleaned).toBe(1);
        expect(state.detachedCodeBlocks.has(oldId)).toBe(false);
        expect(state.detachedCodeBlocks.has(newId)).toBe(true);
        expect(getPlaceholderIdForPre(oldPre)).toBe(null);
    });
});