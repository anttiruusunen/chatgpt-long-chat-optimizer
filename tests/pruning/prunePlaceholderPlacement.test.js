import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { ensurePlaceholderState, removePlaceholder } from "../../src/content/pruning/pruneUi.js";
import {
    getConversationContainer,
    getConversationSectionMountNode,
} from "../../src/content/core/dom.js";
import {
    state,
    PLACEHOLDER_ATTR,
} from "../../src/content/core/state.js";

function makeWrappedTurn(id, turn, { anchor = "false" } = {}) {
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

describe("prune placeholder placement", () => {
    beforeEach(() => {
        document.body.innerHTML = `<main><div id="conversation-host"></div></main>`;
        state.placeholder = null;
        state.hiddenCount = 0;
    });

    afterEach(() => {
        removePlaceholder({ destroy: true });
        state.placeholder = null;
        state.hiddenCount = 0;
        document.body.innerHTML = "";
    });

    it("inserts the placeholder before the first visible wrapper node, not inside it", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        state.hiddenCount = 4;

        const changed = ensurePlaceholderState(first.section);

        expect(changed).toBe(true);
        expect(getConversationContainer()).toBe(host);
        expect(getConversationSectionMountNode(first.section)).toBe(first.wrapper);
        expect(host.firstElementChild?.getAttribute(PLACEHOLDER_ATTR)).toBe("true");
        expect(host.children[1]).toBe(first.wrapper);
    });

    it("reuses the same placeholder node across repeated calls", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        state.hiddenCount = 2;
        ensurePlaceholderState(first.section);

        const firstPlaceholder = state.placeholder;

        state.hiddenCount = 6;
        ensurePlaceholderState(first.section);

        expect(state.placeholder).toBe(firstPlaceholder);
        expect(host.firstElementChild).toBe(firstPlaceholder);
        expect(firstPlaceholder.firstElementChild.textContent).toBe("6 older messages hidden");
    });

    it("hides the placeholder when there is no first visible section", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);

        state.hiddenCount = 3;
        ensurePlaceholderState(first.section);

        const placeholder = state.placeholder;
        expect(placeholder).not.toBeNull();

        const changed = ensurePlaceholderState(null);

        expect(changed).toBe(true);
        expect(placeholder.hidden).toBe(true);
    });

    it("hides the placeholder when the mount node no longer belongs to the container", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);

        state.hiddenCount = 3;
        ensurePlaceholderState(first.section);

        const placeholder = state.placeholder;
        expect(placeholder).not.toBeNull();

        first.wrapper.remove();

        const changed = ensurePlaceholderState(first.section);

        expect(changed).toBe(true);
        expect(placeholder.hidden).toBe(true);
    });
});