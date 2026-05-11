import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    isConversationSection,
    getAnchorSection,
    getConversationContainer,
    getConversationSections,
    getRecentSections,
    getLatestAssistantSection,
    getConversationScrollContainer,
    resetConversationDomCacheForTests,
} from "../../src/content/core/dom.js";

function makeWrapper(id, turn, { anchor = "false" } = {}) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-turn-id-container", id);

    const section = document.createElement("section");
    section.setAttribute("data-testid", `conversation-turn-${id}`);
    section.setAttribute("data-turn-id", id);
    section.setAttribute("data-turn", turn);
    section.setAttribute("data-scroll-anchor", anchor);

    wrapper.appendChild(section);
    return { wrapper, section };
}

function getDocumentScroller() {
    return document.scrollingElement || document.documentElement;
}

describe("isConversationSection", () => {
    it("returns true for a real conversation section by data-testid", () => {
        const el = document.createElement("section");
        el.setAttribute("data-testid", "conversation-turn-123");

        expect(isConversationSection(el)).toBe(true);
    });

    it("returns true for a real conversation section by data-turn", () => {
        const el = document.createElement("section");
        el.setAttribute("data-turn", "assistant");

        expect(isConversationSection(el)).toBe(true);
    });

    it("returns false for non-conversation sections", () => {
        const el = document.createElement("section");

        expect(isConversationSection(el)).toBe(false);
    });

    it("returns false for non-sections", () => {
        const el = document.createElement("div");
        el.setAttribute("data-testid", "conversation-turn-123");

        expect(isConversationSection(el)).toBe(false);
    });
});

describe("conversation DOM helpers", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetConversationDomCacheForTests();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = "";
        resetConversationDomCacheForTests();
        vi.restoreAllMocks();
    });

    function buildWrappedConversation() {
        document.body.innerHTML = `
            <main>
                <div id="outer-scroll">
                    <div id="thread-root">
                        <div id="conversation-host"></div>
                    </div>
                </div>
            </main>
        `;

        const host = document.getElementById("conversation-host");

        const first = makeWrapper("1", "user");
        const second = makeWrapper("2", "assistant", { anchor: "true" });
        const third = makeWrapper("3", "user");
        const fourth = makeWrapper("4", "assistant");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);
        host.appendChild(fourth.wrapper);

        return {
            host,
            wrappers: [first.wrapper, second.wrapper, third.wrapper, fourth.wrapper],
            sections: [first.section, second.section, third.section, fourth.section],
        };
    }

    it("uses the scroll anchor when present", () => {
        const { sections } = buildWrappedConversation();

        expect(getAnchorSection()).toBe(sections[1]);
    });

    it("falls back to the last conversation section when scroll anchor is missing", () => {
        const { sections } = buildWrappedConversation();

        sections[1].setAttribute("data-scroll-anchor", "false");

        expect(getAnchorSection()).toBe(sections[3]);
    });

    it("finds the top-level mounted conversation document root", () => {
        buildWrappedConversation();

        expect(getConversationContainer()).toBe(document.documentElement);
    });

    it("returns only real conversation sections", () => {
        const { host, sections } = buildWrappedConversation();

        const unrelatedSection = document.createElement("section");
        unrelatedSection.setAttribute("data-testid", "not-a-conversation-turn");

        const unrelatedWrapper = document.createElement("div");
        unrelatedWrapper.appendChild(unrelatedSection);

        host.appendChild(unrelatedWrapper);

        expect(getConversationSections()).toEqual(sections);
    });

    it("returns recent sections from the anchor backwards", () => {
        const { sections } = buildWrappedConversation();

        expect(getRecentSections(1)).toEqual([sections[1]]);
        expect(getRecentSections(2)).toEqual([sections[0], sections[1]]);
        expect(getRecentSections(3)).toEqual([sections[0], sections[1]]);
    });

    it("finds the latest assistant section", () => {
        const { sections } = buildWrappedConversation();

        expect(getLatestAssistantSection()).toBe(sections[3]);
    });

    it("uses the document scroller", () => {
        buildWrappedConversation();

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
    });

    it("ignores custom overflow containers and keeps using the document scroller", () => {
        buildWrappedConversation();
        const outerScroll = document.getElementById("outer-scroll");

        vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
            if (el === outerScroll) {
                return {
                    overflow: "auto",
                    overflowY: "auto",
                };
            }

            return {
                overflow: "visible",
                overflowY: "visible",
            };
        });

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
    });

    it("does not require scrollHeight and clientHeight checks", () => {
        buildWrappedConversation();
        const outerScroll = document.getElementById("outer-scroll");

        Object.defineProperty(outerScroll, "scrollHeight", {
            configurable: true,
            get: () => 100,
        });

        Object.defineProperty(outerScroll, "clientHeight", {
            configurable: true,
            get: () => 100,
        });

        vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
            if (el === outerScroll) {
                return {
                    overflow: "auto",
                    overflowY: "auto",
                };
            }

            return {
                overflow: "visible",
                overflowY: "visible",
            };
        });

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
    });

    it("does not change scroll container when the anchor changes", () => {
        const { sections } = buildWrappedConversation();

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());

        sections[1].setAttribute("data-scroll-anchor", "false");
        sections[3].setAttribute("data-scroll-anchor", "true");

        resetConversationDomCacheForTests();

        expect(getAnchorSection()).toBe(sections[3]);
        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
    });

    it("returns null container and empty sections when there is no conversation", () => {
        document.body.innerHTML = `<main><div id="empty"></div></main>`;

        expect(getAnchorSection()).toBe(null);
        expect(getConversationContainer()).toBe(null);
        expect(getConversationSections()).toEqual([]);
        expect(getRecentSections(3)).toEqual([]);
        expect(getLatestAssistantSection()).toBe(null);
    });

    it("can find sections nested under wrapper divs instead of direct children", () => {
        const { host, sections } = buildWrappedConversation();

        expect(host.children.length).toBe(4);
        expect(host.querySelectorAll(":scope > section").length).toBe(0);
        expect(getConversationSections()).toEqual(sections);
    });

    it("caches the document scroll container", () => {
        document.body.innerHTML = `
            <main>
                <div id="scroll-root" style="overflow-y: auto;">
                    <div id="conversation">
                        <section data-testid="conversation-turn-1" data-turn="user"></section>
                        <section data-testid="conversation-turn-2" data-turn="assistant" data-scroll-anchor="true"></section>
                    </div>
                </div>
            </main>
        `;

        const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");

        resetConversationDomCacheForTests();

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
        expect(getConversationScrollContainer()).toBe(getDocumentScroller());

        expect(getComputedStyleSpy).not.toHaveBeenCalled();
    });

    it("still returns the document scroller after the conversation DOM cache is reset", () => {
        document.body.innerHTML = `
            <main>
                <div id="old-scroll-root" style="overflow-y: auto;">
                    <div id="conversation">
                        <section data-testid="conversation-turn-1" data-turn="user"></section>
                        <section data-testid="conversation-turn-2" data-turn="assistant" data-scroll-anchor="true"></section>
                    </div>
                </div>
            </main>
        `;

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());

        document.body.innerHTML = `
            <main>
                <div id="new-scroll-root" style="overflow-y: auto;">
                    <div id="conversation">
                        <section data-testid="conversation-turn-1" data-turn="user"></section>
                        <section data-testid="conversation-turn-2" data-turn="assistant" data-scroll-anchor="true"></section>
                    </div>
                </div>
            </main>
        `;

        resetConversationDomCacheForTests();

        expect(getConversationScrollContainer()).toBe(getDocumentScroller());
    });
});