import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";

const BRIDGE_PATH = path.resolve("src/page/chatStorePageBridge.js");
const BRIDGE_GLOBAL = "__threadOptimizerChatStoreBridge";
const TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";
const TOKEN = "0123456789abcdef0123456789abcdef";

function loadBridgeWithCurrentScript(scriptEl) {
    const source = fs.readFileSync(BRIDGE_PATH, "utf8");

    Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => scriptEl,
    });

    window.eval(source);
}

function dispatchBridgeMessage(data, options = {}) {
    window.dispatchEvent(
        new MessageEvent("message", {
            source: options.source ?? window,
            origin: options.origin ?? window.location.origin,
            data,
        })
    );
}

describe("chatStorePageBridge", () => {
    let script;

    beforeEach(() => {
        document.documentElement.innerHTML = "";
        delete window[BRIDGE_GLOBAL];

        vi.restoreAllMocks();

        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});

        script = document.createElement("script");
        script.setAttribute(TOKEN_ATTR, TOKEN);
        document.documentElement.appendChild(script);
    });

    it("installs when a bridge token is present", () => {
        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL]).toBeTruthy();
        expect(window[BRIDGE_GLOBAL].__installed).toBe(true);
    });

    it("does not install without a bridge token", () => {
        script.removeAttribute(TOKEN_ATTR);

        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL]).toBeUndefined();
    });

    it("does not install with an invalid bridge token", () => {
        script.setAttribute(TOKEN_ATTR, "not-a-valid-token");

        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL]).toBeUndefined();
    });

    it("ignores messages with the wrong source", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "not-thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:set-pruning-state",
            enabled: true,
        });

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it("ignores messages with the wrong token", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: "wrong-token",
            type: "thread-optimizer:set-pruning-state",
            enabled: true,
        });

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it("ignores messages from a non-window event source", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage(
            {
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:set-pruning-state",
                enabled: true,
            },
            { source: {} }
        );

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it("ignores messages from the wrong origin", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage(
            {
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:set-pruning-state",
                enabled: true,
            },
            { origin: "https://evil.example" }
        );

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it.each([
        null,
        undefined,
        "hello",
        123,
        true,
        [],
        Object.create(null),
    ])("ignores non-plain bridge message payload: %s", (payload) => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        expect(() => {
            dispatchBridgeMessage(payload);
        }).not.toThrow();

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it("ignores unknown message types", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:unknown",
            enabled: true,
        });

        expect(bridge.__knownPruningEnabled).not.toBe(true);
    });

    it("handles set-pruning-state safely", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:set-pruning-state",
            enabled: true,
            prunedTurnCount: 5,
        });

        expect(bridge.__knownPruningEnabled).toBe(true);
        expect(bridge.__knownPrunedTurnCount).toBe(5);
    });

    it("normalizes invalid prunedTurnCount to zero", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:set-pruning-state",
            enabled: true,
            prunedTurnCount: -10,
        });

        expect(bridge.__knownPruningEnabled).toBe(true);
        expect(bridge.__knownPrunedTurnCount).toBe(0);
    });

    it("handles enabling store-read optimization safely without a store", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        expect(() => {
            dispatchBridgeMessage({
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:set-store-read-optimization",
                enabled: true,
                debug: true,
            });
        }).not.toThrow();

        expect(bridge.__storeReadOptimizationRequested).toBe(true);
        expect(bridge.__storeReadOptimizationDebug).toBe(true);
    });

    it("handles disabling store-read optimization safely without a store", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        expect(() => {
            dispatchBridgeMessage({
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:set-store-read-optimization",
                enabled: false,
                debug: true,
            });
        }).not.toThrow();

        expect(bridge.__storeReadOptimizationRequested).toBe(false);
        expect(bridge.__storeReadOptimizationDebug).toBe(true);
    });

    it("records a pruned message id safely without a store", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:record-pruned-message-id",
            messageId: "abc123",
        });

        expect(bridge.__prunedMessageIds).toContain("abc123");
    });

    it("trims recorded pruned message ids", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchBridgeMessage({
            source: "thread-optimizer",
            token: TOKEN,
            type: "thread-optimizer:record-pruned-message-id",
            messageId: "  abc123  ",
        });

        expect(bridge.__prunedMessageIds).toContain("abc123");
        expect(bridge.__prunedMessageIds).not.toContain("  abc123  ");
    });

    it("does not duplicate recorded pruned message ids", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        for (let i = 0; i < 2; i += 1) {
            dispatchBridgeMessage({
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:record-pruned-message-id",
                messageId: "abc123",
            });
        }

        expect(bridge.__prunedMessageIds.filter((id) => id === "abc123")).toHaveLength(1);
    });

    it.each(["", "   ", "x".repeat(301)])(
        "ignores invalid pruned message id: %s",
        (messageId) => {
            loadBridgeWithCurrentScript(script);

            const bridge = window[BRIDGE_GLOBAL];

            dispatchBridgeMessage({
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:record-pruned-message-id",
                messageId,
            });

            expect(bridge.__prunedMessageIds).toHaveLength(0);
        }
    );

    it("handles log-store-performance safely", () => {
        loadBridgeWithCurrentScript(script);

        expect(() => {
            dispatchBridgeMessage({
                source: "thread-optimizer",
                token: TOKEN,
                type: "thread-optimizer:log-store-performance",
            });
        }).not.toThrow();
    });

    it("does not double-install when evaluated twice", () => {
        const addSpy = vi.spyOn(window, "addEventListener");

        loadBridgeWithCurrentScript(script);
        loadBridgeWithCurrentScript(script);

        const messageListenerCalls = addSpy.mock.calls.filter(
            ([eventName]) => eventName === "message"
        );

        expect(messageListenerCalls).toHaveLength(1);
    });
});