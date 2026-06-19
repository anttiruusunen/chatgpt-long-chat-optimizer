import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installConversationNavigationWatcher,
    resetConversationNavigationWatcherForTests,
    isChatRouteLocation,
    isNewChatRouteLocation,
    isExistingConversationRouteLocation,
    normalizeChatGptLocationPath,
} from "../../src/content/core/navigation.js";
import {
    dispatchClick,
} from "../utils/domEvents.js";

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

    it("detects New Chat button clicks", () => {
        const button = document.createElement("button");
        button.textContent = "New chat";
        document.body.appendChild(button);

        dispatchClick(button);

        vi.advanceTimersByTime(200);

        expect(callback).toHaveBeenCalledWith({
            reason: "new-chat-click",
            locationKey: "/",
        });
    });

    it("detects New Chat icon buttons by aria-label", () => {
        const button = document.createElement("button");
        button.setAttribute("aria-label", "New chat");
        document.body.appendChild(button);

        dispatchClick(button);

        vi.advanceTimersByTime(200);

        expect(callback).toHaveBeenCalledWith({
            reason: "new-chat-click",
            locationKey: "/",
        });
    });

    it("runs both immediate and follow-up checks after New Chat click", () => {
        const button = document.createElement("button");
        button.setAttribute("aria-label", "New chat");
        document.body.appendChild(button);

        dispatchClick(button);

        vi.advanceTimersByTime(200);
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenLastCalledWith({
            reason: "new-chat-click",
            locationKey: "/",
        });

        vi.advanceTimersByTime(500);
        expect(callback).toHaveBeenCalledTimes(2);
        expect(callback).toHaveBeenLastCalledWith({
            reason: "new-chat-click-followup",
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

    it("detects pushState route changes without requiring a click hint", () => {
        history.pushState({}, "", "/c/plain-route-change");

        vi.runOnlyPendingTimers();

        expect(callback).toHaveBeenCalledWith({
            reason: "pushState",
            locationKey: "/c/plain-route-change",
        });
    });
});

describe("ChatGPT route helpers", () => {
    it.each([
        ["/", true],
        ["/?model=gpt-5", true],
        ["/c/test-conversation", true],
        ["/c/test-conversation?model=gpt-5", true],
        ["/g/test-gpt/c/test-conversation", true],
        ["/pricing", false],
        ["/gpts", false],
        ["/settings", false],
        ["/auth/login", false],
        ["/share/test", false],
    ])("classifies %s as chat route: %s", (path, expected) => {
        expect(isChatRouteLocation(path)).toBe(expected);
    });

    it("classifies only root as new chat route", () => {
        expect(isNewChatRouteLocation("/")).toBe(true);
        expect(isNewChatRouteLocation("/?model=gpt-5")).toBe(true);
        expect(isNewChatRouteLocation("/c/test")).toBe(false);
        expect(isNewChatRouteLocation("/pricing")).toBe(false);
    });

    it("classifies conversation routes separately from non-chat pages", () => {
        expect(isExistingConversationRouteLocation("/c/test")).toBe(true);
        expect(isExistingConversationRouteLocation("/g/gpt-id/c/test")).toBe(true);
        expect(isExistingConversationRouteLocation("/")).toBe(false);
        expect(isExistingConversationRouteLocation("/gpts")).toBe(false);
    });

    it("normalizes location path without hash", () => {
        expect(normalizeChatGptLocationPath("/c/test?model=gpt-5#bottom")).toBe(
            "/c/test?model=gpt-5"
        );
    });
});