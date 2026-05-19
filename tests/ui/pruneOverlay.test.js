import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    showInitialPruneOverlay,
    hideInitialPruneOverlay,
    resetInitialPruneOverlayForTests,
} from "../../src/content/ui/pruneOverlay.js";

describe("prune overlay", () => {
    beforeEach(() => {
        document.documentElement.innerHTML = "<head></head><body></body>";
        resetInitialPruneOverlayForTests();
    });

    afterEach(() => {
        resetInitialPruneOverlayForTests();
        document.documentElement.innerHTML = "<head></head><body></body>";
    });

    it("shows the initial prune overlay", () => {
        showInitialPruneOverlay();

        const overlay = document.getElementById(
            "long-chat-optimizer-prune-overlay"
        );

        expect(overlay).toBeTruthy();
        expect(overlay.textContent).toContain("Optimizing chat");
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-style")
        ).toBeTruthy();
    });

    it("hides the overlay when pruning completes", () => {
        showInitialPruneOverlay();
        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
    });

    it("keeps the overlay until all active initial prune scopes end", () => {
        showInitialPruneOverlay();
        showInitialPruneOverlay();

        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeTruthy();

        hideInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
    });
});