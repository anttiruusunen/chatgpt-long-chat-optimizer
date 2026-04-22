import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/content/offscreen/offscreenCodeBlocks.js", async () => {
    const actual = await vi.importActual(
        "../../src/content/offscreen/offscreenCodeBlocks.js"
    );

    return {
        ...actual,
        refreshObservedCodeBlocks: vi.fn(),
        resetCodeBlockOptimization: vi.fn(),
        configureCodeBlockOptimization: vi.fn(),
    };
});

import {
    refreshObservedSections,
    setOffscreenOptimizationEnabled,
} from "../../src/content/offscreen/offscreen.js";
import { state } from "../../src/content/core/state.js";

function createConversationDom() {
    document.body.innerHTML = `
        <main>
            <div id="scroll-root" style="overflow-y:auto; max-height:600px;">
                <div id="conversation">
                    <section data-testid="conversation-turn-1" data-turn="user">
                        <div>User</div>
                    </section>
                    <section data-testid="conversation-turn-2" data-turn="assistant">
                        <div>Assistant 1</div>
                    </section>
                    <section data-testid="conversation-turn-3" data-turn="assistant">
                        <div>Assistant latest</div>
                    </section>
                </div>
            </div>
        </main>
    `;
}

function getOlderAssistant() {
    return document.querySelector(
        'section[data-testid="conversation-turn-2"]'
    );
}

function getLatestAssistant() {
    return document.querySelector(
        'section[data-testid="conversation-turn-3"]'
    );
}

describe("offscreen CSS-driven section mode", () => {
    beforeEach(() => {
        vi.useFakeTimers();

        document.documentElement.removeAttribute(
            "data-thread-optimizer-sections-offscreen"
        );
        document.body.innerHTML = "";

        createConversationDom();

        state.featureFlags.offscreenOptimization = true;
        state.featureFlags.largeCodeBlockOptimization = false;
        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
        state.offscreenLiveSection = null;
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();

        document.documentElement.removeAttribute(
            "data-thread-optimizer-sections-offscreen"
        );
        document.body.innerHTML = "";
        state.offscreenLiveSection = null;
    });

    it("enables CSS-driven section mode on the root element", () => {
        setOffscreenOptimizationEnabled(true);

        expect(
            document.documentElement.getAttribute(
                "data-thread-optimizer-sections-offscreen"
            )
        ).toBe("true");
    });

    it("marks the latest assistant section as live during refresh", () => {
        refreshObservedSections();

        const latest = getLatestAssistant();

        expect(latest).not.toBeNull();
        expect(
            latest.getAttribute(
                "data-thread-optimizer-offscreen-live"
            )
        ).toBe("true");
    });

    it("clears previous live overrides before re-applying", () => {
        const older = getOlderAssistant();
        const latest = getLatestAssistant();

        older.setAttribute("data-thread-optimizer-offscreen-live", "true");
        latest.removeAttribute("data-thread-optimizer-offscreen-live");

        refreshObservedSections();

        expect(
            older.hasAttribute("data-thread-optimizer-offscreen-live")
        ).toBe(false);
        expect(
            latest.getAttribute("data-thread-optimizer-offscreen-live")
        ).toBe("true");
    });

    it("disabling removes the root CSS mode flag", () => {
        setOffscreenOptimizationEnabled(true);

        expect(
            document.documentElement.hasAttribute(
                "data-thread-optimizer-sections-offscreen"
            )
        ).toBe(true);

        setOffscreenOptimizationEnabled(false);

        expect(
            document.documentElement.hasAttribute(
                "data-thread-optimizer-sections-offscreen"
            )
        ).toBe(false);
    });

    it("disabling clears live section overrides", () => {
        refreshObservedSections();

        const latest = getLatestAssistant();
        expect(
            latest.hasAttribute(
                "data-thread-optimizer-offscreen-live"
            )
        ).toBe(true);

        setOffscreenOptimizationEnabled(false);

        expect(
            latest.hasAttribute(
                "data-thread-optimizer-offscreen-live"
            )
        ).toBe(false);
    });

    it("schedule path eventually applies live override", () => {
        setOffscreenOptimizationEnabled(true);

        vi.runAllTimers();

        const latest = getLatestAssistant();

        expect(
            latest.getAttribute(
                "data-thread-optimizer-offscreen-live"
            )
        ).toBe("true");
    });

    it("keeps the same live section pinned without clearing all sections on repeated refreshes", () => {
        const latestAssistant = getLatestAssistant();

        refreshObservedSections();
        expect(state.offscreenLiveSection).toBe(latestAssistant);
        expect(
            latestAssistant.getAttribute("data-thread-optimizer-offscreen-live")
        ).toBe("true");

        refreshObservedSections();
        expect(state.offscreenLiveSection).toBe(latestAssistant);
        expect(
            latestAssistant.getAttribute("data-thread-optimizer-offscreen-live")
        ).toBe("true");
    });
});