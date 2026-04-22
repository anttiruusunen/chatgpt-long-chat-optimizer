(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";
    const METHOD_NAMES = [
        "messageIdToExistingNodeId",
        "getNodeIfExists",
        "deleteNode",
    ];

    const MAX_FIBER_NODES = 400;
    const MAX_OBJECT_NODES = 1500;
    const RETRY_INTERVAL_MS = 1000;
    const MAX_RETRIES = 60;

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    function isObjectLike(value) {
        return value !== null && (typeof value === "object" || typeof value === "function");
    }

    function looksLikeChatStore(value) {
        if (!isObjectLike(value)) return false;

        try {
            return METHOD_NAMES.every((name) => typeof value[name] === "function");
        } catch {
            return false;
        }
    }

    function getStoreInfo(store) {
        if (!store) {
            return { found: false };
        }

        let nodeCount = null;
        let currentLeafId = null;
        let rootId = null;

        try {
            const nodes = store.nodes;
            if (Array.isArray(nodes)) {
                nodeCount = nodes.length;
            } else if (nodes && typeof nodes === "object") {
                nodeCount = Object.keys(nodes).length;
            }
        } catch {}

        try {
            currentLeafId = store.currentLeafId ?? null;
        } catch {}

        try {
            rootId = store.rootId ?? null;
        } catch {}

        return {
            found: true,
            nodeCount,
            currentLeafId,
            rootId,
        };
    }

    function getReactFiberFromElement(element) {
        if (!(element instanceof Element)) return null;

        const keys = Object.getOwnPropertyNames(element);
        for (const key of keys) {
            if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
                return element[key] ?? null;
            }
        }

        return null;
    }

    function getConversationAnchors() {
        const anchors = [];

        const directTurns = document.querySelectorAll('section[data-testid^="conversation-turn-"]');
        for (const el of directTurns) {
            anchors.push(el);
        }

        const turnAttrs = document.querySelectorAll("section[data-turn]");
        for (const el of turnAttrs) {
            anchors.push(el);
        }

        const main = document.querySelector("main");
        if (main) {
            anchors.push(main);
        }

        return anchors;
    }

    function enqueueFiber(queue, seen, fiber) {
        if (!fiber || !isObjectLike(fiber) || seen.has(fiber)) return;
        seen.add(fiber);
        queue.push(fiber);
    }

    function collectFiberRoots() {
        const anchors = getConversationAnchors();
        const roots = [];
        const seen = new WeakSet();

        for (const anchor of anchors) {
            const fiber = getReactFiberFromElement(anchor);
            if (!fiber || seen.has(fiber)) continue;
            seen.add(fiber);
            roots.push(fiber);
        }

        return roots;
    }

    function scanObjectGraphForStore(seedValues) {
        const queue = [];
        const seen = new WeakSet();
        let visitedCount = 0;

        function push(value) {
            if (!isObjectLike(value)) return;
            if (seen.has(value)) return;
            seen.add(value);
            queue.push(value);
        }

        for (const value of seedValues) {
            push(value);
        }

        while (queue.length > 0 && visitedCount < MAX_OBJECT_NODES) {
            const value = queue.shift();
            visitedCount += 1;

            if (looksLikeChatStore(value)) {
                return {
                    store: value,
                    visitedCount,
                };
            }

            let proto = null;
            try {
                proto = Object.getPrototypeOf(value);
            } catch {}
            if (proto && proto !== Object.prototype && proto !== Function.prototype) {
                push(proto);
            }

            let keys = [];
            try {
                keys = Object.keys(value);
            } catch {}

            for (let i = 0; i < keys.length; i += 1) {
                const key = keys[i];

                let child;
                try {
                    child = value[key];
                } catch {
                    continue;
                }

                if (!isObjectLike(child)) continue;
                push(child);
            }
        }

        return {
            store: null,
            visitedCount,
        };
    }

    function discoverFromReactFiber() {
        const fiberRoots = collectFiberRoots();
        const fiberQueue = [];
        const seenFibers = new WeakSet();
        const candidateSeeds = [];
        let visitedFibers = 0;

        for (const root of fiberRoots) {
            enqueueFiber(fiberQueue, seenFibers, root);
        }

        while (fiberQueue.length > 0 && visitedFibers < MAX_FIBER_NODES) {
            const fiber = fiberQueue.shift();
            visitedFibers += 1;

            candidateSeeds.push(
                fiber,
                fiber.memoizedProps,
                fiber.pendingProps,
                fiber.memoizedState,
                fiber.stateNode,
                fiber.updateQueue,
                fiber.dependencies
            );

            enqueueFiber(fiberQueue, seenFibers, fiber.return);
            enqueueFiber(fiberQueue, seenFibers, fiber.child);
            enqueueFiber(fiberQueue, seenFibers, fiber.sibling);
            enqueueFiber(fiberQueue, seenFibers, fiber.alternate);
        }

        const objectResult = scanObjectGraphForStore(candidateSeeds);

        return {
            store: objectResult.store,
            visitedFibers,
            visitedObjects: objectResult.visitedCount,
            anchorCount: fiberRoots.length,
        };
    }

    const bridge = {
        __installed: true,
        __version: 5,
        __store: null,
        __lastError: null,
        __registeredAt: null,
        __meta: null,
        __discoveryRuns: 0,
        __lastVisitedFibers: 0,
        __lastVisitedObjects: 0,
        __lastAnchorCount: 0,
        __retryTimer: null,

        status() {
            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(this.__store),
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                discoveryRuns: this.__discoveryRuns,
                visitedFibers: this.__lastVisitedFibers,
                visitedObjects: this.__lastVisitedObjects,
                anchorCount: this.__lastAnchorCount,
                methods: {
                    deleteNode: Boolean(this.__store?.deleteNode),
                    getNodeIfExists: Boolean(this.__store?.getNodeIfExists),
                    messageIdToExistingNodeId: Boolean(
                        this.__store?.messageIdToExistingNodeId
                    ),
                },
                ...getStoreInfo(this.__store),
            };
        },

        hasStore() {
            return Boolean(this.__store);
        },

        getStore() {
            return this.__store;
        },

        clearStore() {
            this.__store = null;
            this.__registeredAt = null;
            this.__lastError = null;
            this.__meta = null;
        },

        registerStore(store, meta = null) {
            if (!looksLikeChatStore(store)) {
                this.__lastError =
                    "registerStore received a value that does not look like the chat store";
                return false;
            }

            this.__store = store;
            this.__registeredAt = Date.now();
            this.__lastError = null;
            this.__meta = meta;

            console.log("[thread-optimizer bridge] store registered", this.status());
            return true;
        },

        resolveNodeIdFromMessageId(messageId) {
            const store = this.__store;
            if (!store) {
                this.__lastError = "store not registered";
                return null;
            }

            try {
                const nodeId = store.messageIdToExistingNodeId(messageId);
                return nodeId ?? null;
            } catch (error) {
                this.__lastError = String(error?.message || error);
                console.warn(
                    "[thread-optimizer bridge] messageIdToExistingNodeId failed",
                    error
                );
                return null;
            }
        },

        getNodeByMessageId(messageId) {
            const store = this.__store;
            if (!store) {
                this.__lastError = "store not registered";
                return null;
            }

            const nodeId = this.resolveNodeIdFromMessageId(messageId);
            if (!nodeId) {
                return null;
            }

            try {
                return store.getNodeIfExists(nodeId) ?? null;
            } catch (error) {
                this.__lastError = String(error?.message || error);
                console.warn("[thread-optimizer bridge] getNodeIfExists failed", error);
                return null;
            }
        },

        deleteMessageById(messageId) {
            const store = this.__store;
            if (!store) {
                this.__lastError = "store not registered";
                return false;
            }

            const nodeId = this.resolveNodeIdFromMessageId(messageId);
            if (!nodeId) {
                this.__lastError = `no node found for message id: ${String(messageId)}`;
                return false;
            }

            try {
                store.deleteNode(nodeId);
                this.__lastError = null;
                return true;
            } catch (error) {
                this.__lastError = String(error?.message || error);
                console.warn("[thread-optimizer bridge] deleteNode failed", error);
                return false;
            }
        },

        discoverNow() {
            this.__discoveryRuns += 1;

            try {
                const result = discoverFromReactFiber();
                this.__lastVisitedFibers = result.visitedFibers;
                this.__lastVisitedObjects = result.visitedObjects;
                this.__lastAnchorCount = result.anchorCount;

                if (result.store) {
                    return this.registerStore(result.store, {
                        source: "react-fiber-scan",
                    });
                }

                return false;
            } catch (error) {
                this.__lastError = String(error?.message || error);
                console.warn("[thread-optimizer bridge] discovery failed", error);
                return false;
            }
        },

        startDiscoveryLoop() {
            if (this.__retryTimer) return;

            let attempts = 0;

            const tick = () => {
                attempts += 1;

                if (!this.__store) {
                    this.discoverNow();
                }

                if (this.__store || attempts >= MAX_RETRIES) {
                    this.__retryTimer = null;
                    return;
                }

                this.__retryTimer = window.setTimeout(tick, RETRY_INTERVAL_MS);
            };

            tick();
        },
    };

    window[GLOBAL_KEY] = bridge;
    bridge.startDiscoveryLoop();

    window.addEventListener(
        "load",
        () => {
            if (!bridge.hasStore()) {
                bridge.discoverNow();
            }
        },
        { once: true }
    );
})();