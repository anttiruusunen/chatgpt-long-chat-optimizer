import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    requestStoreHistoryPrune: vi.fn(),
    isReplyStreaming: vi.fn(),
    debugLog: vi.fn(),
}));

vi.mock("../../src/content/bridge/chatStoreBridgeClient.js", () => ({
    requestStoreHistoryPrune: mockRefs.requestStoreHistoryPrune,
}));

vi.mock("../../src/content/streaming/replyTiming.js", () => ({
    isReplyStreaming: mockRefs.isReplyStreaming,
}));

vi.mock("../../src/content/core/logger.js", () => ({
    debugLog: mockRefs.debugLog,
}));

async function loadPruneModule() {
    const stateModule = await import("../../src/content/core/state.js");
    const pruneModule = await import("../../src/content/pruning/prune.js");

    return {
        state: stateModule.state,
        ...pruneModule,
    };
}

function buildConversationWithSettledAssistant() {
    document.body.innerHTML = `
        <main>
            <div>
                <div>
                    <section data-turn="user" data-testid="conversation-turn-1">User</section>
                    <section data-turn="assistant" data-testid="conversation-turn-2">
                        Assistant
                        <div aria-label="Response actions"></div>
                    </section>
                </div>
            </div>
        </main>
    `;
}

describe("prune", () => {
    beforeEach(() => {
        vi.resetModules();

        document.body.innerHTML = "";

        mockRefs.requestStoreHistoryPrune.mockReset();
        mockRefs.isReplyStreaming.mockReset();
        mockRefs.debugLog.mockReset();

        mockRefs.isReplyStreaming.mockReturnValue(false);
        mockRefs.requestStoreHistoryPrune.mockReturnValue({
            posted: true,
            requestId: "request-1",
            historyKeptExchanges: 1,
            reason: null,
        });
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("requests store prune when chat is settled", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        buildConversationWithSettledAssistant();

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).toHaveBeenCalledWith({
            historyKeptExchanges: 1,
            reason: "prune-store-history",
        });

        expect(result).toMatchObject({
            posted: true,
            deferred: false,
            requestId: "request-1",
        });
    });

    it("requests store prune even when the DOM has no visible conversation turns", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        document.body.innerHTML = "<main></main>";

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).toHaveBeenCalledWith({
            historyKeptExchanges: 1,
            reason: "prune-store-history",
        });

        expect(result).toMatchObject({
            posted: true,
            deferred: false,
            requestId: "request-1",
        });
    });

    it("requests store prune when conversation turn count changes", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        buildConversationWithSettledAssistant();

        const firstResult = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).toHaveBeenCalledTimes(1);
        expect(firstResult).toMatchObject({
            posted: true,
            deferred: false,
        });

        mockRefs.requestStoreHistoryPrune.mockClear();

        const nextTurn = document.createElement("section");
        nextTurn.setAttribute("data-turn", "user");
        nextTurn.setAttribute("data-testid", "conversation-turn-3");
        nextTurn.textContent = "Next user";

        document.querySelector("main")?.appendChild(nextTurn);

        const changedResult = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).toHaveBeenCalledWith({
            historyKeptExchanges: 1,
            reason: "prune-store-history",
        });

        expect(changedResult).toMatchObject({
            posted: true,
            deferred: false,
            requestId: "request-1",
        });
    });

    it("defers store prune while reply timing is pending", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        mockRefs.isReplyStreaming.mockReturnValue(true);

        buildConversationWithSettledAssistant();

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            posted: false,
            deferred: true,
            reason: "reply streaming",
        });
    });

    it("defers store prune while active generation UI is visible", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        buildConversationWithSettledAssistant();

        const stopButton = document.createElement("button");
        stopButton.setAttribute("aria-label", "Stop generating");
        document.body.appendChild(stopButton);

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            posted: false,
            deferred: true,
            reason: "assistant generation active",
        });
    });

    it("defers store prune while latest assistant has thinking status", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        document.body.innerHTML = `
            <main>
                <div>
                    <div>
                        <section data-turn="user" data-testid="conversation-turn-1">User</section>
                        <section data-turn="assistant" data-testid="conversation-turn-2">
                            <div role="status">Thinking</div>
                        </section>
                    </div>
                </div>
            </main>
        `;

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            posted: false,
            deferred: true,
            reason: "latest-assistant-incomplete",
        });
    });

    it("fails closed when store prune request throws", async () => {
        const { state, pruneOldSections } = await loadPruneModule();

        state.featureFlags.pruning = true;
        state.settings.historyKeptExchanges = 1;

        const error = new Error("bridge exploded");
        const consoleErrorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => {});

        mockRefs.requestStoreHistoryPrune.mockImplementation(() => {
            throw error;
        });

        buildConversationWithSettledAssistant();

        const result = pruneOldSections(1);

        expect(mockRefs.requestStoreHistoryPrune).toHaveBeenCalledWith({
            historyKeptExchanges: 1,
            reason: "prune-store-history",
        });

        expect(result).toMatchObject({
            posted: false,
            deferred: false,
            failed: true,
            reason: "store-prune-request-failed",
        });

        expect(result.error).toContain("bridge exploded");
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            "[Long Chat Optimizer] Store prune request failed",
            error
        );

        expect(mockRefs.debugLog).toHaveBeenCalledWith(
            "Prune: store-native history prune request failed",
            expect.objectContaining({
                historyKeptExchanges: 1,
                reason: "prune-store-history",
                error: "bridge exploded",
            })
        );
    });
});