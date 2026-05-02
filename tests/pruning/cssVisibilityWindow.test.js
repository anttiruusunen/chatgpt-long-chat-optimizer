import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    state,
    PRUNED_ATTR,
    UNPRUNEABLE_ATTR,
    OUT_OF_WINDOW_ATTR,
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../../src/content/core/state.js";
import {
    clearCssVisibilityWindow,
    getEligibleVisibleSections,
    getCssHiddenSections,
    getVisibleSectionsLimit,
    syncCssVisibilityWindow,
    resetCssVisibilityWindowForTests,
} from "../../src/content/pruning/cssVisibilityWindow.js";
import { resetConversationDomCacheForTests } from "../../src/content/core/dom.js";

function createConversationContainer() {
    const root = document.createElement("div");
    const wrapper = document.createElement("div");
    const container = document.createElement("div");

    root.appendChild(wrapper);
    wrapper.appendChild(container);
    document.body.appendChild(root);

    return container;
}

function appendConversationSection(container, label, turn = "user") {
    const section = document.createElement("section");
    section.setAttribute("data-testid", `conversation-turn-${label}`);
    section.setAttribute("data-turn", turn);
    section.textContent = label;
    container.appendChild(section);
    return section;
}

function appendNonConversationSection(container, attrName, label) {
    const section = document.createElement("section");
    section.setAttribute(attrName, "true");
    section.textContent = label;
    container.appendChild(section);
    return section;
}

describe("cssVisibilityWindow", () => {
    beforeEach(() => {
        resetCssVisibilityWindowForTests();
        document.body.innerHTML = "";
        document.head.innerHTML = "";

        state.featureFlags.pruning = true;
        state.settings.enablePruning = true;
        state.settings.historyKeptExchanges = 10;
    });

    it("uses a 1-exchange visible window", () => {
        expect(getVisibleSectionsLimit()).toBe(2);
    });

    it("filters out pruned and explicitly revealed sections from eligible visible sections", () => {
        const container = createConversationContainer();
        const a = appendConversationSection(container, "a");
        const b = appendConversationSection(container, "b");
        const c = appendConversationSection(container, "c");
        const d = appendConversationSection(container, "d");

        b.setAttribute(PRUNED_ATTR, "true");
        c.setAttribute(UNPRUNEABLE_ATTR, "true");

        const eligible = getEligibleVisibleSections([a, b, c, d]);

        expect(eligible).toEqual([a, d]);
    });

    it("returns only the older eligible sections outside the visible window", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");
        const s5 = appendConversationSection(container, "5");
        const s6 = appendConversationSection(container, "6");

        const hidden = getCssHiddenSections({
            sections: [s1, s2, s3, s4, s5, s6],
            visibleLimit: 2,
        });

        expect(hidden).toEqual([s1, s2, s3, s4]);
    });

    it("keeps explicitly revealed sections visible while still hiding older eligible sections", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");
        const s5 = appendConversationSection(container, "5");
        const s6 = appendConversationSection(container, "6");

        s2.setAttribute(UNPRUNEABLE_ATTR, "true");

        const hidden = getCssHiddenSections({
            sections: [s1, s2, s3, s4, s5, s6],
            visibleLimit: 2,
        });

        expect(hidden).toEqual([s1, s3, s4]);
        expect(hidden).not.toContain(s2);
        expect(hidden).not.toContain(s5);
        expect(hidden).not.toContain(s6);
    });

    it("ignores placeholder and sentinel sections because logical conversation sections filter them out", () => {
        const container = createConversationContainer();

        appendNonConversationSection(container, PLACEHOLDER_ATTR, "placeholder");
        appendNonConversationSection(container, TOP_RESTORE_SENTINEL_ATTR, "top-sentinel");

        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");

        appendNonConversationSection(container, BOTTOM_PRUNE_SENTINEL_ATTR, "bottom-sentinel");

        const hidden = syncCssVisibilityWindow();

        expect(hidden).toEqual([s1, s2]);
        expect(s1.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s2.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s3.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s4.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("clears stale out-of-window attributes before recomputing", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");

        s4.setAttribute(OUT_OF_WINDOW_ATTR, "true");

        syncCssVisibilityWindow();

        expect(s1.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s2.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s3.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s4.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("removes all out-of-window attributes when cleared", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");

        s1.setAttribute(OUT_OF_WINDOW_ATTR, "true");
        s2.setAttribute(OUT_OF_WINDOW_ATTR, "true");
        s3.setAttribute(OUT_OF_WINDOW_ATTR, "true");

        clearCssVisibilityWindow();

        expect(s1.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s2.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s3.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not apply out-of-window attributes when pruning is disabled", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");

        state.featureFlags.pruning = false;

        const hidden = syncCssVisibilityWindow();

        expect(hidden).toEqual([]);
        expect(s1.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s2.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s3.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s4.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
    });

    it("does not rewrite unchanged out-of-window attributes on repeated sync", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");

        syncCssVisibilityWindow();

        const setAttributeSpy = vi.spyOn(s1, "setAttribute");
        const removeAttributeSpy = vi.spyOn(s1, "removeAttribute");

        syncCssVisibilityWindow();

        expect(s1.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s2.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s3.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s4.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);

        expect(setAttributeSpy).not.toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR, "true");
        expect(removeAttributeSpy).not.toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR);
    });

    it("only marks newly hidden sections when the visible window advances", () => {
        const container = createConversationContainer();
        const s1 = appendConversationSection(container, "1");
        const s2 = appendConversationSection(container, "2");
        const s3 = appendConversationSection(container, "3");
        const s4 = appendConversationSection(container, "4");

        syncCssVisibilityWindow();

        const s1SetSpy = vi.spyOn(s1, "setAttribute");
        const s2SetSpy = vi.spyOn(s2, "setAttribute");
        const s3SetSpy = vi.spyOn(s3, "setAttribute");
        const s4SetSpy = vi.spyOn(s4, "setAttribute");

        const s5 = appendConversationSection(container, "5");
        const s6 = appendConversationSection(container, "6");

        resetConversationDomCacheForTests();

        syncCssVisibilityWindow();

        expect(s1.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s2.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s3.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s4.getAttribute(OUT_OF_WINDOW_ATTR)).toBe("true");
        expect(s5.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);
        expect(s6.hasAttribute(OUT_OF_WINDOW_ATTR)).toBe(false);

        expect(s1SetSpy).not.toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR, "true");
        expect(s2SetSpy).not.toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR, "true");
        expect(s3SetSpy).toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR, "true");
        expect(s4SetSpy).toHaveBeenCalledWith(OUT_OF_WINDOW_ATTR, "true");
    });
});