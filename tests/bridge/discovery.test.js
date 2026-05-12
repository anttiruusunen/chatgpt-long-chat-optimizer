import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    discoverStoreFromFiberRoot,
    scanObjectGraphForStore,
} from "../../src/page/chatStoreBridge/discovery.js";
import { rejectedStoreReasons } from "../../src/page/chatStoreBridge/storeValidation.js";

const BRIDGE_GLOBAL = "__threadOptimizerChatStoreBridge";

function createFakeStore({
    visibleMessageId = "msg-visible",
    visibleNodeId = "node-visible",
    extraNodes = [],
} = {}) {
    const visibleNode = {
        id: visibleNodeId,
        parentId: "root",
        children: [],
        message: {
            id: visibleMessageId,
            author: {
                role: "assistant",
            },
            metadata: {},
        },
    };

    const rootNode = {
        id: "root",
        parentId: null,
        children: [visibleNodeId],
        message: {
            id: "root-message",
            author: {
                role: "root",
            },
            metadata: {},
        },
    };

    const nodeMap = new Map([
        [rootNode.id, rootNode],
        [visibleNode.id, visibleNode],
    ]);

    for (const node of extraNodes) {
        nodeMap.set(node.id, node);
    }

    return {
        rootId: "root",
        currentLeafId: visibleNodeId,
        __nodeMap: nodeMap,

        get nodes() {
            return Array.from(nodeMap.values());
        },

        deleteNode(id) {
            nodeMap.delete(id);
        },

        getNodeIfExists(id) {
            const nodeId = this.messageIdToExistingNodeId(id);
            return nodeId ? nodeMap.get(nodeId) : undefined;
        },

        messageIdToExistingNodeId(id) {
            if (nodeMap.has(id)) return id;

            for (const node of nodeMap.values()) {
                if (
                    node.message?.id === id ||
                    node.message?.message_id === id ||
                    node.message?.metadata?.message_id === id
                ) {
                    return node.id;
                }
            }

            return null;
        },
    };
}

function appendVisibleMessage(messageId = "msg-visible") {
    document.body.innerHTML = `
        <main>
            <section
                data-testid="conversation-turn-1"
                data-message-id="${messageId}"
            >
                visible
            </section>
        </main>
    `;
}

function createExpensiveObjectChain(length = 1000) {
    const root = {};
    let current = root;

    for (let i = 0; i < length; i += 1) {
        current.next = {
            index: i,
        };
        current = current.next;
    }

    return root;
}

function installBridgeStub() {
    window[BRIDGE_GLOBAL] = {
        __nodeIdDirectIndexSource: null,
        __nodeIdDirectIndex: null,
        __nodeObjectCacheApi: null,
    };
}

describe("chatStoreBridge discovery", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        rejectedStoreReasons.clear();
        installBridgeStub();

        vi.spyOn(console, "debug").mockImplementation(() => {});
    });

    afterEach(() => {
        document.body.innerHTML = "";
        delete window[BRIDGE_GLOBAL];

        vi.restoreAllMocks();
    });

    it("finds a valid store through a fiber root", () => {
        appendVisibleMessage("msg-visible");

        const store = createFakeStore();

        const fiberRoot = {
            memoizedState: {
                store,
            },
        };

        const result = discoverStoreFromFiberRoot(fiberRoot, {
            maxFibers: 100,
            maxObjects: 1000,
        });

        expect(result.store).toBe(store);
        expect(result.visitedFibers).toBeGreaterThan(0);
        expect(result.visitedObjects).toBeGreaterThan(0);
    });

    it("short-circuits object graph scanning after finding a visible-message-resolving store", () => {
        appendVisibleMessage("msg-visible");

        const store = createFakeStore();
        const expensiveBranch = createExpensiveObjectChain(1000);

        const root = {
            store,
            expensiveBranch,
        };

        const result = scanObjectGraphForStore(root, {
            maxFibers: 100,
            maxObjects: 15000,
        });

        expect(result.store).toBe(store);
        expect(result.visitedObjects).toBeLessThan(50);
    });

    it("short-circuits fiber discovery after finding a visible-message-resolving store", () => {
        appendVisibleMessage("msg-visible");

        const store = createFakeStore();
        const expensiveBranch = createExpensiveObjectChain(1000);

        const fiberRoot = {
            memoizedState: {
                store,
                expensiveBranch,
            },
            stateNode: null,
            memoizedProps: null,
            pendingProps: null,
            updateQueue: null,
            dependencies: null,
            child: null,
            sibling: null,
            return: null,
        };

        const result = discoverStoreFromFiberRoot(fiberRoot, {
            maxFibers: 100,
            maxObjects: 15000,
        });

        expect(result.store).toBe(store);
        expect(result.visitedFibers).toBe(1);
        expect(result.visitedObjects).toBeLessThan(50);
    });

    it("continues scanning when an early store cannot resolve the newest visible message", () => {
        appendVisibleMessage("msg-visible");

        const wrongStore = createFakeStore({
            visibleMessageId: "msg-not-visible",
            visibleNodeId: "node-not-visible",
        });

        const correctStore = createFakeStore({
            visibleMessageId: "msg-visible",
            visibleNodeId: "node-visible",
        });

        const root = {
            wrongStore,
            nested: {
                correctStore,
            },
        };

        const result = scanObjectGraphForStore(root, {
            maxFibers: 100,
            maxObjects: 1000,
        });

        expect(result.store).toBe(correctStore);
        expect(result.store).not.toBe(wrongStore);
    });
});