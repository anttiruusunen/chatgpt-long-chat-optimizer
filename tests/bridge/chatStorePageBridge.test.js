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

function appendVisibleMessage(messageId = "msg-3") {
    document.body.innerHTML = `
        <main>
            <div id="conversation">
                <section data-testid="conversation-turn-1" data-turn="user" data-message-id="msg-1">
                    user
                </section>
                <section data-testid="conversation-turn-2" data-turn="assistant" data-message-id="msg-2">
                    assistant
                </section>
                <section data-testid="conversation-turn-3" data-turn="user" data-message-id="${messageId}" data-scroll-anchor="true">
                    latest
                </section>
            </div>
        </main>
    `;
}

function createFakeStore(nodeCount = 4) {
    const nodeMap = new Map();

    for (let i = 0; i < nodeCount; i += 1) {
        const id = i === 0 ? "root" : `node-${i}`;
        const parentId = i <= 1 ? "root" : `node-${i - 1}`;
        const nextId = i + 1 < nodeCount ? `node-${i + 1}` : null;

        nodeMap.set(id, {
            id,
            parentId,
            children: nextId ? [nextId] : [],
            message: {
                id: i === 0 ? "root-message" : `msg-${i}`,
                author: {
                    role: i === 0 ? "root" : i % 2 ? "user" : "assistant",
                },
                content: {
                    content_type: "text",
                    parts: [],
                },
                metadata: {},
                clientMetadata: {},
            },
        });
    }

    const store = {
        rootId: "root",
        currentLeafId: `node-${nodeCount - 1}`,

        get nodes() {
            return Array.from(nodeMap.values());
        },

        messageIdToExistingNodeId(id) {
            if (nodeMap.has(id)) return id;

            for (const node of nodeMap.values()) {
                if (node.message?.id === id) {
                    return node.id;
                }
            }

            return null;
        },

        messageIdToNodeId(id) {
            return this.messageIdToExistingNodeId(id) ?? id;
        },

        containsNodeOrMessageId(id) {
            return this.messageIdToExistingNodeId(id) != null;
        },

        getNodeIfExists(id) {
            const nodeId = this.messageIdToExistingNodeId(id);
            return nodeId ? nodeMap.get(nodeId) : undefined;
        },

        getNodeByIdOrMessageId(id) {
            const node = this.getNodeIfExists(id);
            if (!node) throw new Error(`missing node ${id}`);
            return node;
        },

        findNode(predicate) {
            return this.findNodeFromLeaf(predicate, this.currentLeafId);
        },

        findNodeFromLeaf(predicate, leafId, rootId = this.rootId) {
            const root = this.getNodeIfExists(rootId);
            let node = this.getNodeIfExists(leafId);

            while (root && node && node !== root) {
                if (predicate(node)) return node;
                node = this.getNodeIfExists(node.parentId);
            }

            return undefined;
        },

        getLeafFromNode(id) {
            let node = this.getNodeByIdOrMessageId(id);

            while (node.children.length > 0) {
                node = this.getNodeByIdOrMessageId(node.children[0]);
            }

            return node;
        },

        getBranch() {
            return this.getBranchFromLeaf(this.currentLeafId);
        },

        getBranchFromLeaf(id) {
            const branch = [];
            let node = this.getNodeByIdOrMessageId(id);

            while (node) {
                branch.push(node);
                if (node.id === this.rootId) break;
                node = this.getNodeByIdOrMessageId(node.parentId);
            }

            return branch.reverse();
        },

        addMessageNode() {},
        addOptimisticMessageNode() {},
        prependNode() {},
        prependOptismisticNode() {},
        processUpdate() {},
        deleteNode() {},
        clearNodeMessageParts() {},
        updateNodeMetadata() {},
        updateNodeMessage() {},
        updateNodeMessageMetadata() {},
        getParent(id) {
            const node = this.getNodeByIdOrMessageId(id);
            return this.getNodeByIdOrMessageId(node.parentId);
        },
    };

    return store;
}

function dispatchValidBridgeMessage(type, payload = {}) {
    dispatchBridgeMessage({
        source: "thread-optimizer",
        token: TOKEN,
        type,
        ...payload,
    });
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

    it("starts dormant and does not discover or optimize on bridge load", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        expect(bridge).toBeTruthy();
        expect(bridge.hasStore()).toBe(false);
        expect(bridge.__discoveryRuns).toBe(0);
        expect(bridge.__initTiming.lastApplyOptimizationMs).toBe(0);

        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__findNodePredicateCacheInstalled).toBe(false);
    });

    it("set-store-read-optimization only records requested state when no store exists", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        dispatchValidBridgeMessage("thread-optimizer:set-store-read-optimization", {
            enabled: true,
            debug: true,
        });

        expect(bridge.__storeReadOptimizationRequested).toBe(true);
        expect(bridge.__storeReadOptimizationDebug).toBe(true);

        expect(bridge.hasStore()).toBe(false);
        expect(bridge.__discoveryRuns).toBe(0);
        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__findNodePredicateCacheInstalled).toBe(false);
    });

    it("visible-messages-ready discovers, registers store, and installs optimizations once", () => {
        appendVisibleMessage("msg-3");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(4);

        const discoverSpy = vi
            .spyOn(bridge, "discoverNow")
            .mockImplementation(function discoverNowForTest() {
                this.__discoveryRuns += 1;
                return this.registerStore(fakeStore, {
                    source: "test-visible-messages-ready",
                });
            });

        dispatchValidBridgeMessage("thread-optimizer:set-store-read-optimization", {
            enabled: true,
            debug: false,
        });

        dispatchValidBridgeMessage("thread-optimizer:visible-messages-ready");

        expect(discoverSpy).toHaveBeenCalledTimes(1);
        expect(bridge.hasStore()).toBe(true);
        expect(bridge.getStore()).toBe(fakeStore);

        expect(bridge.__messageIdIndexInstalled).toBe(true);
        expect(bridge.__existingNodeStableCacheInstalled).toBe(true);
        expect(bridge.__findNodeFromLeafFrameCacheInstalled).toBe(true);
        expect(bridge.__findNodePredicateCacheInstalled).toBe(true);
        expect(bridge.__getLeafFromNodeFrameCacheInstalled).toBe(true);
        expect(bridge.__branchCacheInstalled).toBe(true);
        expect(bridge.__resolvedNodeFrameCacheInstalled).toBe(true);

        expect(bridge.__initTiming.lastApplyOptimizationMs).toBeGreaterThanOrEqual(0);
    });

    it("visible-messages-ready discovery is one-shot for the same conversation", () => {
        appendVisibleMessage("msg-3");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(4);

        const discoverSpy = vi
            .spyOn(bridge, "discoverNow")
            .mockImplementation(function discoverNowForTest() {
                this.__initTiming.discoveryRuns += 1;
                return this.registerStore(fakeStore, {
                    source: "test-visible-messages-ready",
                });
            });

        dispatchValidBridgeMessage("thread-optimizer:set-store-read-optimization", {
            enabled: true,
            debug: false,
        });

        dispatchValidBridgeMessage("thread-optimizer:visible-messages-ready");
        dispatchValidBridgeMessage("thread-optimizer:visible-messages-ready");

        expect(discoverSpy).toHaveBeenCalledTimes(1);
        expect(bridge.__visibleMessagesVerificationDone).toBe(true);
    });

    it("disableStoreReadOptimization uninstalls store wrappers", () => {
        appendVisibleMessage("msg-3");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(4);

        bridge.registerStore(fakeStore, {
            source: "test-register-store",
        });

        expect(bridge.__messageIdIndexInstalled).toBe(true);
        expect(bridge.__findNodePredicateCacheInstalled).toBe(true);

        const result = bridge.disableStoreReadOptimization();

        expect(result.ok).toBe(true);
        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__existingNodeStableCacheInstalled).toBe(false);
        expect(bridge.__findNodeFromLeafFrameCacheInstalled).toBe(false);
        expect(bridge.__findNodePredicateCacheInstalled).toBe(false);
        expect(bridge.__getLeafFromNodeFrameCacheInstalled).toBe(false);
        expect(bridge.__branchCacheInstalled).toBe(false);
        expect(bridge.__resolvedNodeFrameCacheInstalled).toBe(false);
    });

    it("resetInstalledStoreEnhancements clears registry-owned cache slots", () => {
        appendVisibleMessage("msg-3");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(4);

        bridge.registerStore(fakeStore, {
            source: "test-register-store",
        });

        expect(bridge.__messageIdIndex).toBeTruthy();
        expect(bridge.__findNodePredicateCache).toBeTruthy();

        bridge.resetInstalledStoreEnhancements();

        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__messageIdIndexOriginal).toBeNull();
        expect(bridge.__messageIdIndex).toBeNull();
        expect(bridge.__messageIdIndexStats).toBeNull();

        expect(bridge.__findNodePredicateCacheInstalled).toBe(false);
        expect(bridge.__findNodePredicateCacheOriginal).toBeNull();
        expect(bridge.__findNodePredicateCache).toBeNull();
        expect(bridge.__findNodePredicateCacheStats).toBeNull();

        expect(bridge.__branchCacheInstalled).toBe(false);
        expect(bridge.__branchCacheOriginals).toBeNull();
        expect(bridge.__branchCache).toBeNull();
        expect(bridge.__branchCacheStats).toBeNull();
    });

    it("creates profiled cache stats shape correctly", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore();

        bridge.registerStore(fakeStore, {
            source: "test-profiled-stats",
        });

        bridge.disableStoreReadOptimization();
        bridge.resetInstalledStoreEnhancements();

        const result = bridge.installResolvedNodeFrameCache({
            profiled: true,
        });

        expect(result.ok).toBe(true);
        expect(result.alreadyInstalled).not.toBe(true);

        const stats = bridge.__resolvedNodeFrameCacheStats;

        expect(stats).toBeTruthy();

        expect(stats.calls).toBe(0);
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);

        expect(stats.mode).toContain("profiled");

        expect(Array.isArray(stats.inputSamples)).toBe(true);
        expect(Array.isArray(stats.resultSamples)).toBe(true);
    });

    it("creates production cache stats shape correctly", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore();

        bridge.registerStore(fakeStore, {
            source: "test-production-stats",
        });

        bridge.disableStoreReadOptimization();
        bridge.resetInstalledStoreEnhancements();

        const result = bridge.installResolvedNodeFrameCache({
            profiled: false,
        });

        expect(result.ok).toBe(true);
        expect(result.alreadyInstalled).not.toBe(true);

        const stats = bridge.__resolvedNodeFrameCacheStats;

        expect(stats).toBeTruthy();

        expect(stats.mode).toContain("production");

        expect(stats.calls).toBeUndefined();
        expect(stats.inputSamples).toBeUndefined();
    });
});