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

function makeSection({
    text = "",
    turn = null,
    testId = null,
} = {}) {
    const section = document.createElement("section");
    section.textContent = text;

    if (turn != null) {
        section.setAttribute("data-turn", turn);
    }

    if (testId != null) {
        section.setAttribute("data-testid", testId);
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
        const user = makeSection({
            turn: "user",
            testId: `conversation-turn-${i * 2 + 1}`,
            text: `User ${i + 1}`,
        });

        const assistant = makeSection({
            turn: "assistant",
            testId: `conversation-turn-${i * 2 + 2}`,
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
    resetConversationDomCacheForTests();
    document.body.innerHTML = "";
    resetState();
});

afterEach(() => {
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

        const visibleSections = document.querySelectorAll("section[data-turn]");
        expect(visibleSections.length).toBe(2);
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

        const afterVisible = document.querySelectorAll("section[data-turn]").length;
        expect(afterVisible).toBe(beforeVisible + 2);
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

        const remainingVisible = document.querySelectorAll("section[data-turn]").length;
        expect(remainingVisible).toBe(2);
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

    it("enforces soft-pruned limit by hard-evicting overflow", () => {
        buildConversation(8);

        pruneOldSections(4, { showPlaceholder: true }, makeDeps());

        const beforeSoftPruned = state.softPrunedSections.length;
        state.settings.historyKeptExchanges = 1;

        enforceSoftPrunedLimit();

        expect(state.softPrunedSections.length).toBeLessThan(beforeSoftPruned);
        expect(state.hardEvictedCount).toBeGreaterThan(0);
        expect(
            state.totalHiddenCount
        ).toBe(state.softPrunedSections.length + state.hardEvictedCount);
    });

    it("restoreAllSections restores recoverable sections and preserves hard-evicted count", () => {
        buildConversation(8);

        pruneOldSections(4, { showPlaceholder: true }, makeDeps());

        state.settings.historyKeptExchanges = 1;
        enforceSoftPrunedLimit();

        const hardEvictedBeforeRestore = state.hardEvictedCount;

        restoreAllSections(makeDeps());

        expect(state.softPrunedSections.length).toBe(0);
        expect(state.hardEvictedCount).toBe(hardEvictedBeforeRestore);
        expect(state.hiddenCount).toBe(hardEvictedBeforeRestore);

        const placeholder = getPlaceholder();
        if (hardEvictedBeforeRestore === 0) {
            expect(placeholder).toBeNull();
        }
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

        expect(
            Array.from(conversation.children).indexOf(placeholder)
        ).toBeLessThan(
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

        expect(
            Array.from(conversation.children).indexOf(placeholder)
        ).toBeLessThan(
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

        const incomplete = document.createElement("section");
        incomplete.setAttribute("data-turn", "assistant");
        incomplete.textContent = "partial streamed reply";
        conversation.appendChild(incomplete);

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
                text: "partial streamed reply",
            });

            conversation.appendChild(incomplete);
            resetConversationDomCacheForTests();

            runInitialPrune(
                conversation,
                {
                    pruneOldSections: (sectionsToKeep, options) =>
                        pruneOldSections(sectionsToKeep, options, makeDeps()),
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
            text: "older partial-looking assistant",
        });

        conversation.insertBefore(olderIncomplete, conversation.children[2]);
        resetConversationDomCacheForTests();

        pruneOldSections(2, { showPlaceholder: true }, makeDeps());

        expect(olderIncomplete.isConnected).toBe(false);
        expect(getConversationSections()).not.toContain(olderIncomplete);
    });
});