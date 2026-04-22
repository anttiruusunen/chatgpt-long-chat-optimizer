import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state, PLACEHOLDER_ATTR } from "../../src/content/core/state.js";
import {
    getHiddenLabel,
    ensurePlaceholderState,
    removePlaceholder,
    hideContainer,
    revealContainer,
    installStartupPruneMask,
    removeStartupPruneMask,
} from "../../src/content/pruning/pruneUi.js";

function makeSection({
    text = "",
    turn = null,
    testId = null,
    anchor = false,
} = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn != null) {
        section.setAttribute("data-turn", turn);
    }

    if (testId != null) {
        section.setAttribute("data-testid", testId);
    }

    if (anchor) {
        section.setAttribute("data-scroll-anchor", "true");
    }

    return section;
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

    const sections = [
        makeSection({
            text: "user 1",
            turn: "user",
            testId: "conversation-turn-1",
        }),
        makeSection({
            text: "assistant 1",
            turn: "assistant",
            testId: "conversation-turn-2",
        }),
        makeSection({
            text: "user 2",
            turn: "user",
            testId: "conversation-turn-3",
        }),
        makeSection({
            text: "assistant 2",
            turn: "assistant",
            testId: "conversation-turn-4",
            anchor: true,
        }),
    ];

    for (const section of sections) {
        conversation.appendChild(section);
    }

    return {
        page,
        scrollWrap,
        conversation,
        sections,
    };
}

function getPlaceholder() {
    return document.querySelector(`[${PLACEHOLDER_ATTR}="true"]`);
}

function resetState() {
    state.placeholder = null;
    state.hiddenCount = 0;
    state.totalHiddenCount = 0;
}

describe("pruneUi", () => {
    beforeEach(() => {
        resetState();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    afterEach(() => {
        removeStartupPruneMask();
        resetState();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("formats the hidden label", () => {
        expect(getHiddenLabel(0)).toBe("0 older messages hidden");
        expect(getHiddenLabel(1)).toBe("1 older message hidden");
        expect(getHiddenLabel(3)).toBe("3 older messages hidden");
    });

    it("creates the placeholder before the first visible section", () => {
        const { conversation, sections } = buildConversation();
        state.hiddenCount = 3;

        const changed = ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        expect(changed).toBe(true);
        expect(placeholder).not.toBeNull();
        expect(state.placeholder).toBe(placeholder);
        expect(conversation.firstChild).toBe(placeholder);
        expect(placeholder?.nextElementSibling).toBe(sections[0]);
        expect(placeholder?.textContent).toContain("3 older messages hidden");
        expect(placeholder?.hidden).toBe(false);
    });

    it("is idempotent when the placeholder is already correct", () => {
        const { sections } = buildConversation();
        state.hiddenCount = 2;

        const changed1 = ensurePlaceholderState(sections[0]);
        const placeholder1 = getPlaceholder();

        const changed2 = ensurePlaceholderState(sections[0]);
        const placeholder2 = getPlaceholder();

        expect(changed1).toBe(true);
        expect(changed2).toBe(false);
        expect(placeholder2).toBe(placeholder1);
        expect(state.placeholder).toBe(placeholder1);
    });

    it("reuses the same placeholder node after hiding and showing it again", () => {
        const { sections } = buildConversation();
        state.hiddenCount = 2;

        ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        const removed = removePlaceholder();

        expect(removed).toBe(true);
        expect(state.placeholder).toBe(placeholder);
        expect(placeholder?.isConnected).toBe(true);
        expect(placeholder?.hidden).toBe(true);
        expect(placeholder?.getAttribute("data-thread-optimizer-placeholder-hidden")).toBe("true");

        const changed = ensurePlaceholderState(sections[0]);
        const placeholderAfter = getPlaceholder();

        expect(changed).toBe(true);
        expect(placeholderAfter).toBe(placeholder);
        expect(placeholderAfter?.hidden).toBe(false);
        expect(placeholderAfter?.getAttribute("data-thread-optimizer-placeholder-hidden")).toBeNull();
    });

    it("moves the same placeholder node when the first visible section changes", () => {
        const { conversation, sections } = buildConversation();
        state.hiddenCount = 2;

        ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        const changed = ensurePlaceholderState(sections[2]);
        const placeholderAfter = getPlaceholder();

        expect(changed).toBe(true);
        expect(placeholderAfter).toBe(placeholder);
        expect(placeholderAfter?.nextElementSibling).toBe(sections[2]);
        expect(conversation.children[2]).toBe(placeholderAfter);
    });

    it("updates the placeholder label in place without replacing the node", () => {
        const { sections } = buildConversation();
        state.hiddenCount = 2;

        ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        state.hiddenCount = 5;
        const changed = ensurePlaceholderState(sections[0]);
        const placeholderAfter = getPlaceholder();

        expect(changed).toBe(true);
        expect(placeholderAfter).toBe(placeholder);
        expect(placeholderAfter?.textContent).toContain("5 older messages hidden");
    });

    it("hides the placeholder instead of destroying it when there are no hidden sections", () => {
        const { sections } = buildConversation();
        state.hiddenCount = 2;

        ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        state.hiddenCount = 0;
        const changed = ensurePlaceholderState(sections[0]);

        expect(changed).toBe(true);
        expect(state.placeholder).toBe(placeholder);
        expect(placeholder?.isConnected).toBe(true);
        expect(placeholder?.hidden).toBe(true);
        expect(getPlaceholder()).toBe(placeholder);
    });

    it("can destroy the placeholder explicitly", () => {
        const { sections } = buildConversation();
        state.hiddenCount = 2;

        ensurePlaceholderState(sections[0]);
        const placeholder = getPlaceholder();

        const removed = removePlaceholder({ destroy: true });

        expect(removed).toBe(true);
        expect(placeholder?.isConnected).toBe(false);
        expect(state.placeholder).toBeNull();
    });

    it("hides and reveals the container", () => {
        const { conversation } = buildConversation();

        hideContainer(conversation);
        expect(conversation.style.visibility).toBe("hidden");

        revealContainer(conversation);
        expect(conversation.style.visibility).toBe("");
    });

    it("installs and removes the startup prune mask", () => {
        const { conversation } = buildConversation();

        installStartupPruneMask(conversation, 2);

        const styleEl = document.getElementById("thread-optimizer-startup-mask-style");
        expect(styleEl).not.toBeNull();
        expect(conversation.getAttribute("data-thread-optimizer-startup-mask")).toBe("true");
        expect(styleEl?.textContent).toContain(":nth-last-of-type(-n + 2)");

        removeStartupPruneMask();

        expect(document.getElementById("thread-optimizer-startup-mask-style")).toBeNull();
        expect(conversation.hasAttribute("data-thread-optimizer-startup-mask")).toBe(false);
    });
});