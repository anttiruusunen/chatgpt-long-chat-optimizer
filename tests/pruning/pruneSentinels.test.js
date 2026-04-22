import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    ensureTopRestoreSentinelState,
    ensureBottomPruneSentinelState,
    hasProtectedVisibleSections,
    getProtectedVisibleSections,
} from "../../src/content/pruning/pruneSentinels.js";

function makeSection({
    text = "",
    turn = null,
    testId = null,
    unpruneable = false,
} = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn) {
        section.setAttribute("data-turn", turn);
    }

    if (testId) {
        section.setAttribute("data-testid", testId);
    }

    if (unpruneable) {
        section.setAttribute("data-thread-optimizer-unpruneable", "true");
    }

    return section;
}

function buildConversation() {
    document.body.innerHTML = "";

    const wrap = document.createElement("div");
    const conversation = document.createElement("div");
    wrap.appendChild(conversation);
    document.body.appendChild(wrap);

    const sections = [
        makeSection({ text: "u1", turn: "user", testId: "conversation-turn-1" }),
        makeSection({ text: "a1", turn: "assistant", testId: "conversation-turn-2" }),
        makeSection({ text: "u2", turn: "user", testId: "conversation-turn-3" }),
        makeSection({ text: "a2", turn: "assistant", testId: "conversation-turn-4" }),
    ];

    for (const section of sections) {
        conversation.appendChild(section);
    }

    return { conversation, sections };
}

beforeEach(() => {
    document.body.innerHTML = "";
    state.topRestoreSentinel = null;
    state.bottomPruneSentinel = null;
    state.softPrunedSections = [];
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("pruneSentinels", () => {
    it("creates a top sentinel before the first visible section when soft-pruned content exists", () => {
        const { conversation, sections } = buildConversation();
        state.softPrunedSections = [document.createElement("section")];

        const changed = ensureTopRestoreSentinelState(sections[0]);

        expect(changed).toBe(true);
        expect(state.topRestoreSentinel).not.toBeNull();
        expect(conversation.firstElementChild).toBe(state.topRestoreSentinel);
        expect(state.topRestoreSentinel.nextElementSibling).toBe(sections[0]);
    });

    it("creates a bottom sentinel after the last visible section when protected sections exist", () => {
        const { conversation, sections } = buildConversation();
        sections[0].setAttribute("data-thread-optimizer-unpruneable", "true");

        const changed = ensureBottomPruneSentinelState(sections[3]);

        expect(changed).toBe(true);
        expect(state.bottomPruneSentinel).not.toBeNull();
        expect(conversation.lastElementChild).toBe(state.bottomPruneSentinel);
        expect(state.bottomPruneSentinel.previousElementSibling).toBe(sections[3]);
    });

    it("detects protected visible sections", () => {
        const { sections } = buildConversation();
        sections[1].setAttribute("data-thread-optimizer-unpruneable", "true");
        sections[2].setAttribute("data-thread-optimizer-unpruneable", "true");

        expect(hasProtectedVisibleSections()).toBe(true);
        expect(getProtectedVisibleSections()).toEqual([sections[1], sections[2]]);
    });

    it("removes the top sentinel when there is nothing soft-pruned", () => {
        const { sections } = buildConversation();
        state.softPrunedSections = [document.createElement("section")];
        ensureTopRestoreSentinelState(sections[0]);

        state.softPrunedSections = [];
        const changed = ensureTopRestoreSentinelState(sections[0]);

        expect(changed).toBe(true);
        expect(state.topRestoreSentinel).toBeNull();
    });

    it("removes the bottom sentinel when there are no protected sections", () => {
        const { sections } = buildConversation();
        sections[0].setAttribute("data-thread-optimizer-unpruneable", "true");
        ensureBottomPruneSentinelState(sections[3]);

        sections[0].removeAttribute("data-thread-optimizer-unpruneable");
        const changed = ensureBottomPruneSentinelState(sections[3]);

        expect(changed).toBe(true);
        expect(state.bottomPruneSentinel).toBeNull();
    });
});