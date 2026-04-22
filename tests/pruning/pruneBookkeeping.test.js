import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { state } from "../../src/content/core/state.js";
import {
    pruneOldSections,
    restoreAllSections,
    restoreOneExchangeFromSoftPruned,
    repruneOneExchangeFromVisibleProtected,
    enforceSoftPrunedLimit,
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

function makeDeps() {
    return {
        ensureObserverAttached: vi.fn(),
        withDomMutationGuard: (fn) => fn(),
        refreshObservedSections: vi.fn(),
    };
}

beforeEach(() => {
    document.body.innerHTML = "";
    resetState();
});

afterEach(() => {
    document.body.innerHTML = "";
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
});