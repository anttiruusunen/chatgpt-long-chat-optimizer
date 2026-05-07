import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";

let conversationSectionsMock = [];
let latestAssistantMock = null;
let scrollContainerMock = null;
let isReplyStreamingMock = false;
let protectedVisibleSectionsMock = [];

let consumeTopRestoreIntentMock = vi.fn(() => false);
let consumeBottomPruneIntentMock = vi.fn(() => false);
const ensureScrollIntentListenerMock = vi.fn(() => true);

const restoreOneExchangeFromSoftPrunedMock = vi.fn();
const repruneOneExchangeFromVisibleProtectedMock = vi.fn();

vi.mock("../../src/content/core/dom.js", () => ({
    getConversationSections: vi.fn(() => conversationSectionsMock),
    getLatestAssistantSection: vi.fn(() => latestAssistantMock),
    getConversationScrollContainer: vi.fn(() => scrollContainerMock),
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: vi.fn(() => isReplyStreamingMock),
}));

vi.mock("../../src/content/pruning/prune.js", () => ({
    restoreOneExchangeFromSoftPruned: vi.fn((...args) =>
        restoreOneExchangeFromSoftPrunedMock(...args)
    ),
    repruneOneExchangeFromVisibleProtected: vi.fn((...args) =>
        repruneOneExchangeFromVisibleProtectedMock(...args)
    ),
}));

vi.mock("../../src/content/pruning/pruneSentinels.js", () => ({
    hasProtectedVisibleSections: vi.fn(() => protectedVisibleSectionsMock.length > 0),
}));

vi.mock("../../src/content/pruning/scrollIntent.js", () => ({
    ensureScrollIntentListener: vi.fn(() => ensureScrollIntentListenerMock()),
    consumeTopRestoreIntent: vi.fn(() => consumeTopRestoreIntentMock()),
    consumeBottomPruneIntent: vi.fn(() => consumeBottomPruneIntentMock()),
}));

import {
    refreshTopRestoreSentinelObservation,
    refreshBottomPruneSentinelObservation,
} from "../../src/content/pruning/sentinelObservers.js";

const originalIntersectionObserver = globalThis.IntersectionObserver;
const originalRAF = globalThis.requestAnimationFrame;

let intersectionObservers = [];

class FakeIntersectionObserver {
    constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observed = new Set();
        this.observe = vi.fn((target) => {
            this.observed.add(target);
        });
        this.unobserve = vi.fn((target) => {
            this.observed.delete(target);
        });
        this.disconnect = vi.fn(() => {
            this.observed.clear();
        });
        intersectionObservers.push(this);
    }

    trigger(entries) {
        this.callback(entries);
    }
}

function makeSection({ turn = null, testId = null, text = "" } = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn) {
        section.setAttribute("data-turn", turn);
    }

    if (testId) {
        section.setAttribute("data-testid", testId);
    }

    section.getBoundingClientRect = () => ({
        top: 0,
        bottom: 100,
        left: 0,
        right: 300,
        width: 300,
        height: 100,
        x: 0,
        y: 0,
        toJSON() {
            return {};
        },
    });

    return section;
}

function buildConversation() {
    document.body.innerHTML = "";

    const page = document.createElement("div");
    const scrollWrap = document.createElement("div");
    const conversation = document.createElement("div");

    scrollWrap.style.overflowY = "auto";

    Object.defineProperty(scrollWrap, "clientHeight", {
        configurable: true,
        value: 400,
    });

    let internalScrollHeight = 1200;
    Object.defineProperty(scrollWrap, "scrollHeight", {
        configurable: true,
        get() {
            return internalScrollHeight;
        },
        set(value) {
            internalScrollHeight = value;
        },
    });

    scrollWrap.getBoundingClientRect = () => ({
        top: 0,
        bottom: 400,
        left: 0,
        right: 300,
        width: 300,
        height: 400,
        x: 0,
        y: 0,
        toJSON() {
            return {};
        },
    });

    page.appendChild(scrollWrap);
    scrollWrap.appendChild(conversation);
    document.body.appendChild(page);

    const user1 = makeSection({
        turn: "user",
        testId: "conversation-turn-1",
        text: "User 1",
    });
    const assistant1 = makeSection({
        turn: "assistant",
        testId: "conversation-turn-2",
        text: "Assistant 1",
    });
    const user2 = makeSection({
        turn: "user",
        testId: "conversation-turn-3",
        text: "User 2",
    });
    const assistant2 = makeSection({
        turn: "assistant",
        testId: "conversation-turn-4",
        text: "Assistant 2",
    });

    conversation.appendChild(user1);
    conversation.appendChild(assistant1);
    conversation.appendChild(user2);
    conversation.appendChild(assistant2);

    conversationSectionsMock = [user1, assistant1, user2, assistant2];
    latestAssistantMock = assistant2;
    scrollContainerMock = scrollWrap;

    return {
        page,
        scrollWrap,
        conversation,
        user1,
        assistant1,
        user2,
        assistant2,
    };
}

function makeSentinel() {
    const sentinel = document.createElement("section");
    sentinel.getBoundingClientRect = () => ({
        top: 0,
        bottom: 1,
        left: 0,
        right: 300,
        width: 300,
        height: 1,
        x: 0,
        y: 0,
        toJSON() {
            return {};
        },
    });
    return sentinel;
}

async function flushTimersStepwise(steps = 5) {
    for (let i = 0; i < steps; i += 1) {
        await Promise.resolve();
        vi.runOnlyPendingTimers();
        await Promise.resolve();
    }
}

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";

    intersectionObservers = [];
    conversationSectionsMock = [];
    latestAssistantMock = null;
    scrollContainerMock = null;
    isReplyStreamingMock = false;
    protectedVisibleSectionsMock = [];

    consumeTopRestoreIntentMock = vi.fn(() => false);
    consumeBottomPruneIntentMock = vi.fn(() => false);
    ensureScrollIntentListenerMock.mockReset();
    ensureScrollIntentListenerMock.mockReturnValue(true);

    restoreOneExchangeFromSoftPrunedMock.mockReset();
    repruneOneExchangeFromVisibleProtectedMock.mockReset();

    restoreOneExchangeFromSoftPrunedMock.mockImplementation(() => {
        state.softPrunedSections = state.softPrunedSections.slice(0, -2);
        return {
            visibleSectionsChanged: true,
            restoredSectionsCount: 2,
        };
    });

    repruneOneExchangeFromVisibleProtectedMock.mockImplementation(() => {
        protectedVisibleSectionsMock = protectedVisibleSectionsMock.slice(2);
        return {
            visibleSectionsChanged: true,
            reprunedSectionsCount: 2,
        };
    });

    globalThis.IntersectionObserver = FakeIntersectionObserver;
    globalThis.requestAnimationFrame = (cb) => {
        cb(performance.now());
        return 1;
    };

    state.topRestoreSentinel = null;
    state.bottomPruneSentinel = null;
    state.topRestoreObserver = null;
    state.bottomPruneObserver = null;
    state.topRestoreObserverRoot = null;
    state.bottomPruneObserverRoot = null;
    state.isTopRestoreScheduled = false;
    state.isBottomPruneScheduled = false;
    state.isTopRestoreArmed = true;
    state.isBottomPruneArmed = true;
    state.isApplyingDomChanges = false;
    state.softPrunedSections = [];
    state.topRestoreUserArmed = false;
    state.bottomPruneUserArmed = false;
    state.topRestoreObservedSentinel = null;
    state.bottomPruneObservedSentinel = null;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.IntersectionObserver = originalIntersectionObserver;
    globalThis.requestAnimationFrame = originalRAF;
    document.body.innerHTML = "";
});

describe("sentinelObservers", () => {
    it("top sentinel restores one exchange when intersecting and top intent is available", async () => {
        buildConversation();

        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
        ];
        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        consumeTopRestoreIntentMock.mockReturnValue(true);

        refreshTopRestoreSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        expect(intersectionObservers.length).toBeGreaterThan(0);

        intersectionObservers[0].trigger([
            { target: state.topRestoreSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(restoreOneExchangeFromSoftPrunedMock).toHaveBeenCalledTimes(1);
        expect(consumeTopRestoreIntentMock).toHaveBeenCalled();
    });

    it("re-arms top restore when sentinel remains visible after a tiny restore", async () => {
        buildConversation();

        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
            document.createElement("section"),
            document.createElement("section"),
        ];

        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        consumeTopRestoreIntentMock.mockReturnValueOnce(true);

        refreshTopRestoreSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            {
                target: state.topRestoreSentinel,
                isIntersecting: true,
            },
        ]);

        expect(state.isTopRestoreArmed).toBe(false);

        await flushTimersStepwise(6);

        expect(restoreOneExchangeFromSoftPrunedMock).toHaveBeenCalledTimes(1);
        expect(state.softPrunedSections).toHaveLength(2);
        expect(state.isTopRestoreScheduled).toBe(false);
        expect(state.isTopRestoreSentinelVisible).toBe(true);

        // Regression: if the restored exchange is tiny, the sentinel can remain
        // visible and never emit a leave/re-enter cycle. We still need to re-arm
        // so the next explicit top-edge user intent can restore another exchange.
        expect(state.isTopRestoreArmed).toBe(true);
    });

    it("top sentinel does nothing when intersecting without top intent", async () => {
        buildConversation();

        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
        ];
        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        consumeTopRestoreIntentMock.mockReturnValue(false);

        refreshTopRestoreSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            { target: state.topRestoreSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(restoreOneExchangeFromSoftPrunedMock).not.toHaveBeenCalled();
        expect(consumeTopRestoreIntentMock).toHaveBeenCalled();
    });

    it("bottom sentinel reprunes one exchange when intersecting and bottom intent is available", async () => {
        const { user1, assistant1, scrollWrap } = buildConversation();

        protectedVisibleSectionsMock = [user1, assistant1];
        scrollWrap.scrollHeight = 1200;

        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        consumeBottomPruneIntentMock.mockReturnValue(true);

        refreshBottomPruneSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        expect(intersectionObservers.length).toBeGreaterThan(0);

        intersectionObservers[0].trigger([
            { target: state.bottomPruneSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(repruneOneExchangeFromVisibleProtectedMock).toHaveBeenCalledTimes(1);
        expect(consumeBottomPruneIntentMock).toHaveBeenCalled();
    });

    it("bottom sentinel does nothing when intersecting without bottom intent", async () => {
        const { user1, assistant1, scrollWrap } = buildConversation();

        protectedVisibleSectionsMock = [user1, assistant1];
        scrollWrap.scrollHeight = 1200;

        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        consumeBottomPruneIntentMock.mockReturnValue(false);

        refreshBottomPruneSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            { target: state.bottomPruneSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(repruneOneExchangeFromVisibleProtectedMock).not.toHaveBeenCalled();
        expect(consumeBottomPruneIntentMock).toHaveBeenCalled();
    });

    it("bottom sentinel can reprune even when there is no scrollable overflow if bottom intent is available", async () => {
        const { user1, assistant1, scrollWrap } = buildConversation();

        protectedVisibleSectionsMock = [user1, assistant1];
        scrollWrap.scrollHeight = 400;

        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        consumeBottomPruneIntentMock.mockReturnValue(true);

        refreshBottomPruneSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            { target: state.bottomPruneSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(repruneOneExchangeFromVisibleProtectedMock).toHaveBeenCalledTimes(1);
    });

    it("top sentinel does nothing while reply is streaming", async () => {
        buildConversation();

        isReplyStreamingMock = true;
        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
        ];
        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        consumeTopRestoreIntentMock.mockReturnValue(true);

        refreshTopRestoreSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        if (intersectionObservers[0]) {
            intersectionObservers[0].trigger([
                { target: state.topRestoreSentinel, isIntersecting: true },
            ]);
        }

        await flushTimersStepwise();

        expect(restoreOneExchangeFromSoftPrunedMock).not.toHaveBeenCalled();
    });

    it("bottom sentinel does nothing while reply is streaming", async () => {
        const { user1, assistant1 } = buildConversation();

        isReplyStreamingMock = true;
        protectedVisibleSectionsMock = [user1, assistant1];
        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        consumeBottomPruneIntentMock.mockReturnValue(true);

        refreshBottomPruneSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        if (intersectionObservers[0]) {
            intersectionObservers[0].trigger([
                { target: state.bottomPruneSentinel, isIntersecting: true },
            ]);
        }

        await flushTimersStepwise();

        expect(repruneOneExchangeFromVisibleProtectedMock).not.toHaveBeenCalled();
    });

    it("does not auto-continue top restore from visibility alone after one restore", async () => {
        buildConversation();

        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
            document.createElement("section"),
            document.createElement("section"),
        ];
        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        consumeTopRestoreIntentMock
            .mockReturnValueOnce(true)
            .mockReturnValue(false);

        refreshTopRestoreSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            { target: state.topRestoreSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise(6);

        expect(restoreOneExchangeFromSoftPrunedMock).toHaveBeenCalledTimes(1);
    });

    it("does not allow bottom reprune to run while top restore is already scheduled", async () => {
        const { user1, assistant1, scrollWrap } = buildConversation();

        protectedVisibleSectionsMock = [user1, assistant1];
        scrollWrap.scrollHeight = 1200;
        state.isTopRestoreScheduled = true;

        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        consumeBottomPruneIntentMock.mockReturnValue(true);

        refreshBottomPruneSentinelObservation({
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        });

        intersectionObservers[0].trigger([
            { target: state.bottomPruneSentinel, isIntersecting: true },
        ]);

        await flushTimersStepwise();

        expect(repruneOneExchangeFromVisibleProtectedMock).not.toHaveBeenCalled();
    });

    it("does not reconnect the top observer when root and sentinel are unchanged", () => {
        buildConversation();

        state.softPrunedSections = [
            document.createElement("section"),
            document.createElement("section"),
        ];
        state.topRestoreSentinel = makeSentinel();
        document.body.appendChild(state.topRestoreSentinel);

        const args = {
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        };

        refreshTopRestoreSentinelObservation(args);

        expect(intersectionObservers.length).toBe(1);
        expect(intersectionObservers[0].observe).toHaveBeenCalledTimes(1);

        const disconnectCallsAfterFirstRefresh =
            intersectionObservers[0].disconnect.mock.calls.length;

        refreshTopRestoreSentinelObservation(args);

        expect(intersectionObservers.length).toBe(1);
        expect(intersectionObservers[0].observe).toHaveBeenCalledTimes(1);
        expect(intersectionObservers[0].disconnect).toHaveBeenCalledTimes(
            disconnectCallsAfterFirstRefresh
        );
    });

    it("does not reconnect the bottom observer when root and sentinel are unchanged", () => {
        const { user1, assistant1, scrollWrap } = buildConversation();

        protectedVisibleSectionsMock = [user1, assistant1];
        scrollWrap.scrollHeight = 1200;

        state.bottomPruneSentinel = makeSentinel();
        document.body.appendChild(state.bottomPruneSentinel);

        const args = {
            ensureObserverAttached: vi.fn(),
            withDomMutationGuard: (fn) => fn(),
            refreshObservedSections: vi.fn(),
        };

        refreshBottomPruneSentinelObservation(args);

        expect(intersectionObservers.length).toBe(1);
        expect(intersectionObservers[0].observe).toHaveBeenCalledTimes(1);

        const disconnectCallsAfterFirstRefresh =
            intersectionObservers[0].disconnect.mock.calls.length;

        refreshBottomPruneSentinelObservation(args);

        expect(intersectionObservers.length).toBe(1);
        expect(intersectionObservers[0].observe).toHaveBeenCalledTimes(1);
        expect(intersectionObservers[0].disconnect).toHaveBeenCalledTimes(
            disconnectCallsAfterFirstRefresh
        );
    });
});