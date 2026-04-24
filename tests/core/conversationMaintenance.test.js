import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    resetDomWriteBatchForTests,
    flushDomWriteBatchNow,
} from "../../src/content/core/domWriteBatch.js";

let conversationSectionsMock = [];
let isReplyStreamingMock = false;

const ensurePlaceholderStateMock = vi.fn();
const removePlaceholderMock = vi.fn();
const ensureTopRestoreSentinelStateMock = vi.fn();
const ensureBottomPruneSentinelStateMock = vi.fn();
const ensureSectionCssOffscreenModeMock = vi.fn();
const scheduleOffscreenRefreshMock = vi.fn();
const syncStreamingSectionStateMock = vi.fn();
const disconnectSentinelObserversMock = vi.fn();
const invalidateSentinelObserversForRootChangeMock = vi.fn();
const refreshTopRestoreSentinelObservationMock = vi.fn();
const refreshBottomPruneSentinelObservationMock = vi.fn();
const syncCssVisibilityWindowMock = vi.fn();

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationSections: vi.fn(() => conversationSectionsMock),
}));

vi.mock("../../src/content/pruning/pruneUi.js", () => ({
    ensurePlaceholderState: vi.fn((...args) =>
        ensurePlaceholderStateMock(...args)
    ),
    removePlaceholder: vi.fn((...args) =>
        removePlaceholderMock(...args)
    ),
}));

vi.mock("../../src/content/pruning/pruneSentinels.js", () => ({
    ensureTopRestoreSentinelState: vi.fn((...args) =>
        ensureTopRestoreSentinelStateMock(...args)
    ),
    ensureBottomPruneSentinelState: vi.fn((...args) =>
        ensureBottomPruneSentinelStateMock(...args)
    ),
}));

vi.mock("../../src/content/offscreen/offscreen.js", () => ({
    ensureSectionCssOffscreenMode: vi.fn((...args) =>
        ensureSectionCssOffscreenModeMock(...args)
    ),
    scheduleOffscreenRefresh: vi.fn((...args) =>
        scheduleOffscreenRefreshMock(...args)
    ),
}));

vi.mock("../../src/content/streaming/streamingSection.js", () => ({
    syncStreamingSectionState: vi.fn((...args) =>
        syncStreamingSectionStateMock(...args)
    ),
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: vi.fn(() => isReplyStreamingMock),
}));

vi.mock("../../src/content/pruning/sentinelObservers.js", () => ({
    disconnectSentinelObservers: vi.fn((...args) =>
        disconnectSentinelObserversMock(...args)
    ),
    invalidateSentinelObserversForRootChange: vi.fn((...args) =>
        invalidateSentinelObserversForRootChangeMock(...args)
    ),
    refreshTopRestoreSentinelObservation: vi.fn((...args) =>
        refreshTopRestoreSentinelObservationMock(...args)
    ),
    refreshBottomPruneSentinelObservation: vi.fn((...args) =>
        refreshBottomPruneSentinelObservationMock(...args)
    ),
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

        state.hiddenCount = 2;
        state.featureFlags.streamingSectionHiding = true;

        ensurePlaceholderStateMock.mockReset();
        removePlaceholderMock.mockReset();
        ensureTopRestoreSentinelStateMock.mockReset();
        ensureBottomPruneSentinelStateMock.mockReset();
        ensureSectionCssOffscreenModeMock.mockReset();
        scheduleOffscreenRefreshMock.mockReset();
        syncStreamingSectionStateMock.mockReset();
        disconnectSentinelObserversMock.mockReset();
        invalidateSentinelObserversForRootChangeMock.mockReset();
        refreshTopRestoreSentinelObservationMock.mockReset();
        refreshBottomPruneSentinelObservationMock.mockReset();
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

        expect(ensurePlaceholderStateMock).toHaveBeenCalledTimes(1);
        expect(ensurePlaceholderStateMock).toHaveBeenCalledWith(
            conversationSectionsMock[0]
        );

        expect(ensureTopRestoreSentinelStateMock).toHaveBeenCalledTimes(1);
        expect(ensureTopRestoreSentinelStateMock).toHaveBeenCalledWith(
            conversationSectionsMock[0]
        );

        expect(ensureBottomPruneSentinelStateMock).toHaveBeenCalledTimes(1);
        expect(ensureBottomPruneSentinelStateMock).toHaveBeenCalledWith(
            conversationSectionsMock[1]
        );

        expect(syncStreamingSectionStateMock).toHaveBeenCalledTimes(1);
        expect(syncCssVisibilityWindowMock).toHaveBeenCalledTimes(1);
        expect(ensureSectionCssOffscreenModeMock).toHaveBeenCalledTimes(1);
    });

    it("removes the placeholder when there are no hidden sections", () => {
        state.hiddenCount = 0;

        scheduleConversationChromeSync({
            reason: "no-hidden",
        });

        flushDomWriteBatchNow();

        expect(removePlaceholderMock).toHaveBeenCalledTimes(1);
        expect(ensurePlaceholderStateMock).not.toHaveBeenCalled();
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

    it("refreshes sentinels and offscreen state during post-prune refresh", () => {
        scheduleRefreshPostPruneState();

        expect(invalidateSentinelObserversForRootChangeMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).toHaveBeenCalledTimes(1);
        expect(refreshTopRestoreSentinelObservationMock).toHaveBeenCalledTimes(1);
        expect(refreshBottomPruneSentinelObservationMock).toHaveBeenCalledTimes(1);
    });

    it("uses minimal post-prune refresh while streaming", () => {
        isReplyStreamingMock = true;

        scheduleRefreshPostPruneState();

        expect(disconnectSentinelObserversMock).toHaveBeenCalledTimes(1);
        expect(scheduleOffscreenRefreshMock).toHaveBeenCalledTimes(1);
        expect(refreshTopRestoreSentinelObservationMock).not.toHaveBeenCalled();
        expect(refreshBottomPruneSentinelObservationMock).not.toHaveBeenCalled();
    });
});