import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installConversationNavigationWatcher,
    resetConversationNavigationWatcherForTests,
} from "../../src/content/core/navigation.js";

function dispatchClick(element) {
    element.dispatchEvent(
        new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
        })
    );
}

describe("navigation watcher", () => {
    let callback;

    beforeEach(() => {
        document.body.innerHTML = "";
        resetConversationNavigationWatcherForTests();
        history.replaceState({}, "", "/");
        vi.useFakeTimers();

        callback = vi.fn();

        installConversationNavigationWatcher({
            onNavigationDetected: callback,
        });
    });

    afterEach(() => {
        resetConversationNavigationWatcherForTests();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        document.body.innerHTML = "";
        history.replaceState({}, "", "/");
    });

    it("detects conversation links with data-sidebar-item", () => {
        const link = document.createElement("a");
        link.setAttribute("data-sidebar-item", "true");
        link.href = "/c/test-1";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(200);

        expect(callback).toHaveBeenCalledWith({
            reason: "conversation-link-click",
            locationKey: "/",
        });
    });

    it("detects conversation links via /c/ href without data-sidebar-item", () => {
        const link = document.createElement("a");
        link.href = "/c/test-conversation";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(200);

        expect(callback).toHaveBeenCalledWith({
            reason: "conversation-link-click",
            locationKey: "/",
        });
    });

    it("does not trigger for non-conversation links", () => {
        const link = document.createElement("a");
        link.href = "/settings";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(1000);

        expect(callback).not.toHaveBeenCalled();
    });

    it("runs both immediate and follow-up checks after conversation link click", () => {
        const link = document.createElement("a");
        link.href = "/c/test-followup";
        document.body.appendChild(link);

        dispatchClick(link);

        vi.advanceTimersByTime(200);
        expect(callback).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(500);
        expect(callback).toHaveBeenCalledTimes(2);
    });

    it("handles pushState navigation", () => {
        history.pushState({}, "", "/c/push-test");

        vi.runOnlyPendingTimers();

        expect(callback).toHaveBeenCalledWith({
            reason: "pushState",
            locationKey: "/c/push-test",
        });
    });

    it("handles replaceState navigation", () => {
        history.replaceState({}, "", "/c/replace-test");

        vi.runOnlyPendingTimers();

        expect(callback).toHaveBeenCalledWith({
            reason: "replaceState",
            locationKey: "/c/replace-test",
        });
    });

    it("does not notify on popstate when the location key is unchanged", () => {
        window.dispatchEvent(new PopStateEvent("popstate"));

        vi.runOnlyPendingTimers();

        expect(callback).not.toHaveBeenCalled();
    });

    it("does not notify on hashchange when the location key is unchanged", () => {
        window.dispatchEvent(new HashChangeEvent("hashchange"));

        vi.runOnlyPendingTimers();

        expect(callback).not.toHaveBeenCalled();
    });

    it("clears all scheduled timers on reset", () => {
        const link = document.createElement("a");
        link.href = "/c/test-clear";
        document.body.appendChild(link);

        dispatchClick(link);

        resetConversationNavigationWatcherForTests();

        vi.advanceTimersByTime(1000);

        expect(callback).not.toHaveBeenCalled();
    });
});