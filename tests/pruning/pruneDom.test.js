import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
    destroySectionForGc,
    softPruneSection,
    softPruneSections,
    restoreSoftPrunedSection,
    restoreSoftPrunedSections,
} from "../../src/content/pruning/pruneDom.js";

import { getConversationTurnRoot } from "../../src/content/core/dom.js";
import {
    PRUNED_ATTR,
    UNPRUNEABLE_ATTR,
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
} from "../../src/content/core/state.js";

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
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("softPruneSection removes the wrapper turn root, not just the inner section", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        softPruneSection(second.section);

        expect(second.section.getAttribute(PRUNED_ATTR)).toBe("true");
        expect(second.wrapper.isConnected).toBe(false);
        expect(second.section.isConnected).toBe(false);
        expect(Array.from(host.children)).toEqual([first.wrapper]);
    });

    it("softPruneSections soft-prunes multiple valid sections and skips invalid entries", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        const prunedCount = softPruneSections([
            first.section,
            null,
            second.section,
            "bad",
        ]);

        expect(prunedCount).toBe(2);
        expect(first.section.getAttribute(PRUNED_ATTR)).toBe("true");
        expect(second.section.getAttribute(PRUNED_ATTR)).toBe("true");
        expect(third.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(Array.from(host.children)).toEqual([third.wrapper]);
    });

    it("softPruneSection clears the unpruneable marker", () => {
        const host = document.getElementById("conversation-host");
        const turn = makeWrappedTurn("1", "assistant");

        turn.section.setAttribute(UNPRUNEABLE_ATTR, "true");
        host.appendChild(turn.wrapper);

        softPruneSection(turn.section);

        expect(turn.section.hasAttribute(UNPRUNEABLE_ATTR)).toBe(false);
    });

    it("restoreSoftPrunedSection restores the wrapper using the supplied beforeNode when valid", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        softPruneSection(second.section);

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

        restoreSoftPrunedSection(first.section, host, null);

        expect(Array.from(host.children)).toEqual([second.wrapper, first.wrapper]);
    });

    it("restoreSoftPrunedSection ignores a beforeNode from another parent", () => {
        const host = document.getElementById("conversation-host");
        const otherHost = document.createElement("div");
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

    it("restoreSoftPrunedSections restores multiple soft-pruned sections before the anchor in order", () => {
        const host = document.getElementById("conversation-host");

        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        softPruneSection(first.section);
        softPruneSection(second.section);

        expect(host.contains(first.wrapper)).toBe(false);
        expect(host.contains(second.wrapper)).toBe(false);
        expect(host.contains(third.wrapper)).toBe(true);

        const restoredCount = restoreSoftPrunedSections(
            [first.section, second.section],
            host,
            third.section
        );

        expect(restoredCount).toBe(2);
        expect(Array.from(host.children)).toEqual([
            first.wrapper,
            second.wrapper,
            third.wrapper,
        ]);
        expect(first.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(second.section.hasAttribute(PRUNED_ATTR)).toBe(false);
    });

    it("restoreSoftPrunedSections appends when beforeNode is missing", () => {
        const host = document.getElementById("conversation-host");

        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        softPruneSection(first.section);
        softPruneSection(second.section);

        const restoredCount = restoreSoftPrunedSections(
            [first.section, second.section],
            host
        );

        expect(restoredCount).toBe(2);
        expect(Array.from(host.children)).toEqual([
            third.wrapper,
            first.wrapper,
            second.wrapper,
        ]);
    });

    it("restoreSoftPrunedSections skips invalid entries", () => {
        const host = document.getElementById("conversation-host");

        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        softPruneSection(first.section);

        const restoredCount = restoreSoftPrunedSections(
            [null, first.section, "bad"],
            host,
            second.section
        );

        expect(restoredCount).toBe(1);
        expect(Array.from(host.children)).toEqual([
            first.wrapper,
            second.wrapper,
        ]);
    });

    it("restoreSoftPrunedSections returns zero when container is invalid", () => {
        const turn = makeWrappedTurn("1", "assistant");

        expect(
            restoreSoftPrunedSections([turn.section], null)
        ).toBe(0);
    });

    it("destroySectionForGc clears the section without requiring it to stay mounted", () => {
        const turn = makeWrappedTurn("1", "assistant");
        const inner = document.createElement("div");
        inner.textContent = "hello";

        turn.section.setAttribute(PRUNED_ATTR, "true");
        turn.section.setAttribute(UNPRUNEABLE_ATTR, "true");
        turn.section.setAttribute(OFFSCREEN_OPT_ATTR, "true");
        turn.section.style.contentVisibility = "auto";
        turn.section.style.containIntrinsicSize = "100px";
        turn.section.dataset.threadOptimizerHeight = "100";

        turn.section.appendChild(inner);

        destroySectionForGc(turn.section);

        expect(turn.section.childElementCount).toBe(0);
        expect(turn.section.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(turn.section.hasAttribute(UNPRUNEABLE_ATTR)).toBe(false);
        expect(turn.section.hasAttribute(OFFSCREEN_OPT_ATTR)).toBe(false);
        expect(turn.section.style.contentVisibility).toBe("");
        expect(turn.section.style.containIntrinsicSize).toBe("");
        expect(turn.section.dataset.threadOptimizerHeight).toBeUndefined();
    });

    it("destroySectionForGc clears code block optimization state", () => {
        const turn = makeWrappedTurn("1", "assistant");
        const pre = document.createElement("pre");

        pre.setAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR, "true");
        pre.style.contentVisibility = "auto";
        pre.style.containIntrinsicSize = "200px";
        pre.dataset.threadOptimizerCodeHeight = "200";
        pre.dataset.threadOptimizerLargeCode = "true";

        turn.section.appendChild(pre);

        destroySectionForGc(turn.section);

        expect(pre.hasAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR)).toBe(false);
        expect(pre.style.contentVisibility).toBe("");
        expect(pre.style.containIntrinsicSize).toBe("");
        expect(pre.dataset.threadOptimizerCodeHeight).toBeUndefined();
        expect(pre.dataset.threadOptimizerLargeCode).toBeUndefined();
        expect(turn.section.childElementCount).toBe(0);
    });

    it("destroySectionForGc accepts pre-collected codeBlocks", () => {
        const turn = makeWrappedTurn("1", "assistant");
        const pre = document.createElement("pre");

        pre.setAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR, "true");
        pre.dataset.threadOptimizerLargeCode = "true";

        destroySectionForGc(turn.section, {
            codeBlocks: [pre],
        });

        expect(pre.hasAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR)).toBe(false);
        expect(pre.dataset.threadOptimizerLargeCode).toBeUndefined();
    });

    it("getConversationTurnRoot stays aligned with pruning behavior", () => {
        const turn = makeWrappedTurn("1", "assistant");

        expect(getConversationTurnRoot(turn.section)).toBe(turn.wrapper);
    });
});