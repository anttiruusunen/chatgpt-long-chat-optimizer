import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    getConversationSections,
    invalidateConversationDomCache,
    resetConversationDomCacheForTests,
} from "../../src/content/core/dom.js";
import {
    pruneOldSections,
    restoreAllSections,
    restoreOneExchangeFromSoftPruned,
    repruneOneExchangeFromVisibleProtected,
    enforceSoftPrunedLimit,
    runInitialPrune,
} from "../../src/content/pruning/prune.js";

const BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef";

function makeSection({
    text = "",
    turn = null,
    testId = null,
    messageId = null,
} = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn != null) {
        section.setAttribute("data-turn", turn);
    }

    if (testId != null) {
        section.setAttribute("data-testid", testId);
    }

    if (messageId != null) {
        section.setAttribute("data-message-id", messageId);
    }

    return section;
}

function buildConversation(exchangeCount = 6) {
    document.body.innerHTML = "";
    resetConversationDomCacheForTests();

    const page = document.createElement("div");
    const scrollWrap = document.createElement("div");
    const conversation = document.createElement("div");

    scrollWrap.style.overflowY = "auto";
    page.appendChild(scrollWrap);
    scrollWrap.appendChild(conversation);
    document.body.appendChild(page);

    const sections = [];

    for (let i = 0; i < exchangeCount; i += 1) {
        const userIndex = i * 2 + 1;
        const assistantIndex = i * 2 + 2;

        const user = makeSection({
            turn: "user",
            testId: `conversation-turn-${userIndex}`,
            messageId: `msg-${userIndex}`,
            text: `User ${i + 1}`,
        });

        const assistant = makeSection({
            turn: "assistant",
            testId: `conversation-turn-${assistantIndex}`,
            messageId: `msg-${assistantIndex}`,
            text: `Assistant ${i + 1}`,
        });

        conversation.appendChild(user);
        conversation.appendChild(assistant);

        sections.push(user, assistant);
    }

    resetConversationDomCacheForTests();

    return { page, scrollWrap, conversation, sections };
}

function getPlaceholder() {
    return document.querySelector('[data-thread-optimizer-placeholder="true"]');
}

function resetState() {
    state.softPrunedSections = [];
    state.hiddenCount = 0;
    state.totalHiddenCount = 0;
    state.hardEvictedCount = 0;
    state.placeholder = null;
    state.topRestoreSentinel = null;
    state.bottomPruneSentinel = null;
    state.settings.historyKeptExchanges = 2;
    state.featureFlags.pruning = true;
}

function installReactPruneBridgeMock() {
    window.THREAD_OPTIMIZER_BRIDGE_TOKEN = BRIDGE_TOKEN;

    return vi.spyOn(window, "postMessage").mockImplementation((message) => {
        if (
            message?.source !== "thread-optimizer" ||
            message?.token !== BRIDGE_TOKEN ||
            message?.type !== "thread-optimizer:prune-react-message-ids"
        ) {
            return;
        }

        for (const messageId of message.messageIds || []) {
            const sections = Array.from(
                document.querySelectorAll("section[data-message-id]")
            );

            const section = sections.find(
                (candidate) => candidate.getAttribute("data-message-id") === messageId
            );

            section?.remove();
        }

        invalidateConversationDomCache();
    });
}

function guardedDomWrite(fn) {
    invalidateConversationDomCache();

    try {
        return fn();
    } finally {
        invalidateConversationDomCache();
    }
}

function makeDeps() {
    return {
        ensureObserverAttached: vi.fn(),
        withDomMutationGuard: guardedDomWrite,
        refreshObservedSections: vi.fn(),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    resetConversationDomCacheForTests();
    document.body.innerHTML = "";
    resetState();
    installReactPruneBridgeMock();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    resetConversationDomCacheForTests();
});

describe("prune bookkeeping", () => {
    it("tracks hidden counts after initial prune", () => {
        buildConversation(6);

        const result = pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        expect(result.visibleSectionsChanged).toBe(true);
        expect(state.hiddenCount).toBe(10);
        expect(state.totalHiddenCount).toBe(10);
        expect(state.softPrunedSections.length).toBe(2);
        expect(state.hardEvictedCount).toBe(8);

        expect(document.querySelectorAll("section[data-turn]").length).toBe(2);
    });

    it("placeholder label matches hidden message count", () => {
        buildConversation(5);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const placeholder = getPlaceholder();

        expect(placeholder).not.toBeNull();
        expect(placeholder.textContent).toContain("8");
        expect(placeholder.textContent.toLowerCase()).toContain("messages");
    });

    it("restore one exchange decreases soft-pruned count and increases visible count", () => {
        buildConversation(6);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const beforeVisible = document.querySelectorAll("section[data-turn]").length;
        const beforeSoftPruned = state.softPrunedSections.length;
        const beforeHidden = state.hiddenCount;

        const result = restoreOneExchangeFromSoftPruned(makeDeps());

        expect(result.restoredSectionsCount).toBe(2);
        expect(state.softPrunedSections.length).toBe(beforeSoftPruned - 2);
        expect(state.hiddenCount).toBe(beforeHidden - 2);

        expect(document.querySelectorAll("section[data-turn]").length).toBe(
            beforeVisible + 2
        );
    });

    it("reprune one restored protected exchange moves it back into soft-pruned", () => {
        buildConversation(6);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const afterPruneSoftPruned = state.softPrunedSections.length;
        const afterPruneHidden = state.hiddenCount;

        const restoreResult = restoreOneExchangeFromSoftPruned(makeDeps());
        expect(restoreResult.restoredSectionsCount).toBe(2);

        const afterRestoreSoftPruned = state.softPrunedSections.length;
        const afterRestoreHidden = state.hiddenCount;
        const visibleAfterRestore = document.querySelectorAll("section[data-turn]").length;

        expect(afterRestoreSoftPruned).toBe(afterPruneSoftPruned - 2);
        expect(afterRestoreHidden).toBe(afterPruneHidden - 2);
        expect(visibleAfterRestore).toBe(4);

        const repruneResult = repruneOneExchangeFromVisibleProtected(makeDeps());

        expect(repruneResult.reprunedSectionsCount).toBe(2);
        expect(state.softPrunedSections.length).toBe(afterRestoreSoftPruned + 2);
        expect(state.hiddenCount).toBe(afterRestoreHidden + 2);

        expect(document.querySelectorAll("section[data-turn]").length).toBe(2);
    });

    it("keeps cached conversation sections accurate across prune, restore, and reprune", () => {
        buildConversation(6);

        expect(getConversationSections().length).toBe(12);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        expect(getConversationSections().length).toBe(2);

        const restoreResult = restoreOneExchangeFromSoftPruned(makeDeps());

        expect(restoreResult.restoredSectionsCount).toBe(2);
        expect(getConversationSections().length).toBe(4);

        const repruneResult = repruneOneExchangeFromVisibleProtected(makeDeps());

        expect(repruneResult.reprunedSectionsCount).toBe(2);
        expect(getConversationSections().length).toBe(2);
    });

    it("enforces soft-pruned limit by React-pruning overflow", () => {
        buildConversation(8);

        pruneOldSections(4, { showPlaceholder: true }, makeDeps());

        const beforeSoftPruned = state.softPrunedSections.length;
        state.settings.historyKeptExchanges = 1;

        enforceSoftPrunedLimit();

        expect(state.softPrunedSections.length).toBeLessThan(beforeSoftPruned);
        expect(state.hardEvictedCount).toBeGreaterThan(0);
        expect(state.totalHiddenCount).toBe(
            state.softPrunedSections.length + state.hardEvictedCount
        );
    });

    it("restoreAllSections restores recoverable sections and preserves React-pruned count", () => {
        buildConversation(8);

        pruneOldSections(4, { showPlaceholder: true }, makeDeps());

        state.settings.historyKeptExchanges = 1;
        enforceSoftPrunedLimit();

        const hardEvictedBeforeRestore = state.hardEvictedCount;

        restoreAllSections(makeDeps());

        expect(state.softPrunedSections.length).toBe(0);
        expect(state.hardEvictedCount).toBe(hardEvictedBeforeRestore);
        expect(state.hiddenCount).toBe(hardEvictedBeforeRestore);
    });

    it("does not reprune when there is no restored protected exchange", () => {
        buildConversation(4);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const beforeSoftPruned = state.softPrunedSections.length;
        const beforeHidden = state.hiddenCount;

        const result = repruneOneExchangeFromVisibleProtected(makeDeps());

        expect(result.reprunedSectionsCount).toBe(0);
        expect(state.softPrunedSections.length).toBe(beforeSoftPruned);
        expect(state.hiddenCount).toBe(beforeHidden);
    });

    it("restore and reprune preserve total hidden count", () => {
        buildConversation(6);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const totalHiddenAfterPrune = state.totalHiddenCount;

        restoreOneExchangeFromSoftPruned(makeDeps());
        repruneOneExchangeFromVisibleProtected(makeDeps());

        expect(state.totalHiddenCount).toBe(totalHiddenAfterPrune);
    });

    it("moves the placeholder before newly restored sections when restoring one exchange", () => {
        const { conversation } = buildConversation(6);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        const placeholder = getPlaceholder();
        expect(placeholder).not.toBeNull();

        const restoreResult = restoreOneExchangeFromSoftPruned(makeDeps());

        expect(restoreResult.restoredSectionsCount).toBe(2);

        const visibleAfterRestore = getConversationSections();
        expect(visibleAfterRestore.length).toBe(4);

        const firstVisibleAfterRestore = visibleAfterRestore[0];

        expect(conversation.contains(placeholder)).toBe(true);
        expect(placeholder.hidden).toBe(false);

        expect(Array.from(conversation.children).indexOf(placeholder)).toBeLessThan(
            Array.from(conversation.children).indexOf(firstVisibleAfterRestore)
        );
    });

    it("keeps the placeholder aligned after repeated restore-one cycles", () => {
        state.settings.historyKeptExchanges = 3;

        const { conversation } = buildConversation(8);

        pruneOldSections(3, { showPlaceholder: true }, makeDeps());

        const placeholder = getPlaceholder();
        expect(placeholder).not.toBeNull();

        const firstRestore = restoreOneExchangeFromSoftPruned(makeDeps());
        expect(firstRestore.restoredSectionsCount).toBe(2);

        const secondRestore = restoreOneExchangeFromSoftPruned(makeDeps());
        expect(secondRestore.restoredSectionsCount).toBe(2);

        const visibleSections = getConversationSections();
        const firstVisibleSection = visibleSections[0];

        expect(conversation.contains(placeholder)).toBe(true);
        expect(placeholder.hidden).toBe(false);

        expect(Array.from(conversation.children).indexOf(placeholder)).toBeLessThan(
            Array.from(conversation.children).indexOf(firstVisibleSection)
        );
    });

    it("refreshes cached visible sections after restoreAllSections", () => {
        buildConversation(6);

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        expect(getConversationSections().length).toBe(2);

        const result = restoreAllSections(makeDeps());

        expect(result.visibleSectionsChanged).toBe(true);
        expect(getConversationSections().length).toBe(4);
        expect(state.softPrunedSections.length).toBe(0);
    });

    it("does not prune the latest incomplete assistant section during initial/reload pruning", () => {
        const { conversation } = buildConversation(6);

        const incomplete = makeSection({
            turn: "assistant",
            testId: "conversation-turn-streaming",
            messageId: "msg-streaming",
            text: "partial streamed reply",
        });

        conversation.appendChild(incomplete);
        resetConversationDomCacheForTests();

        pruneOldSections(1, { showPlaceholder: true }, makeDeps());

        expect(incomplete.isConnected).toBe(true);
        expect(getConversationSections()).toContain(incomplete);
    });

    it("runInitialPrune preserves the latest incomplete assistant section", async () => {
        vi.useFakeTimers();

        try {
            window.requestAnimationFrame = (callback) => setTimeout(callback, 0);

            state.featureFlags.pruning = true;
            state.settings.autoPrune = true;
            state.settings.historyKeptExchanges = 1;
            state.didInitialPrune = false;

            const { conversation } = buildConversation(6);

            const incomplete = makeSection({
                turn: "assistant",
                testId: "conversation-turn-streaming",
                messageId: "msg-streaming",
                text: "partial streamed reply",
            });

            conversation.appendChild(incomplete);
            resetConversationDomCacheForTests();

            runInitialPrune(
                conversation,
                {
                    pruneOldSections: (historyKeptExchanges, options) =>
                        pruneOldSections(historyKeptExchanges, options, makeDeps()),
                    refreshObservedSections: vi.fn(),
                    installStartupPruneMask: vi.fn(),
                    removeStartupPruneMask: vi.fn(),
                },
                { useStartupMask: false }
            );

            await Promise.resolve();
            vi.advanceTimersByTime(0);
            await Promise.resolve();

            expect(state.didInitialPrune).toBe(true);
            expect(incomplete.isConnected).toBe(true);
            expect(getConversationSections()).toContain(incomplete);
        } finally {
            vi.useRealTimers();
        }
    });

    it("still prunes older incomplete-looking assistant sections", () => {
        const { conversation } = buildConversation(6);

        const olderIncomplete = makeSection({
            turn: "assistant",
            testId: "conversation-turn-older-incomplete",
            messageId: "msg-older-incomplete",
            text: "older partial-looking assistant",
        });

        conversation.insertBefore(olderIncomplete, conversation.children[2]);
        resetConversationDomCacheForTests();

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        expect(olderIncomplete.isConnected).toBe(false);
        expect(getConversationSections()).not.toContain(olderIncomplete);
    });

    it("does not crash when no sections exist", () => {
        document.body.innerHTML = "";

        expect(() =>
            pruneOldSections(2, { showPlaceholder: true }, makeDeps())
        ).not.toThrow();
    });

    it("handles null or undefined sections safely", () => {
        expect(() =>
            pruneOldSections(2, { showPlaceholder: true }, makeDeps())
        ).not.toThrow();
    });

    it("preserves a latest user-only pending turn during initial/reload pruning", async () => {
        vi.useFakeTimers();

        try {
            window.requestAnimationFrame = (callback) => setTimeout(callback, 0);

            state.featureFlags.pruning = true;
            state.settings.autoPrune = true;
            state.settings.historyKeptExchanges = 1;
            state.didInitialPrune = false;

            const { conversation } = buildConversation(6);

            const pendingUser = makeSection({
                turn: "user",
                testId: "conversation-turn-pending-user",
                messageId: "msg-pending-user",
                text: "latest user message without assistant yet",
            });

            conversation.appendChild(pendingUser);
            resetConversationDomCacheForTests();

            const deps = {
                ensureObserverAttached: vi.fn(),
                withDomMutationGuard: (fn) => fn(),
                refreshObservedSections: vi.fn(),
            };

            runInitialPrune(
                conversation,
                {
                    pruneOldSections: (historyKeptExchanges, options) =>
                        pruneOldSections(historyKeptExchanges, options, deps),
                    refreshObservedSections: deps.refreshObservedSections,
                    installStartupPruneMask: vi.fn(),
                    removeStartupPruneMask: vi.fn(),
                },
                { useStartupMask: false }
            );

            await Promise.resolve();
            vi.advanceTimersByTime(0);
            await Promise.resolve();

            expect(state.didInitialPrune).toBe(true);
            expect(pendingUser.isConnected).toBe(true);
            expect(getConversationSections()).toContain(pendingUser);
        } finally {
            vi.useRealTimers();
        }
    });

    it("preserves the latest real exchange when an input-too-large error section appears before it", () => {
        const { conversation } = buildConversation(6);

        const inputTooLargeUser = makeSection({
            turn: "user",
            testId: "conversation-turn-input-too-large-user",
            messageId: "msg-input-too-large-user",
            text: "huge prompt that failed",
        });

        const inputTooLargeError = makeSection({
            turn: "assistant",
            testId: "conversation-turn-input-too-large-error",
            messageId: "msg-input-too-large-error",
            text: "Input too large",
        });

        inputTooLargeError.setAttribute("role", "alert");

        const latestUser = makeSection({
            turn: "user",
            testId: "conversation-turn-latest-user",
            messageId: "msg-latest-user",
            text: "next valid message",
        });

        const latestAssistant = makeSection({
            turn: "assistant",
            testId: "conversation-turn-latest-assistant",
            messageId: "msg-latest-assistant",
            text: "next valid assistant response",
        });

        conversation.append(
            inputTooLargeUser,
            inputTooLargeError,
            latestUser,
            latestAssistant
        );

        resetConversationDomCacheForTests();

        pruneOldSections(1, { showPlaceholder: true }, makeDeps());

        expect(latestUser.isConnected).toBe(true);
        expect(latestAssistant.isConnected).toBe(true);
        expect(getConversationSections()).toContain(latestUser);
        expect(getConversationSections()).toContain(latestAssistant);
    });
});