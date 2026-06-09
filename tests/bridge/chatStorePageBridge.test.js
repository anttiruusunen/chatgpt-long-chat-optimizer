import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    deleteStoreNodeFresh,
} from "../../src/page/chatStoreBridge/storeTopology.js";

const BRIDGE_PATH = path.resolve("src/page/chatStorePageBridge.js");
const BRIDGE_GLOBAL = "__threadOptimizerChatStoreBridge";
const TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";
const TOKEN = "0123456789abcdef0123456789abcdef";

const ESBUILD_BIN = path.resolve("node_modules/esbuild/bin/esbuild");

const bundledBridgeSources = new Map();

function getBundledBridgeSource({ bridgeProfile = false } = {}) {
    const cacheKey = bridgeProfile ? "profiled" : "production";

    if (bundledBridgeSources.has(cacheKey)) {
        return bundledBridgeSources.get(cacheKey);
    }

    const source = execFileSync(
        ESBUILD_BIN,
        [
            BRIDGE_PATH,
            "--bundle",
            "--format=iife",
            "--platform=browser",
            "--target=es2020",
            "--legal-comments=none",
            `--define:__DEV__=false`,
            `--define:__PROFILE__=${bridgeProfile}`,
        ],
        {
            encoding: "utf8",
        }
    );

    bundledBridgeSources.set(cacheKey, source);
    return source;
}

function loadBridgeWithCurrentScript(scriptEl, options = {}) {
    Object.defineProperty(document, "currentScript", {
        configurable: true,
        get: () => scriptEl,
    });

    window.eval(getBundledBridgeSource(options));
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

function dispatchValidBridgeMessage(type, payload = {}) {
    dispatchBridgeMessage({
        source: "thread-optimizer",
        token: TOKEN,
        type,
        ...payload,
    });
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
        __nodeMap: nodeMap,

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

        getParent(id) {
            const node = this.getNodeByIdOrMessageId(id);
            return this.getNodeByIdOrMessageId(node.parentId);
        },

        deleteNode(id) {
            const node = this.getNodeByIdOrMessageId(id);
            const parent = this.getNodeIfExists(node.parentId);

            if (!parent) return;

            for (const childId of node.children) {
                const child = this.getNodeIfExists(childId);
                if (child) {
                    child.parentId = parent.id;
                }
            }

            parent.children = parent.children.flatMap((childId) =>
                childId === node.id ? node.children : [childId]
            );

            nodeMap.delete(node.id);
        },

        addMessageNode() {},
        addOptimisticMessageNode() {},
        prependNode() {},
        prependOptismisticNode() {},
        processUpdate() {},
        clearNodeMessageParts() {},
        updateNodeMetadata() {},
        updateNodeMessage() {},
        updateNodeMessageMetadata() {},
    };

    return store;
}

describe("chatStorePageBridge", () => {
    let script;

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    beforeEach(() => {
        vi.useFakeTimers();
        document.documentElement.innerHTML = "";
        document.body.innerHTML = "";
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
            historyKeptExchanges: 3,
        });

        expect(bridge.__knownPruningEnabled).toBe(true);
        expect(bridge.__knownPrunedTurnCount).toBe(5);
        expect(bridge.__knownHistoryKeptExchanges).toBe(3);
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

    it("handles store-history prune safely without a store", () => {
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];

        expect(() => {
            dispatchValidBridgeMessage("thread-optimizer:prune-store-history", {
                historyKeptExchanges: 1,
                reason: "test-no-store",
            });
        }).not.toThrow();

        expect(bridge.hasStore()).toBe(false);
    });

    it("store-prunes old active-branch nodes and keeps wrappers installed", () => {
        appendVisibleMessage("msg-4");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(5);

        bridge.registerStore(fakeStore, {
            source: "test-store-prune",
        });

        const deleteSpy = vi.spyOn(fakeStore, "deleteNode");
        const disableSpy = vi.spyOn(bridge, "disableStoreReadOptimization");
        const resetSpy = vi.spyOn(bridge, "resetInstalledStoreEnhancements");

        const epochBefore = bridge.__storeReadEpoch;

        const result = bridge.pruneStoreHistory({
            historyKeptExchanges: 1,
            reason: "test-store-prune",
        });

        expect(result.ok).toBe(true);
        expect(result.deleted.length).toBeGreaterThan(0);
        expect(deleteSpy).toHaveBeenCalled();

        expect(fakeStore.__nodeMap.has("node-1")).toBe(false);
        expect(fakeStore.__nodeMap.has("node-2")).toBe(false);
        expect(fakeStore.__nodeMap.has("node-3")).toBe(true);
        expect(fakeStore.__nodeMap.has("node-4")).toBe(true);

        expect(bridge.__storeReadEpoch).toBeGreaterThan(epochBefore);

        expect(bridge.__messageIdIndexInstalled).toBe(true);
        expect(bridge.__existingNodeStableCacheInstalled).toBe(true);
        expect(bridge.__branchCacheInstalled).toBe(true);

        expect(disableSpy).not.toHaveBeenCalled();
        expect(resetSpy).not.toHaveBeenCalled();
    });

    it("handles prune-store-history bridge messages through the active store", () => {
        appendVisibleMessage("msg-4");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(5);

        bridge.registerStore(fakeStore, {
            source: "test-prune-store-history-message",
        });

        const pruneSpy = vi.spyOn(bridge, "pruneStoreHistory");

        dispatchValidBridgeMessage("thread-optimizer:prune-store-history", {
            historyKeptExchanges: 1,
            reason: "test-prune-store-history-message",
        });

        expect(pruneSpy).toHaveBeenCalledWith({
            historyKeptExchanges: 1,
            reason: "test-prune-store-history-message",
        });

        expect(fakeStore.__nodeMap.has("node-1")).toBe(false);
        expect(fakeStore.__nodeMap.has("node-2")).toBe(false);
        expect(fakeStore.__nodeMap.has("node-3")).toBe(true);
        expect(fakeStore.__nodeMap.has("node-4")).toBe(true);
    });

    it("does not delete the current leaf during store-history prune", () => {
        appendVisibleMessage("msg-4");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(5);

        bridge.registerStore(fakeStore, {
            source: "test-store-prune-current-leaf",
        });

        const result = bridge.pruneStoreHistory({
            historyKeptExchanges: 1,
            reason: "test-current-leaf",
        });

        expect(result.ok).toBe(true);
        expect(result.keepNodeIds).toContain("node-4");
        expect(result.deleteNodeIds).not.toContain("node-4");
        expect(fakeStore.getNodeIfExists("node-4")).toBeTruthy();
    });

    it("purges deleted node aliases from direct caches during store-history prune", () => {
        appendVisibleMessage("msg-4");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(5);

        bridge.registerStore(fakeStore, {
            source: "test-cache-purge",
        });

        const node = fakeStore.getNodeIfExists("msg-2");

        bridge.__nodeObjectCache?.set("node-2", node);
        bridge.__nodeObjectCache?.set("msg-2", node);
        bridge.__messageIdIndex?.set("msg-2", "node-2");
        bridge.__messageIdIndex?.set("node-2", "node-2");
        bridge.__nodeIdDirectIndex?.set("node-2", node);

        const result = bridge.pruneStoreHistory({
            historyKeptExchanges: 1,
            reason: "test-cache-purge",
        });

        expect(result.deleted.some((entry) => entry.nodeId === "node-2")).toBe(true);

        expect(bridge.__nodeObjectCache?.has("node-2")).toBe(false);
        expect(bridge.__nodeObjectCache?.has("msg-2")).toBe(false);
        expect(bridge.__messageIdIndex?.has("msg-2")).toBe(false);
        expect(bridge.__messageIdIndex?.has("node-2")).toBe(false);
        expect(
            bridge.__nodeIdDirectIndex == null ||
                bridge.__nodeIdDirectIndex.has("node-2") === false
        ).toBe(true);
    });

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
        expect(bridge.__branchCacheInstalled).toBe(true);

        const result = bridge.disableStoreReadOptimization();

        expect(result.ok).toBe(true);
        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__existingNodeStableCacheInstalled).toBe(false);
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
        expect(bridge.__branchCache).toBeTruthy();

        bridge.resetInstalledStoreEnhancements();

        expect(bridge.__messageIdIndexInstalled).toBe(false);
        expect(bridge.__messageIdIndexOriginal).toBeNull();
        expect(bridge.__messageIdIndex).toBeNull();
        expect(bridge.__messageIdIndexStats).toBeNull();

        expect(bridge.__branchCacheInstalled).toBe(false);
        expect(bridge.__branchCacheOriginals).toBeNull();
        expect(bridge.__branchCache).toBeNull();
        expect(bridge.__branchCacheStats).toBeNull();
    });

    it("creates profiled cache stats shape correctly", () => {
        loadBridgeWithCurrentScript(script, {
            bridgeProfile: true,
        });

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore();

        bridge.registerStore(fakeStore, {
            source: "test-profiled-stats",
        });

        bridge.disableStoreReadOptimization();
        bridge.resetInstalledStoreEnhancements();

        const result = bridge.installResolvedNodeFrameCache();

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

        const result = bridge.installResolvedNodeFrameCache();

        expect(result.ok).toBe(true);
        expect(result.alreadyInstalled).not.toBe(true);

        const stats = bridge.__resolvedNodeFrameCacheStats;

        expect(stats).toBeTruthy();

        expect(stats.mode).toContain("production");

        expect(stats.calls).toBeUndefined();
        expect(stats.inputSamples).toBeUndefined();
    });

    it("repairDeletedNodeReferences removes deleted ids from remaining children arrays", () => {
        appendVisibleMessage("msg-4");
        loadBridgeWithCurrentScript(script);

        const bridge = window[BRIDGE_GLOBAL];
        const fakeStore = createFakeStore(5);

        bridge.registerStore(fakeStore, {
            source: "test-direct-repair",
        });

        fakeStore.__nodeMap.delete("node-2");
        fakeStore.getNodeIfExists("node-1").children.push("node-2");

        const result = bridge.repairDeletedNodeReferences(["node-2"]);

        expect(result.ok).toBe(true);
        expect(result.repairedParents).toBeGreaterThan(0);
        expect(fakeStore.getNodeIfExists("node-1").children).not.toContain("node-2");
    });
    it("starts initial-load hiding dormant until settings are received", () => {
        window.fetch = vi.fn(() =>
            Promise.resolve(
                new Response("{}", {
                    status: 200,
                    headers: { "content-type": "application/json" },
                })
            )
        );

        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL].status().initialLoadHiding).toMatchObject({
            installed: true,
            enabled: false,
            settingsReady: false,
            historyKeptExchanges: 1,
        });
    });

    it("applies early initial-load hiding settings already present on the DOM before the page bridge loads", () => {
        window.fetch = vi.fn();

        document.documentElement.setAttribute(
            "data-thread-optimizer-initial-load-hiding-settings",
            JSON.stringify({
                enabled: true,
                historyKeptExchanges: 5,
                debug: true,
            })
        );

        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL].status().initialLoadHiding).toMatchObject({
            installed: true,
            enabled: true,
            settingsReady: true,
            historyKeptExchanges: 5,
            debug: true,
        });
    });

    it("applies early initial-load hiding settings from the DOM event after the page bridge loads", () => {
        window.fetch = vi.fn();

        loadBridgeWithCurrentScript(script);

        document.documentElement.setAttribute(
            "data-thread-optimizer-initial-load-hiding-settings",
            JSON.stringify({
                enabled: true,
                historyKeptExchanges: 4,
                debug: false,
            })
        );

        document.dispatchEvent(
            new Event("thread-optimizer:initial-load-hiding-settings")
        );

        expect(window[BRIDGE_GLOBAL].status().initialLoadHiding).toMatchObject({
            installed: true,
            enabled: true,
            settingsReady: true,
            historyKeptExchanges: 4,
            debug: false,
        });
    });

    it("ignores invalid early initial-load hiding DOM settings", () => {
        window.fetch = vi.fn();

        document.documentElement.setAttribute(
            "data-thread-optimizer-initial-load-hiding-settings",
            "{not-json"
        );

        loadBridgeWithCurrentScript(script);

        expect(window[BRIDGE_GLOBAL].status().initialLoadHiding).toMatchObject({
            installed: true,
            enabled: false,
            settingsReady: false,
            historyKeptExchanges: 1,
        });
    });

    it("applies runtime initial-load hiding settings from trusted bridge messages", () => {
        window.fetch = vi.fn();

        loadBridgeWithCurrentScript(script);

        dispatchValidBridgeMessage("thread-optimizer:set-initial-load-hiding", {
            enabled: true,
            historyKeptExchanges: 6,
            debug: true,
        });

        expect(window[BRIDGE_GLOBAL].status().initialLoadHiding).toMatchObject({
            installed: true,
            enabled: true,
            settingsReady: true,
            historyKeptExchanges: 6,
            debug: true,
        });
    });


    it("uses deleteClientOnlyMessage as a fallback delete method", () => {
        const nodes = {
            root: {
                id: "root",
                parentId: "",
                children: ["old-node"],
                message: {
                    id: "root",
                    author: { role: "root" },
                },
            },
            "old-node": {
                id: "old-node",
                parentId: "root",
                children: ["child-node"],
                message: {
                    id: "msg-old",
                    author: { role: "assistant" },
                },
            },
            "child-node": {
                id: "child-node",
                parentId: "old-node",
                children: [],
                message: {
                    id: "msg-child",
                    author: { role: "assistant" },
                },
            },
        };

        const store = {
            get nodes() {
                return nodes;
            },
            deleteClientOnlyMessage: vi.fn((nodeId) => {
                const node = nodes[nodeId];
                const parent = nodes[node.parentId];

                for (const childId of node.children) {
                    nodes[childId].parentId = node.parentId;
                }

                parent.children = parent.children.flatMap((childId) =>
                    childId === node.id ? node.children : [childId]
                );

                delete nodes[node.id];
            }),
        };

        const result = deleteStoreNodeFresh(store, "old-node");

        expect(result.ok).toBe(true);
        expect(result.deleteMethod).toBe("deleteClientOnlyMessage");
        expect(store.deleteClientOnlyMessage).toHaveBeenCalledWith("old-node");
        expect(nodes["old-node"]).toBeUndefined();
        expect(nodes["child-node"].parentId).toBe("root");
        expect(nodes.root.children).toEqual(["child-node"]);
    });
});
