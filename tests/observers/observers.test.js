import { describe, it, expect, beforeEach, vi } from "vitest";

import { state } from "../../src/content/core/state.js";
import {
    mutationNeedsPrune,
    handleObservedMutations,
} from "../../src/content/observers/observers.js";

function makeWrapper(id, turn = "assistant") {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-turn-id-container", id);

    const section = document.createElement("section");
    section.setAttribute("data-testid", `conversation-turn-${id}`);
    section.setAttribute("data-turn-id", id);
    section.setAttribute("data-turn", turn);

    wrapper.appendChild(section);
    return { wrapper, section };
}

describe("observers", () => {
    beforeEach(() => {
        document.body.innerHTML = `<main><div id="conversation-host"></div></main>`;
        state.observedContainer = document.getElementById("conversation-host");
        state.isApplyingDomChanges = false;
    });

    it("treats wrapper turn insertion as prune-relevant", () => {
        const { wrapper } = makeWrapper("1");

        const mutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [wrapper],
            removedNodes: [],
        };

        expect(mutationNeedsPrune(mutation, state.observedContainer)).toBe(true);
    });

    it("treats wrapper turn removal as prune-relevant", () => {
        const { wrapper } = makeWrapper("1");

        const mutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [],
            removedNodes: [wrapper],
        };

        expect(mutationNeedsPrune(mutation, state.observedContainer)).toBe(true);
    });

    it("ignores non-turn direct children", () => {
        const divider = document.createElement("div");
        divider.textContent = "typing...";

        const mutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [divider],
            removedNodes: [],
        };

        expect(mutationNeedsPrune(mutation, state.observedContainer)).toBe(false);
    });

    it("ignores deep markdown churn because the container observer is shallow", () => {
        const { wrapper, section } = makeWrapper("1");
        state.observedContainer.appendChild(wrapper);

        const markdown = document.createElement("div");
        markdown.className = "markdown";
        section.appendChild(markdown);

        const token = document.createElement("span");
        token.textContent = "hello";

        const mutation = {
            type: "childList",
            target: markdown,
            addedNodes: [token],
            removedNodes: [],
        };

        expect(mutationNeedsPrune(mutation, state.observedContainer)).toBe(false);
    });

    it("schedules auto-prune only for real turn-structure changes", () => {
        const scheduleAutoPrune = vi.fn();
        const getDidInitialPrune = vi.fn(() => true);

        const irrelevantMutation = {
            type: "childList",
            target: document.createElement("div"),
            addedNodes: [document.createElement("span")],
            removedNodes: [],
        };

        handleObservedMutations([irrelevantMutation], {
            scheduleAutoPrune,
            getDidInitialPrune,
            bootstrapInitialPrune: vi.fn(),
        });

        expect(scheduleAutoPrune).not.toHaveBeenCalled();

        const { wrapper } = makeWrapper("2");
        const relevantMutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [wrapper],
            removedNodes: [],
        };

        handleObservedMutations([relevantMutation], {
            scheduleAutoPrune,
            getDidInitialPrune,
            bootstrapInitialPrune: vi.fn(),
        });

        expect(scheduleAutoPrune).toHaveBeenCalledTimes(1);
    });

    it("bootstraps initial prune for the first real turn-structure change", () => {
        const bootstrapInitialPrune = vi.fn();

        const { wrapper } = makeWrapper("3");
        const relevantMutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [wrapper],
            removedNodes: [],
        };

        handleObservedMutations([relevantMutation], {
            scheduleAutoPrune: vi.fn(),
            getDidInitialPrune: () => false,
            bootstrapInitialPrune,
        });

        expect(bootstrapInitialPrune).toHaveBeenCalledTimes(1);
    });
});