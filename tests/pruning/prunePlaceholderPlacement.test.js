import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { state, PLACEHOLDER_ATTR } from "../../src/content/core/state.js";
import { ensurePlaceholderState, removePlaceholder } from "../../src/content/pruning/pruneUi.js";
import { getConversationTurnRoot } from "../../src/content/core/dom.js";

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
        document.body.innerHTML = `
            <main>
                <div id="conversation-host"></div>
            </main>
        `;

        state.placeholder = null;
        state.hiddenCount = 4;
    });

    afterEach(() => {
        removePlaceholder({ destroy: true });
        document.body.innerHTML = "";
    });

    it("inserts the placeholder before the wrapped turn root, not before the inner section", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        const changed = ensurePlaceholderState(second.section);
        const placeholder = host.querySelector(`[${PLACEHOLDER_ATTR}="true"]`);

        expect(changed).toBe(true);
        expect(placeholder).not.toBeNull();
        expect(placeholder.parentElement).toBe(host);
        expect(placeholder.nextElementSibling).toBe(getConversationTurnRoot(second.section));
        expect(second.wrapper.previousElementSibling).toBe(placeholder);
        expect(second.section.previousElementSibling).toBe(null);
    });

    it("reuses the same placeholder node across repeated calls", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant", { anchor: "true" });

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);

        ensurePlaceholderState(second.section);
        const firstPlaceholder = state.placeholder;

        ensurePlaceholderState(second.section);
        const secondPlaceholder = state.placeholder;

        expect(firstPlaceholder).toBe(secondPlaceholder);
        expect(host.querySelectorAll(`[${PLACEHOLDER_ATTR}="true"]`).length).toBe(1);
    });

    it("moves the placeholder when the first visible section changes to another wrapped turn", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");
        const second = makeWrappedTurn("2", "assistant");
        const third = makeWrappedTurn("3", "user");

        host.appendChild(first.wrapper);
        host.appendChild(second.wrapper);
        host.appendChild(third.wrapper);

        ensurePlaceholderState(second.section);
        expect(state.placeholder.nextElementSibling).toBe(second.wrapper);

        ensurePlaceholderState(third.section);
        expect(state.placeholder.nextElementSibling).toBe(third.wrapper);
    });

    it("hides the placeholder when there is no first visible section", () => {
        const host = document.getElementById("conversation-host");
        const first = makeWrappedTurn("1", "user");

        host.appendChild(first.wrapper);

        ensurePlaceholderState(first.section);
        const placeholder = state.placeholder;

        expect(placeholder).not.toBeNull();

        const changed = ensurePlaceholderState(null);

        expect(changed).toBe(true);
        expect(placeholder.hidden).toBe(true);
    });
});