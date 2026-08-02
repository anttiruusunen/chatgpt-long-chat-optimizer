import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushDomWriteBatchNow } from "../../src/content/core/domWriteBatch.js";
import { resetConversationDomCacheForTests } from "../../src/content/core/dom.js";

const mockRefs = vi.hoisted(() => ({
    isReplyStreaming: vi.fn(() => false),
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: mockRefs.isReplyStreaming,
}));

import {
    handleReplyStreamingStarted,
    optimizeAddedConversationNodes,
    optimizeUnoptimizedConversationSections,
    refreshObservedSections,
    scheduleOffscreenRefresh,
    setOffscreenOptimizationEnabled,
} from "../../src/content/offscreen/offscreen.js";
import { state } from "../../src/content/core/state.js";

const ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const SECTION_ATTR = "data-thread-optimizer-offscreen-opt";
const HEIGHT_ATTR = "data-thread-optimizer-height";
const INTRINSIC_SIZE_VAR = "--thread-optimizer-section-intrinsic-size";
const LEGACY_LIVE_ATTR = "data-thread-optimizer-offscreen-live";

function createConversationDom() {
    document.body.innerHTML = `
        <main>
            <div id="scroll-root" style="overflow-y:auto; max-height:600px;">
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        <div style="height: 80px;">User</div>
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        <div style="height: 120px;">Assistant 1</div>
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="assistant">
                        <div style="height: 160px;">Assistant latest</div>
                    </section>
                </div>
            </div>
        </main>
    `;
}

function getSections() {
    return Array.from(
        document.querySelectorAll('section[data-testid^="conversation-turn-"]')
    );
}

function getLatestAssistant() {
    return document.querySelector(
        'section[data-testid="conversation-turn-3"]'
    );
}

function mockSectionHeights() {
    for (const [index, section] of getSections().entries()) {
        Object.defineProperty(section, "offsetHeight", {
            configurable: true,
            value: 100 + index * 25,
        });

        section.getBoundingClientRect = vi.fn(() => ({
            width: 800,
            height: 100 + index * 25,
            top: index * 100,
            right: 800,
            bottom: index * 100 + 100,
            left: 0,
            x: 0,
            y: index * 100,
            toJSON: () => {},
        }));
    }
}

describe("offscreen browser-native section mode", () => {
    beforeEach(() => {
        mockRefs.isReplyStreaming.mockReturnValue(false);
        vi.useFakeTimers();

        document.documentElement.removeAttribute(ROOT_ATTR);
        document.body.innerHTML = "";
        resetConversationDomCacheForTests();

        createConversationDom();
        mockSectionHeights();

        state.featureFlags.offscreenOptimization = true;
        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
        state.offscreenLiveSection = null;
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();

        document.documentElement.removeAttribute(ROOT_ATTR);
        document.body.innerHTML = "";
        resetConversationDomCacheForTests();

        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
        state.offscreenLiveSection = null;
    });

    it("enables browser-native section mode on the root element", () => {
        setOffscreenOptimizationEnabled(true);

        expect(document.documentElement.getAttribute(ROOT_ATTR)).toBe("true");
    });

    it("applies content-visibility markers only to sections outside the newest exchange", () => {
        refreshObservedSections();

        const sections = getSections();

        expect(sections[0].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[1].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[1].getAttribute(HEIGHT_ATTR)).toMatch(/^\d+$/);
        expect(sections[1].style.getPropertyValue(INTRINSIC_SIZE_VAR)).toMatch(
            /^\d+px$/
        );
        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
    });

    it("does not apply legacy live-section overrides during refresh", () => {
        refreshObservedSections();

        for (const section of getSections()) {
            expect(section.hasAttribute(LEGACY_LIVE_ATTR)).toBe(false);
        }

        expect(state.offscreenLiveSection).toBe(null);
    });

    it("optimizes a newly added conversation section when it is not part of the newest exchange", () => {
        refreshObservedSections();

        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-turn-id-container", "4");

        const section = document.createElement("section");
        section.setAttribute("data-testid", "conversation-turn-4");
        section.setAttribute("data-turn", "assistant");
        section.textContent = "Older inserted assistant";

        Object.defineProperty(section, "offsetHeight", {
            configurable: true,
            value: 220,
        });

        section.getBoundingClientRect = vi.fn(() => ({
            width: 800,
            height: 220,
            top: 200,
            right: 800,
            bottom: 420,
            left: 0,
            x: 0,
            y: 200,
            toJSON: () => {},
        }));

        wrapper.appendChild(section);

        const latest = getLatestAssistant();
        document.getElementById("conversation").insertBefore(wrapper, latest);

        expect(section.hasAttribute(SECTION_ATTR)).toBe(false);

        const optimizedCount = optimizeAddedConversationNodes(
            [wrapper],
            "test-added-node"
        );

        expect(optimizedCount).toBe(1);
        expect(section.getAttribute(SECTION_ATTR)).toBe("true");
        expect(section.getAttribute(HEIGHT_ATTR)).toBe("220");
        expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("220px");
    });

    it("reconciles only unoptimized sections outside the newest exchange", () => {
        refreshObservedSections();

        const existingSections = getSections();
        const optimizedExisting = existingSections[1];
        const beforeHeight = optimizedExisting.getAttribute(HEIGHT_ATTR);

        const section = document.createElement("section");
        section.setAttribute("data-testid", "conversation-turn-4");
        section.setAttribute("data-turn", "assistant");
        section.textContent = "Nested older assistant";

        Object.defineProperty(section, "offsetHeight", {
            configurable: true,
            value: 260,
        });

        section.getBoundingClientRect = vi.fn(() => ({
            width: 800,
            height: 260,
            top: 200,
            right: 800,
            bottom: 460,
            left: 0,
            x: 0,
            y: 200,
            toJSON: () => {},
        }));

        const nestedWrapper = document.createElement("div");
        nestedWrapper.appendChild(section);

        const latest = getLatestAssistant();
        document.getElementById("conversation").insertBefore(nestedWrapper, latest);

        expect(section.hasAttribute(SECTION_ATTR)).toBe(false);

        const optimizedCount = optimizeUnoptimizedConversationSections(
            "test-reconcile"
        );

        expect(optimizedCount).toBe(1);
        expect(section.getAttribute(SECTION_ATTR)).toBe("true");
        expect(section.getAttribute(HEIGHT_ATTR)).toBe("260");
        expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("260px");
        expect(optimizedExisting.getAttribute(HEIGHT_ATTR)).toBe(beforeHeight);
    });

    it("keeps cached intrinsic sizes stable on repeated refreshes for optimized older sections", () => {
        const olderAssistant = getSections()[1];

        refreshObservedSections();

        expect(olderAssistant.getAttribute(HEIGHT_ATTR)).toBe("125");
        expect(olderAssistant.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe(
            "125px"
        );

        Object.defineProperty(olderAssistant, "offsetHeight", {
            configurable: true,
            value: 240,
        });

        olderAssistant.getBoundingClientRect = vi.fn(() => ({
            width: 800,
            height: 240,
            top: 0,
            right: 800,
            bottom: 240,
            left: 0,
            x: 0,
            y: 0,
            toJSON: () => {},
        }));

        refreshObservedSections();

        expect(olderAssistant.getAttribute(HEIGHT_ATTR)).toBe("125");
        expect(olderAssistant.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe(
            "125px"
        );
    });

    it("disabling removes the root CSS mode flag", () => {
        setOffscreenOptimizationEnabled(true);

        expect(document.documentElement.hasAttribute(ROOT_ATTR)).toBe(true);

        setOffscreenOptimizationEnabled(false);

        expect(document.documentElement.hasAttribute(ROOT_ATTR)).toBe(false);
    });

    it("disabling clears active browser-native offscreen section markers", () => {
        refreshObservedSections();

        const sections = getSections();

        expect(sections[0].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[1].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[1].style.getPropertyValue(INTRINSIC_SIZE_VAR)).not.toBe("");
        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);

        setOffscreenOptimizationEnabled(false);

        for (const section of sections) {
            expect(section.hasAttribute(SECTION_ATTR)).toBe(false);
            expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("");
            expect(section.hasAttribute(LEGACY_LIVE_ATTR)).toBe(false);
        }

        // Height metadata is inert without SECTION_ATTR/root mode and can stay cached.
        expect(sections[1].hasAttribute(HEIGHT_ATTR)).toBe(true);
    });

    it("schedule path eventually optimizes only sections outside the newest exchange", () => {
        scheduleOffscreenRefresh({
            reason: "test-refresh",
        });

        flushDomWriteBatchNow();

        const sections = getSections();

        expect(sections[0].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[1].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[1].style.getPropertyValue(INTRINSIC_SIZE_VAR)).toMatch(
            /^\d+px$/
        );
        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
    });

    it("does not schedule refresh work when offscreen optimization is disabled", () => {
        state.featureFlags.offscreenOptimization = false;

        scheduleOffscreenRefresh({
            reason: "disabled",
        });

        flushDomWriteBatchNow();

        for (const section of getSections()) {
            expect(section.hasAttribute(SECTION_ATTR)).toBe(false);
        }

        expect(state.isOffscreenRefreshScheduled).toBe(false);
    });

    it("reply streaming start does not pin a legacy live section", () => {
        mockRefs.isReplyStreaming.mockReturnValue(true);

        handleReplyStreamingStarted();

        const latest = getLatestAssistant();

        expect(latest.hasAttribute(LEGACY_LIVE_ATTR)).toBe(false);
        expect(state.offscreenLiveSection).toBe(null);
    });

    it("never applies browser-native offscreen optimization to the newest exchange during a full refresh", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        Old user
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Old assistant
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="user">
                        Latest user
                    </section>
                    <section data-testid="conversation-turn-4" data-turn="assistant" data-scroll-anchor="true">
                        Latest assistant
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        const sections = getSections();

        refreshObservedSections();

        expect(sections[0].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[1].getAttribute(SECTION_ATTR)).toBe("true");

        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[3].hasAttribute(SECTION_ATTR)).toBe(false);
    });

    it("clears existing offscreen markers from the newest exchange during full refresh", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        Old user
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Old assistant
                    </section>
                    <section
                        data-testid="conversation-turn-3"
                        data-turn="user"
                        data-thread-optimizer-offscreen-opt="true"
                        style="--thread-optimizer-section-intrinsic-size: 200px;"
                    >
                        Latest user
                    </section>
                    <section
                        data-testid="conversation-turn-4"
                        data-turn="assistant"
                        data-scroll-anchor="true"
                        data-thread-optimizer-offscreen-opt="true"
                        style="--thread-optimizer-section-intrinsic-size: 220px;"
                    >
                        Latest assistant
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        const sections = getSections();

        refreshObservedSections();

        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[2].style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("");

        expect(sections[3].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[3].style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("");
    });

    it("does not optimize a newly added latest assistant section", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        Old user
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Old assistant
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="user">
                        Latest user
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-turn-id-container", "4");

        const section = document.createElement("section");
        section.setAttribute("data-testid", "conversation-turn-4");
        section.setAttribute("data-turn", "assistant");
        section.setAttribute("data-scroll-anchor", "true");
        section.textContent = "Streaming assistant";

        Object.defineProperty(section, "offsetHeight", {
            configurable: true,
            value: 220,
        });

        section.getBoundingClientRect = vi.fn(() => ({
            width: 800,
            height: 220,
            top: 300,
            right: 800,
            bottom: 520,
            left: 0,
            x: 0,
            y: 300,
            toJSON: () => {},
        }));

        wrapper.appendChild(section);
        document.getElementById("conversation").appendChild(wrapper);

        const optimizedCount = optimizeAddedConversationNodes(
            [wrapper],
            "test-newest-assistant"
        );

        expect(optimizedCount).toBe(0);
        expect(section.hasAttribute(SECTION_ATTR)).toBe(false);
        expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("");
    });

    it("does not reconcile the newest assistant section after reply settlement", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        Old user
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Old assistant
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="user">
                        Latest user
                    </section>
                    <section data-testid="conversation-turn-4" data-turn="assistant" data-scroll-anchor="true">
                        Latest assistant
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        const sections = getSections();

        const optimizedCount = optimizeUnoptimizedConversationSections(
            "reply-settled"
        );

        expect(optimizedCount).toBe(2);

        expect(sections[0].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[1].getAttribute(SECTION_ATTR)).toBe("true");

        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[3].hasAttribute(SECTION_ATTR)).toBe(false);
    });

    it("removes stale offscreen optimization from the newest exchange during reconciliation", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        Old user
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Old assistant
                    </section>
                    <section
                        data-testid="conversation-turn-3"
                        data-turn="user"
                        data-thread-optimizer-offscreen-opt="true"
                        style="--thread-optimizer-section-intrinsic-size: 200px;"
                    >
                        Latest user
                    </section>
                    <section
                        data-testid="conversation-turn-4"
                        data-turn="assistant"
                        data-scroll-anchor="true"
                        data-thread-optimizer-offscreen-opt="true"
                        style="--thread-optimizer-section-intrinsic-size: 220px;"
                    >
                        Latest assistant
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        refreshObservedSections();

        const sections = getSections();

        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[3].hasAttribute(SECTION_ATTR)).toBe(false);
    });

    it("allows a previously protected exchange to become optimized after a newer exchange mounts", () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        User 1
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        Assistant 1
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="user">
                        User 2
                    </section>
                    <section data-testid="conversation-turn-4" data-turn="assistant" data-scroll-anchor="true">
                        Assistant 2
                    </section>
                </div>
            </main>
        `;

        mockSectionHeights();

        refreshObservedSections();

        let sections = getSections();

        expect(sections[2].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[3].hasAttribute(SECTION_ATTR)).toBe(false);

        sections[3].removeAttribute("data-scroll-anchor");

        const user3 = document.createElement("section");
        user3.setAttribute("data-testid", "conversation-turn-5");
        user3.setAttribute("data-turn", "user");

        const assistant3 = document.createElement("section");
        assistant3.setAttribute("data-testid", "conversation-turn-6");
        assistant3.setAttribute("data-turn", "assistant");
        assistant3.setAttribute("data-scroll-anchor", "true");

        document.getElementById("conversation").appendChild(user3);
        document.getElementById("conversation").appendChild(assistant3);

        resetConversationDomCacheForTests();
        mockSectionHeights();

        refreshObservedSections();

        sections = getSections();

        expect(sections[2].getAttribute(SECTION_ATTR)).toBe("true");
        expect(sections[3].getAttribute(SECTION_ATTR)).toBe("true");

        expect(sections[4].hasAttribute(SECTION_ATTR)).toBe(false);
        expect(sections[5].hasAttribute(SECTION_ATTR)).toBe(false);
    });

});
