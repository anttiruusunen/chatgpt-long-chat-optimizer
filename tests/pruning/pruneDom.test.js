import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
    destroySectionForGc,
    softPruneSection,
    restoreSoftPrunedSection,
    restoreSoftPrunedSections,
    hardEvictSection,
} from "../../src/content/pruning/pruneDom.js";

import { getConversationTurnRoot } from "../../src/content/core/dom.js";
import { PRUNED_ATTR } from "../../src/content/core/state.js";

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

    it("hardEvictSection removes the wrapper and clears section contents", () => {
        const host = document.getElementById("conversation-host");
        const turn = makeWrappedTurn("1", "assistant");
        const inner = document.createElement("div");
        inner.textContent = "hello";
        turn.section.appendChild(inner);
        host.appendChild(turn.wrapper);

        hardEvictSection(turn.section);

        expect(turn.wrapper.isConnected).toBe(false);
        expect(turn.section.childElementCount).toBe(0);
    });

    it("destroySectionForGc clears the section without requiring it to stay mounted", () => {
        const turn = makeWrappedTurn("1", "assistant");
        const inner = document.createElement("div");
        inner.textContent = "hello";
        turn.section.appendChild(inner);

        destroySectionForGc(turn.section);

        expect(turn.section.childElementCount).toBe(0);
        expect(turn.section.hasAttribute(PRUNED_ATTR)).toBe(false);
    });

    it("getConversationTurnRoot stays aligned with pruning behavior", () => {
        const turn = makeWrappedTurn("1", "assistant");

        expect(getConversationTurnRoot(turn.section)).toBe(turn.wrapper);
    });

    it("restores multiple soft-pruned sections before the anchor in order", () => {
        const container = document.createElement("div");

        const { wrapper: w1, section: s1 } = makeWrappedTurn("1", "user");
        const { wrapper: w2, section: s2 } = makeWrappedTurn("2", "assistant");
        const { wrapper: w3, section: s3 } = makeWrappedTurn("3", "user");

        container.appendChild(w1);
        container.appendChild(w2);
        container.appendChild(w3);
        document.body.appendChild(container);

        softPruneSection(s1);
        softPruneSection(s2);

        expect(container.contains(w1)).toBe(false);
        expect(container.contains(w2)).toBe(false);
        expect(container.contains(w3)).toBe(true);

        const restoredCount = restoreSoftPrunedSections(
            [s1, s2],
            container,
            s3
        );

        expect(restoredCount).toBe(2);
        expect(Array.from(container.children)).toEqual([w1, w2, w3]);
        expect(s1.hasAttribute(PRUNED_ATTR)).toBe(false);
        expect(s2.hasAttribute(PRUNED_ATTR)).toBe(false);
    });
});