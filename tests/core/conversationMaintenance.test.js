import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    resetDomWriteBatchForTests,
    flushDomWriteBatchNow,
} from "../../src/content/core/domWriteBatch.js";

let conversationSectionsMock = [];
let isReplyStreamingMock = false;

const ensureSectionCssOffscreenModeMock = vi.fn();
const scheduleOffscreenRefreshMock = vi.fn();
const syncCssVisibilityWindowMock = vi.fn();

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationSections: vi.fn(() => conversationSectionsMock),
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    ensureSectionCssOffscreenMode: vi.fn((...args) =>
        ensureSectionCssOffscreenModeMock(...args)
    ),
    scheduleOffscreenRefresh: vi.fn((...args) =>
        scheduleOffscreenRefreshMock(...args)
    ),
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: vi.fn(() => isReplyStreamingMock),
}));

vi.mock("../../src/content/pruning/cssVisibilityWindow.js", () => ({
    syncCssVisibilityWindow: vi.fn((...args) =>
        syncCssVisibilityWindowMock(...args)
    ),
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: vi.fn(),
}));

import {
    configureConversationMaintenance,
    flushDeferredCssVisibilityWindowSync,
    resetConversationMaintenanceForTests,
    scheduleConversationChromeSync,
    scheduleRefreshPostPruneState,
} from "../../src/content/core/conversationMaintenance.js";

function makeSection(id) {
    const section = document.createElement("section");
    section.setAttribute("data-testid", `conversation-turn-${id}`);
    return section;
}

describe("conversationMaintenance", () => {
    const originalRAF = globalThis.requestAnimationFrame;

    beforeEach(() => {
        resetDomWriteBatchForTests();
        resetConversationMaintenanceForTests();

        conversationSectionsMock = [makeSection("1"), makeSection("2")];
        isReplyStreamingMock = false;

        state.featureFlags.offscreenOptimization = true;

        ensureSectionCssOffscreenModeMock.mockReset();
        scheduleOffscreenRefreshMock.mockReset();
        syncCssVisibilityWindowMock.mockReset();

        globalThis.requestAnimationFrame = (callback) => {
            callback(performance.now());
            return 1;
        };

        configureConversationMaintenance({
            ensureObserverAttached: vi.fn(() => true),
            withDomMutationGuard: (fn) => fn(),
        });
    });

    afterEach(() => {
        resetDomWriteBatchForTests();
        resetConversationMaintenanceForTests();
        globalThis.requestAnimationFrame = originalRAF;
    });

    it("coalesces conversation chrome sync requests into one DOM write batch", () => {
        scheduleConversationChromeSync({
            reason: "first",
            includeStreaming: true,
        });

        scheduleConversationChromeSync({
            reason: "second",
            forceCss: true,
        });

        flushDomWriteBatchNow();

        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("syncs CSS visibility even when there are no sections", () => {
        conversationSectionsMock = [];

        scheduleConversationChromeSync({
            reason: "empty",
            forceCss: true,
        });

        flushDomWriteBatchNow();

        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("defers CSS visibility sync during streaming and flushes it after settling", () => {
        isReplyStreamingMock = true;

        scheduleConversationChromeSync({
            reason: "streaming",
        });

        flushDomWriteBatchNow();

        expect(syncCssVisibilityWindowMock).not.toHaveBeenCalled();

        isReplyStreamingMock = false;
        flushDeferredCssVisibilityWindowSync("reply-settled");

        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
    });

    it("does not defer forced CSS visibility sync during streaming", () => {
        isReplyStreamingMock = true;

        scheduleConversationChromeSync({
            reason: "forced-streaming",
            forceCss: true,
        });

        flushDomWriteBatchNow();

        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes offscreen state during post-prune refresh", () => {
        scheduleRefreshPostPruneState();
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).toHaveBeenCalledTimes(1);
    });

    it("uses the same offscreen refresh path while streaming", () => {
        isReplyStreamingMock = true;

        scheduleRefreshPostPruneState();
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).toHaveBeenCalledTimes(1);
    });

    it("delays post-prune refresh when requested", () => {
        vi.useFakeTimers();

        scheduleRefreshPostPruneState({
            delayMs: 500,
            reason: "navigation-initial-prune-refresh",
        });

        vi.advanceTimersByTime(499);
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it("skips offscreen refresh work when offscreen optimization is disabled", () => {
        state.featureFlags.offscreenOptimization = false;

        scheduleConversationChromeSync({
            reason: "offscreen-disabled",
            forceCss: true,
            includeStreaming: true,
        });

        flushDomWriteBatchNow();

        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
        expect(ensureSectionCssOffscreenModeMock).not.toHaveBeenCalled();

        scheduleRefreshPostPruneState();
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });

    it("clears delayed post-prune refresh timers during reset", () => {
        vi.useFakeTimers();

        scheduleRefreshPostPruneState({
            delayMs: 500,
            reason: "delayed",
        });

        resetConversationMaintenanceForTests();

        vi.advanceTimersByTime(500);
        flushDomWriteBatchNow();

        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();

        vi.useRealTimers();
    });
});