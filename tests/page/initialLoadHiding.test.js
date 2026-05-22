import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function createConversationPayload(exchangeCount = 6) {
    const mapping = {
        "client-created-root": {
            id: "client-created-root",
            message: null,
            parent: null,
            children: [],
        },
    };

    let parent = "client-created-root";

    for (let i = 1; i <= exchangeCount; i += 1) {
        const userId = `user-${i}`;
        const assistantId = `assistant-${i}`;

        mapping[userId] = {
            id: userId,
            message: {
                id: `message-user-${i}`,
                author: { role: "user" },
                content: {
                    content_type: "text",
                    parts: [`User ${i}`],
                },
            },
            parent,
            children: [assistantId],
        };

        mapping[parent].children = [userId];

        mapping[assistantId] = {
            id: assistantId,
            message: {
                id: `message-assistant-${i}`,
                author: { role: "assistant" },
                content: {
                    content_type: "text",
                    parts: [`Assistant ${i}`],
                },
            },
            parent: userId,
            children: [],
        };

        parent = assistantId;
    }

    return {
        title: "Long test conversation",
        current_node: parent,
        mapping,
    };
}

function createJsonResponse(payload) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
            "content-type": "application/json",
        },
    });
}

async function importFreshModule() {
    vi.resetModules();

    return import("../../src/page/chatStoreBridge/initialLoadHiding.js");
}

describe("initialLoadHiding", () => {
    let originalFetch;

    beforeEach(() => {
        vi.useFakeTimers();
        originalFetch = window.fetch;
    });

    afterEach(async () => {
        const module = await importFreshModule();

        module.resetInitialLoadHidingForTests();

        window.fetch = originalFetch;

        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("trims a valid conversation mapping payload to recent exchanges", async () => {
        const module = await importFreshModule();
        const payload = createConversationPayload(6);

        const result = module.trimConversationPayloadForInitialLoadHiding(
            payload,
            {
                historyKeptExchanges: 2,
            }
        );

        expect(result.ok).toBe(true);
        expect(result.reason).toBe("trimmed");
        expect(result.originalNodeCount).toBe(13);
        expect(result.trimmedNodeCount).toBe(5);
        expect(result.deletedNodeCount).toBe(8);

        expect(result.payload.current_node).toBe("assistant-6");
        expect(Object.keys(result.payload.mapping)).toEqual([
            "client-created-root",
            "user-5",
            "assistant-5",
            "user-6",
            "assistant-6",
        ]);

        expect(result.payload.mapping["client-created-root"].children).toEqual([
            "user-5",
        ]);
        expect(result.payload.mapping["user-5"].parent).toBe(
            "client-created-root"
        );
        expect(result.payload.mapping["assistant-6"].children).toEqual([]);
    });

    it("fails open for payloads that do not match the conversation mapping shape", async () => {
        const module = await importFreshModule();

        const payload = {
            ok: true,
            data: [],
        };

        const result = module.trimConversationPayloadForInitialLoadHiding(
            payload,
            {
                historyKeptExchanges: 2,
            }
        );

        expect(result.ok).toBe(false);
        expect(result.reason).toBe(
            "payload does not match conversation mapping shape"
        );
        expect(result.payload).toBe(payload);
    });

    it("does not trim when there is nothing old enough to remove", async () => {
        const module = await importFreshModule();
        const payload = createConversationPayload(2);

        const result = module.trimConversationPayloadForInitialLoadHiding(
            payload,
            {
                historyKeptExchanges: 5,
            }
        );

        expect(result.ok).toBe(false);
        expect(result.reason).toBe("nothing to trim");
        expect(result.payload).toBe(payload);
    });

    it("waits for popup settings before trimming an intercepted conversation response", async () => {
        const module = await importFreshModule();
        const payload = createConversationPayload(6);

        window.fetch = vi.fn(() => Promise.resolve(createJsonResponse(payload)));

        module.installInitialLoadHiding({
            enabled: false,
            historyKeptExchanges: 1,
            debug: false,
        });

        const responsePromise = window.fetch(
            "/backend-api/conversation/test-conversation"
        );

        await Promise.resolve();

        expect(module.getInitialLoadHidingState().settingsReady).toBe(false);
        expect(module.getInitialLoadHidingState().stats.waitedForSettings).toBe(1);

        module.setInitialLoadHidingState({
            enabled: true,
            historyKeptExchanges: 2,
            debug: false,
        });

        const response = await responsePromise;
        const json = await response.json();

        expect(Object.keys(json.mapping)).toHaveLength(5);
        expect(json.mapping["user-5"]).toBeTruthy();
        expect(json.mapping["user-1"]).toBeUndefined();

        const state = module.getInitialLoadHidingState();

        expect(state.settingsReady).toBe(true);
        expect(state.enabled).toBe(true);
        expect(state.historyKeptExchanges).toBe(2);
        expect(state.stats.trimmed).toBe(1);
        expect(state.stats.settingsWaitTimedOut).toBe(0);
        expect(state.stats.lastReason).toBe("trimmed");
    });

    it("skips trimming when popup settings arrive disabled", async () => {
        const module = await importFreshModule();
        const payload = createConversationPayload(6);

        window.fetch = vi.fn(() => Promise.resolve(createJsonResponse(payload)));

        module.installInitialLoadHiding({
            enabled: false,
            historyKeptExchanges: 1,
            debug: false,
        });

        module.setInitialLoadHidingState({
            enabled: false,
            historyKeptExchanges: 2,
            debug: false,
        });

        const response = await window.fetch(
            "/backend-api/conversation/test-conversation"
        );
        const json = await response.json();

        expect(Object.keys(json.mapping)).toHaveLength(13);

        const state = module.getInitialLoadHidingState();

        expect(state.settingsReady).toBe(true);
        expect(state.enabled).toBe(false);
        expect(state.stats.trimmed).toBe(0);
        expect(state.stats.skipped).toBe(1);
        expect(state.stats.lastReason).toBe("initial-load hiding disabled");
    });

    it("fails open when popup settings do not arrive before the wait timeout", async () => {
        const module = await importFreshModule();
        const payload = createConversationPayload(6);

        window.fetch = vi.fn(() => Promise.resolve(createJsonResponse(payload)));

        module.installInitialLoadHiding({
            enabled: false,
            historyKeptExchanges: 1,
            debug: false,
        });

        const responsePromise = window.fetch(
            "/backend-api/conversation/test-conversation"
        );

        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(1200);

        const response = await responsePromise;
        const json = await response.json();

        expect(Object.keys(json.mapping)).toHaveLength(13);

        const state = module.getInitialLoadHidingState();

        expect(state.settingsReady).toBe(false);
        expect(state.stats.trimmed).toBe(0);
        expect(state.stats.skipped).toBe(1);
        expect(state.stats.waitedForSettings).toBe(1);
        expect(state.stats.settingsWaitTimedOut).toBe(1);
        expect(state.stats.lastReason).toBe("settings wait timed out");
    });

    it("ignores non-conversation fetches", async () => {
        const module = await importFreshModule();

        window.fetch = vi.fn(() =>
            Promise.resolve(
                new Response("ok", {
                    status: 200,
                    headers: { "content-type": "text/plain" },
                })
            )
        );

        module.installInitialLoadHiding({
            enabled: false,
            historyKeptExchanges: 1,
            debug: false,
        });

        const response = await window.fetch("/backend-api/not-conversation/test");

        expect(await response.text()).toBe("ok");
        expect(module.getInitialLoadHidingState().stats.intercepted).toBe(0);
    });

    it("resetInitialLoadHidingForTests restores the original fetch", async () => {
        const module = await importFreshModule();
        const fetchMock = vi.fn();

        window.fetch = fetchMock;

        module.installInitialLoadHiding({
            enabled: false,
            historyKeptExchanges: 1,
            debug: false,
        });

        expect(window.fetch).not.toBe(fetchMock);

        module.resetInitialLoadHidingForTests();

        expect(window.fetch).toBe(fetchMock);
        expect(module.getInitialLoadHidingState()).toMatchObject({
            installed: false,
            enabled: false,
            settingsReady: false,
            historyKeptExchanges: 10,
        });
    });
});
