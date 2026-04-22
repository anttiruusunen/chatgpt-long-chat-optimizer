import { describe, it, expect, beforeEach } from "vitest";

import {
    state,
    PRUNED_ATTR,
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
    UNPRUNEABLE_ATTR,
} from "../../src/content/core/state.js";
import { getConversationTurnRoot } from "../../src/content/core/dom.js";
import {
    destroySectionForGc,
    softPruneSection,
    restoreSoftPrunedSection,
    hardEvictSection,
} from "../../src/content/pruning/pruneDom.js";

function makeWrappedTurn(id, turn) {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-turn-id-container", id);

    const section = document.createElement("section");
    section.setAttribute("data-testid", `conversation-turn-${id}`);
    section.setAttribute("data-turn-id", id);
    section.setAttribute("data-turn", turn);

    wrapper.appendChild(section);
    return { wrapper, section };
}

describe("pruneDom wrapper-aware behavior", () => {
    beforeEach(() => {
        document.body.innerHTML = `<main><div id="conversation-host"></div></main>`;

        state.observedSections = new Set();
        state.observedCodeBlocks = new Set();
        state.intersectionObserver = { unobserve() {} };
        state.resizeObserver = { unobserve() {} };
        state.codeBlockIntersectionObserver = { unobserve() {} };
    });

    it("softPruneSection removes the wrapper turn root, not just the inner section", () => {
        const host = document.getElementById("conversation-host");
        const wrapped = makeWrappedTurn("1", "assistant");

        host.appendChild(wrapped.wrapper);

        softPruneSection(wrapped.section);

        expect(wrapped.section.getAttribute(PRUNED_ATTR)).toBe("true");
        expect(wrapped.wrapper.isConnected).toBe(false);
        expect(wrapped.section.isConnected).toBe(false);
    });

    it("restoreSoftPrunedSection restores the wrapper before the target wrapper", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        softPruneSection(second.section);

        expect(Array.from(host.children)).toEqual([first.wrapper, third.wrapper]);

        restoreSoftPrunedSection(second.section, host, third.section);

        expect(second.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(Array.from(host.children)).toEqual([
            first.wrapper,
            second.wrapper,
            third.wrapper,
        ]);
    });

    it("restoreSoftPrunedSection appends the wrapper when beforeNode is null", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        softPruneSection(first.section);

        restoreSoftPrunedSection(first.section, host);

        expect(Array.from(host.children)).toEqual([second.wrapper, first.wrapper]);
    });

    it("restoreSoftPrunedSection ignores a beforeNode from another parent", () => {
        const host = document.getElementById("conversation-host");
        const otherHost = document.createElement("div");
        document.body.appendChild(otherHost);

        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const foreign = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        otherHost.appendChild(foreign.wrapper);

        softPruneSection(first.section);
        restoreSoftPrunedSection(first.section, host, foreign.section);

        expect(Array.from(host.children)).toEqual([second.wrapper, first.wrapper]);
    });

    it("hardEvictSection removes the wrapper and clears section contents", () => {
        const host = document.getElementById("conversation-host");
        const wrapped = makeWrappedTurn("1", "assistant");
        const pre = document.createElement("pre");
        pre.setAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR, "true");
        pre.dataset.threadOptimizerCodeHeight = "123";
        pre.dataset.threadOptimizerLargeCode = "true";
        wrapped.section.appendChild(pre);
        wrapped.section.setAttribute(OFFSCREEN_OPT_ATTR, "true");
        wrapped.section.setAttribute(PRUNED_ATTR, "true");
        wrapped.section.setAttribute(UNPRUNEABLE_ATTR, "true");
        wrapped.section.dataset.threadOptimizerHeight = "456";

        host.appendChild(wrapped.wrapper);

        hardEvictSection(wrapped.section);

        expect(wrapped.wrapper.isConnected).toBe(false);
        expect(wrapped.section.children.length).toBe(0);
        expect(wrapped.section.hasAttribute(OFFSCREEN_OPT_ATTR)).toBe(false);
        expect(wrapped.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(wrapped.section.hasAttribute(UNPRUNEABLE_ATTR)).toBe(false);
        expect(wrapped.section.dataset.threadOptimizerHeight).toBeUndefined();
    });

    it("destroySectionForGc clears the section without requiring it to stay mounted", () => {
        const wrapped = makeWrappedTurn("1", "assistant");
        const pre = document.createElement("pre");
        pre.setAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR, "true");
        pre.dataset.threadOptimizerCodeHeight = "123";
        pre.dataset.threadOptimizerLargeCode = "true";
        wrapped.section.appendChild(pre);
        wrapped.section.setAttribute(OFFSCREEN_OPT_ATTR, "true");
        wrapped.section.setAttribute(PRUNED_ATTR, "true");
        wrapped.section.setAttribute(UNPRUNEABLE_ATTR, "true");
        wrapped.section.dataset.threadOptimizerHeight = "456";

        destroySectionForGc(wrapped.section);

        expect(wrapped.section.children.length).toBe(0);
        expect(wrapped.section.hasAttribute(OFFSCREEN_OPT_ATTR)).toBe(false);
        expect(wrapped.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(wrapped.section.hasAttribute(UNPRUNEABLE_ATTR)).toBe(false);
        expect(wrapped.section.dataset.threadOptimizerHeight).toBeUndefined();
    });

    it("getConversationTurnRoot stays aligned with pruning behavior", () => {
        const wrapped = makeWrappedTurn("1", "assistant");

        expect(getConversationTurnRoot(wrapped.section)).toBe(wrapped.wrapper);
    });
});