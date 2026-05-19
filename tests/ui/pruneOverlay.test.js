import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    showInitialPruneOverlay,
    hideInitialPruneOverlay,
    resetInitialPruneOverlayForTests,
} from "../../src/content/ui/pruneOverlay.js";

describe("prune overlay", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.documentElement.innerHTML = "<head></head><body></body>";
        resetInitialPruneOverlayForTests();
    });

    afterEach(() => {
        resetInitialPruneOverlayForTests();
        document.documentElement.innerHTML = "<head></head><body></body>";
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("shows the initial prune overlay", () => {
        showInitialPruneOverlay();

        const overlay = document.getElementById(
            "long-chat-optimizer-prune-overlay"
        );
        const card = document.getElementById(
            "long-chat-optimizer-prune-overlay-card"
        );

        expect(overlay).toBeTruthy();
        expect(card).toBeTruthy();
        expect(card.textContent).toContain("Clearing old messages");
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-style")
        ).toBeTruthy();
    });

    it("restores overlay nodes if the host app removes them while active", async () => {
        showInitialPruneOverlay();

        document
            .getElementById("long-chat-optimizer-prune-overlay")
            ?.remove();
        document
            .getElementById("long-chat-optimizer-prune-overlay-card")
            ?.remove();

        await vi.advanceTimersByTimeAsync(250);

        const overlay = document.getElementById(
            "long-chat-optimizer-prune-overlay"
        );
        const card = document.getElementById(
            "long-chat-optimizer-prune-overlay-card"
        );

        expect(overlay).toBeTruthy();
        expect(card).toBeTruthy();
        expect(card.textContent).toContain("Clearing old messages");
    });

    it("hides the overlay when pruning completes", () => {
        showInitialPruneOverlay();
        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();
    });

    it("keeps the overlay until all active initial prune scopes end", () => {
        showInitialPruneOverlay();
        showInitialPruneOverlay();

        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeTruthy();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeTruthy();

        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();
    });
});