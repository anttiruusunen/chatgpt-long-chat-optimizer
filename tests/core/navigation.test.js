import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installConversationNavigationWatcher,
    resetConversationNavigationWatcherForTests,
} from "../../src/content/core/navigation.js";

describe("core/navigation", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        resetConversationNavigationWatcherForTests();
        history.replaceState({}, "", "/");
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetConversationNavigationWatcherForTests();
        document.body.innerHTML = "";
        history.replaceState({}, "", "/");
    });

    it("notifies on pushState route changes", () => {
        const onNavigationDetected = vi.fn();

        installConversationNavigationWatcher({ onNavigationDetected });

        history.pushState({}, "", "/c/chat-1");
        vi.runAllTimers();

        expect(onNavigationDetected).toHaveBeenCalledTimes(1);
        expect(onNavigationDetected).toHaveBeenCalledWith({
            reason: "pushState",
            locationKey: "/c/chat-1",
        });
    });

    it("notifies on replaceState route changes", () => {
        const onNavigationDetected = vi.fn();

        installConversationNavigationWatcher({ onNavigationDetected });

        history.replaceState({}, "", "/c/chat-2");
        vi.runAllTimers();

        expect(onNavigationDetected).toHaveBeenCalledTimes(1);
        expect(onNavigationDetected).toHaveBeenCalledWith({
            reason: "replaceState",
            locationKey: "/c/chat-2",
        });
    });

    it("uses sidebar clicks as an early navigation hint", () => {
        const onNavigationDetected = vi.fn();

        installConversationNavigationWatcher({ onNavigationDetected });

        const link = document.createElement("a");
        link.setAttribute("data-sidebar-item", "true");
        link.href = "/c/chat-from-sidebar";
        link.addEventListener("click", (event) => {
            event.preventDefault();
        });
        document.body.appendChild(link);

        link.dispatchEvent(
            new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
            })
        );

        vi.advanceTimersByTime(149);
        expect(onNavigationDetected).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onNavigationDetected).toHaveBeenCalledTimes(1);
        expect(onNavigationDetected).toHaveBeenCalledWith({
            reason: "sidebar-click",
            locationKey: "/",
        });
    });

    it("does not notify for non-sidebar clicks", () => {
        const onNavigationDetected = vi.fn();

        installConversationNavigationWatcher({ onNavigationDetected });

        const button = document.createElement("button");
        document.body.appendChild(button);

        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        vi.runAllTimers();

        expect(onNavigationDetected).not.toHaveBeenCalled();
    });

    it("suppresses duplicate scheduled checks while one is pending", () => {
        const onNavigationDetected = vi.fn();

        installConversationNavigationWatcher({ onNavigationDetected });

        history.pushState({}, "", "/c/chat-1");
        history.replaceState({}, "", "/c/chat-2");
        vi.runAllTimers();

        expect(onNavigationDetected).toHaveBeenCalledTimes(1);
    });
});