import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    showInitialPruneOverlay,
    hideInitialPruneOverlay,
    resetInitialPruneOverlayForTests,
    isPruneOverlayActive,
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
        expect(card.textContent).toContain("Hiding older messages");
        expect(card.textContent).toContain(
            "Older turns are hidden from this page, not deleted from your saved chat."
        );
        expect(card.textContent).toContain("Hide");
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
        expect(card.textContent).toContain("Hiding older messages");
    });

    it("does not restore overlay nodes after a force hide stops the watchdog", async () => {
        const initialMain = document.createElement("main");
        document.body.appendChild(initialMain);

        showInitialPruneOverlay();

        document.body.innerHTML = "<main></main>";

        await vi.advanceTimersByTimeAsync(250);

        expect(isPruneOverlayActive()).toBe(true);
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeTruthy();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeTruthy();

        hideInitialPruneOverlay({
            force: true,
            reason: "test-route-cleanup",
        });

        expect(isPruneOverlayActive()).toBe(false);
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();

        document.body.appendChild(document.createElement("div"));

        await vi.advanceTimersByTimeAsync(500);

        expect(isPruneOverlayActive()).toBe(false);
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();
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

    it("lets the user hide an active overlay without waiting for prune completion", async () => {
        showInitialPruneOverlay();

        document
            .querySelector(
                "#long-chat-optimizer-prune-overlay-card .long-chat-optimizer-prune-hide"
            )
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();

        await vi.advanceTimersByTimeAsync(250);

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeNull();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeNull();
    });

    it("can show the overlay again after the user hides a previous one", () => {
        showInitialPruneOverlay();

        document
            .querySelector(
                "#long-chat-optimizer-prune-overlay-card .long-chat-optimizer-prune-hide"
            )
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        showInitialPruneOverlay();

        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeTruthy();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeTruthy();
    });

    it("tracks active overlay state across manual hide and later show", () => {
        expect(isPruneOverlayActive()).toBe(false);

        showInitialPruneOverlay();

        expect(isPruneOverlayActive()).toBe(true);

        document
            .querySelector(
                "#long-chat-optimizer-prune-overlay-card .long-chat-optimizer-prune-hide"
            )
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(isPruneOverlayActive()).toBe(false);

        showInitialPruneOverlay();

        expect(isPruneOverlayActive()).toBe(true);
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay")
        ).toBeTruthy();
        expect(
            document.getElementById("long-chat-optimizer-prune-overlay-card")
        ).toBeTruthy();
    });
});