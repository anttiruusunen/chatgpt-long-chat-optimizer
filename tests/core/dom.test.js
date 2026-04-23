import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
    isConversationSection,
    getAnchorSection,
    getConversationContainer,
    getConversationSections,
    getRecentSections,
    getLatestAssistantSection,
    getConversationScrollContainer,
    getConversationTurnRoot,
    getConversationSectionMountNode,
} from "../../src/content/core/dom.js";

import {
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../../src/content/core/state.js";

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

    it("returns false for sentinels and placeholders", () => {
        const placeholder = document.createElement("section");
        placeholder.setAttribute("data-testid", "conversation-turn-placeholder");
        placeholder.setAttribute(PLACEHOLDER_ATTR, "true");

        const topSentinel = document.createElement("section");
        topSentinel.setAttribute("data-testid", "conversation-turn-top");
        topSentinel.setAttribute(TOP_RESTORE_SENTINEL_ATTR, "true");

        const bottomSentinel = document.createElement("section");
        bottomSentinel.setAttribute("data-testid", "conversation-turn-bottom");
        bottomSentinel.setAttribute(BOTTOM_PRUNE_SENTINEL_ATTR, "true");

        expect(isConversationSection(placeholder)).toBe(false);
        expect(isConversationSection(topSentinel)).toBe(false);
        expect(isConversationSection(bottomSentinel)).toBe(false);
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
        vi.restoreAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = "";
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

    it("finds the conversation container from wrapped turns", () => {
        const { host } = buildWrappedConversation();

        expect(getConversationContainer()).toBe(host);
    });

    it("returns only real conversation sections", () => {
        const { host, sections } = buildWrappedConversation();

        const sentinelWrapper = document.createElement("div");
        const sentinel = document.createElement("section");
        sentinel.setAttribute("data-testid", "conversation-turn-sentinel");
        sentinel.setAttribute(TOP_RESTORE_SENTINEL_ATTR, "true");
        sentinelWrapper.appendChild(sentinel);
        host.appendChild(sentinelWrapper);

        const placeholderWrapper = document.createElement("div");
        const placeholder = document.createElement("section");
        placeholder.setAttribute("data-testid", "conversation-turn-placeholder");
        placeholder.setAttribute(PLACEHOLDER_ATTR, "true");
        placeholderWrapper.appendChild(placeholder);
        host.appendChild(placeholderWrapper);

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

    it("falls back to the document scroller when no custom scroll container exists", () => {
        buildWrappedConversation();

        expect(getConversationScrollContainer()).toBe(
            document.scrollingElement || document.documentElement
        );
    });

    it("finds a custom scroll container when one has overflow-y auto", () => {
        const { host } = buildWrappedConversation();
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

        expect(getConversationContainer()).toBe(host);
        expect(getConversationScrollContainer()).toBe(outerScroll);
    });

    it("does not require scrollHeight and clientHeight checks to find the scroll container", () => {
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

        expect(getConversationScrollContainer()).toBe(outerScroll);
    });

    it("does not reuse an old result after the anchor changes", () => {
        const { sections } = buildWrappedConversation();
        const outerScroll = document.getElementById("outer-scroll");
        const threadRoot = document.getElementById("thread-root");

        let mode = "outer";

        vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
            if (mode === "outer") {
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
            }

            if (el === threadRoot) {
                return {
                    overflow: "scroll",
                    overflowY: "scroll",
                };
            }

            if (el === outerScroll) {
                return {
                    overflow: "visible",
                    overflowY: "visible",
                };
            }

            return {
                overflow: "visible",
                overflowY: "visible",
            };
        });

        expect(getConversationScrollContainer()).toBe(outerScroll);

        sections[1].setAttribute("data-scroll-anchor", "false");
        sections[3].setAttribute("data-scroll-anchor", "true");
        mode = "thread";

        expect(getAnchorSection()).toBe(sections[3]);
        expect(getConversationScrollContainer()).toBe(threadRoot);
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

    it("returns the wrapper turn root when a section is wrapped", () => {
        const { wrappers, sections } = buildWrappedConversation();

        expect(getConversationTurnRoot(sections[1])).toBe(wrappers[1]);
        expect(getConversationSectionMountNode(sections[1])).toBe(wrappers[1]);
    });

    it("falls back to the section itself when no wrapper exists", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation-host">
                    <section
                        data-testid="conversation-turn-1"
                        data-turn-id="1"
                        data-turn="assistant"
                        data-scroll-anchor="true"
                    ></section>
                </div>
            </main>
        `;

        const section = document.querySelector("section");

        expect(getConversationTurnRoot(section)).toBe(section);
        expect(getConversationSectionMountNode(section)).toBe(section);
    });

    it("climbs through multiple exclusive wrappers and stops before a shared parent", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation-host">
                    <div class="row" id="row-1">
                        <div class="bubble" id="bubble-1">
                            <section
                                data-testid="conversation-turn-1"
                                data-turn-id="1"
                                data-turn="user"
                                data-scroll-anchor="false"
                            ></section>
                        </div>
                    </div>
                    <div class="row" id="row-2">
                        <div class="bubble" id="bubble-2">
                            <section
                                data-testid="conversation-turn-2"
                                data-turn-id="2"
                                data-turn="assistant"
                                data-scroll-anchor="true"
                            ></section>
                        </div>
                    </div>
                </div>
            </main>
        `;

        const section = document.querySelector('[data-turn-id="2"]');
        const row = document.getElementById("row-2");

        expect(getConversationSectionMountNode(section)).toBe(row);
    });
});