import { describe, it, expect, beforeEach, vi } from "vitest";

import { state } from "../../src/content/core/state.js";
import {
    mutationNeedsPrune,
    handleObservedMutations,
    containerHasConversationTurns,
} from "../../src/content/observers/observers.js";

const SECTION_ATTR = "data-thread-optimizer-offscreen-opt";
const HEIGHT_ATTR = "data-thread-optimizer-height";

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

function mockSectionHeight(section, height = 120) {
    Object.defineProperty(section, "offsetHeight", {
        configurable: true,
        value: height,
    });

    section.getBoundingClientRect = vi.fn(() => ({
        width: 800,
        height,
        top: 0,
        right: 800,
        bottom: height,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
    }));
}

describe("observers", () => {
    beforeEach(() => {
        document.body.innerHTML = `<main><div id="conversation-host"></div></main>`;
        state.observedContainer = document.getElementById("conversation-host");
        state.isApplyingDomChanges = false;
        state.featureFlags.offscreenOptimization = false;
        state.featureFlags.pruning = true;
        state.settings.autoPrune = true;
    });

    it("detects whether a container has conversation turns", () => {
        const container = state.observedContainer;

        expect(containerHasConversationTurns(container)).toBe(false);

        const { wrapper } = makeWrapper("1");
        container.appendChild(wrapper);

        expect(containerHasConversationTurns(container)).toBe(true);
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


    it("optimizes added conversation sections during turn mutations", () => {
        state.featureFlags.offscreenOptimization = true;

        const { wrapper, section } = makeWrapper("2");
        mockSectionHeight(section, 180);

        const mutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [wrapper],
            removedNodes: [],
        };

        handleObservedMutations([mutation], {
            scheduleAutoPrune: vi.fn(),
            getDidInitialPrune: () => true,
            bootstrapInitialPrune: vi.fn(),
        });

        expect(section.getAttribute(SECTION_ATTR)).toBe("true");
        expect(section.getAttribute(HEIGHT_ATTR)).toBe("180");
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

    it("optimizes added sections even when pruning is disabled", () => {
        state.featureFlags.offscreenOptimization = true;
        state.featureFlags.pruning = false;
        state.settings.autoPrune = false;

        const scheduleAutoPrune = vi.fn();
        const bootstrapInitialPrune = vi.fn();

        const { wrapper, section } = makeWrapper("4");
        mockSectionHeight(section, 210);

        const mutation = {
            type: "childList",
            target: state.observedContainer,
            addedNodes: [wrapper],
            removedNodes: [],
        };

        handleObservedMutations([mutation], {
            scheduleAutoPrune,
            getDidInitialPrune: () => true,
            bootstrapInitialPrune,
        });

        expect(section.getAttribute(SECTION_ATTR)).toBe("true");
        expect(section.getAttribute(HEIGHT_ATTR)).toBe("210");

        expect(scheduleAutoPrune).not.toHaveBeenCalled();
        expect(bootstrapInitialPrune).not.toHaveBeenCalled();
    });

    it("does not optimize deep added nodes outside direct container turn mounts", () => {
        state.featureFlags.offscreenOptimization = true;

        const { wrapper, section } = makeWrapper("5");
        mockSectionHeight(section, 190);
        state.observedContainer.appendChild(wrapper);

        const markdown = document.createElement("div");
        markdown.className = "markdown";
        section.appendChild(markdown);

        const nestedSection = document.createElement("section");
        nestedSection.setAttribute("data-testid", "conversation-turn-nested");
        nestedSection.setAttribute("data-turn", "assistant");
        mockSectionHeight(nestedSection, 230);

        const mutation = {
            type: "childList",
            target: markdown,
            addedNodes: [nestedSection],
            removedNodes: [],
        };

        handleObservedMutations([mutation], {
            scheduleAutoPrune: vi.fn(),
            getDidInitialPrune: () => true,
            bootstrapInitialPrune: vi.fn(),
        });

        expect(nestedSection.hasAttribute(SECTION_ATTR)).toBe(false);
    });
});
