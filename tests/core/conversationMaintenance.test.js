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

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: vi.fn(),
}));

import {
    configureConversationMaintenance,
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

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("syncs browser-native offscreen mode even when there are no sections", () => {
        conversationSectionsMock = [];

        scheduleConversationChromeSync({
            reason: "empty",
            forceCss: true,
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("does not defer browser-native offscreen mode during streaming", () => {
        isReplyStreamingMock = true;

        scheduleConversationChromeSync({
            reason: "streaming",
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("does not run post-prune offscreen refresh for conversation chrome sync", () => {
        scheduleConversationChromeSync({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });

    it("refreshes offscreen state during post-prune refresh", () => {
        scheduleRefreshPostPruneState();
        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });

    it("uses the same offscreen refresh path while streaming", () => {
        isReplyStreamingMock = true;

        scheduleRefreshPostPruneState();
        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
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

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();

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

    it("keeps explicit post-prune refresh separate from ordinary chrome sync", () => {
        scheduleConversationChromeSync({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();

        ensureSectionCssOffscreenModeMock.mockClear();
        scheduleOffscreenRefreshMock.mockClear();

        scheduleRefreshPostPruneState({
            reason: "explicit-post-prune-refresh",
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });

    it("coalesces chrome sync and post-prune refresh without running a full offscreen refresh", () => {
        scheduleConversationChromeSync({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });

        scheduleRefreshPostPruneState({
            reason: "store-prune-completed",
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(2);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });

    it("does not run full offscreen refresh when repeated chrome syncs are scheduled", () => {
        scheduleConversationChromeSync({
            reason: "reply-settled",
            forceCss: true,
            includeStreaming: true,
        });

        scheduleConversationChromeSync({
            reason: "storage-changed",
            forceCss: true,
            includeStreaming: true,
        });

        scheduleConversationChromeSync({
            reason: "manual-refresh",
            forceCss: true,
            includeStreaming: true,
        });

        flushDomWriteBatchNow();

        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).not.toHaveBeenCalled();
    });
});