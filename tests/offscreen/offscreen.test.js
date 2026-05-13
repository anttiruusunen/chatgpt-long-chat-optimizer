import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushDomWriteBatchNow } from "../../src/content/core/domWriteBatch.js";

const mockRefs = vi.hoisted(() => ({
    isReplyStreaming: vi.fn(() => false),
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: mockRefs.isReplyStreaming,
}));

import {
    handleReplyStreamingStarted,
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

        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
        state.offscreenLiveSection = null;
    });

    it("enables browser-native section mode on the root element", () => {
        setOffscreenOptimizationEnabled(true);

        expect(document.documentElement.getAttribute(ROOT_ATTR)).toBe("true");
    });

    it("applies content-visibility markers and intrinsic sizes to mounted sections", () => {
        refreshObservedSections();

        for (const section of getSections()) {
            expect(section.getAttribute(SECTION_ATTR)).toBe("true");
            expect(section.getAttribute(HEIGHT_ATTR)).toMatch(/^\d+$/);
            expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toMatch(
                /^\d+px$/
            );
        }
    });

    it("does not apply legacy live-section overrides during refresh", () => {
        refreshObservedSections();

        for (const section of getSections()) {
            expect(section.hasAttribute(LEGACY_LIVE_ATTR)).toBe(false);
        }

        expect(state.offscreenLiveSection).toBe(null);
    });

    it("keeps cached intrinsic sizes stable on repeated refreshes", () => {
        const latest = getLatestAssistant();

        refreshObservedSections();

        expect(latest.getAttribute(HEIGHT_ATTR)).toBe("150");
        expect(latest.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("150px");

        Object.defineProperty(latest, "offsetHeight", {
            configurable: true,
            value: 240,
        });

        latest.getBoundingClientRect = vi.fn(() => ({
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

        expect(latest.getAttribute(HEIGHT_ATTR)).toBe("150");
        expect(latest.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("150px");
    });

    it("disabling removes the root CSS mode flag", () => {
        setOffscreenOptimizationEnabled(true);

        expect(document.documentElement.hasAttribute(ROOT_ATTR)).toBe(true);

        setOffscreenOptimizationEnabled(false);

        expect(document.documentElement.hasAttribute(ROOT_ATTR)).toBe(false);
    });

    it("disabling clears active browser-native offscreen section markers", () => {
        refreshObservedSections();

        for (const section of getSections()) {
            expect(section.getAttribute(SECTION_ATTR)).toBe("true");
            expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).not.toBe("");
        }

        setOffscreenOptimizationEnabled(false);

        for (const section of getSections()) {
            expect(section.hasAttribute(SECTION_ATTR)).toBe(false);
            expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toBe("");
            expect(section.hasAttribute(LEGACY_LIVE_ATTR)).toBe(false);

            // Height metadata is inert without SECTION_ATTR/root mode and can stay cached.
            expect(section.hasAttribute(HEIGHT_ATTR)).toBe(true);
        }
    });

    it("schedule path eventually applies browser-native section markers", () => {
        scheduleOffscreenRefresh({
            reason: "test-refresh",
        });

        flushDomWriteBatchNow();

        for (const section of getSections()) {
            expect(section.getAttribute(SECTION_ATTR)).toBe("true");
            expect(section.style.getPropertyValue(INTRINSIC_SIZE_VAR)).toMatch(
                /^\d+px$/
            );
        }
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
});