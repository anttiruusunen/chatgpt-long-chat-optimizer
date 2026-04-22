(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";
    const BRIDGE_VERSION = 5;

    const MAX_FIBERS = 4000;
    const MAX_OBJECTS = 12000;
    const DISCOVERY_RETRY_MS = 1200;
    const MAX_DISCOVERY_RUNS = 30;

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    function isObjectLike(value) {
        return value !== null && (typeof value === "object" || typeof value === "function");
    }

    function safeCall(value) {
        try {
            return typeof value === "function" ? value() : value;
        } catch {
            return null;
        }
    }

    function looksLikeStore(value) {
        if (!isObjectLike(value)) return false;

        try {
            return (
                typeof value.deleteNode === "function" &&
                typeof value.getNodeIfExists === "function" &&
                typeof value.messageIdToExistingNodeId === "function"
            );
        } catch {
            return false;
        }
    }

    function getStoreInfo(store) {
        if (!store) {
            return {
                found: false,
                nodeCount: null,
                rootId: null,
                currentLeafId: null,
            };
        }

        let nodeCount = null;
        let rootId = null;
        let currentLeafId = null;

        try {
            const nodesValue = store.nodes;
            if (nodesValue && typeof nodesValue === "object") {
                nodeCount = Array.isArray(nodesValue)
                    ? nodesValue.length
                    : Object.keys(nodesValue).length;
            }
        } catch {}

        try {
            rootId = safeCall(store.rootId);
        } catch {}

        try {
            currentLeafId = safeCall(store.currentLeafId);
        } catch {}

        return {
            found: true,
            nodeCount,
            rootId,
            currentLeafId,
        };
    }

    function getFiberRoots() {
        const roots = [];

        const pushRoot = (value) => {
            if (value && !roots.includes(value)) {
                roots.push(value);
            }
        };

        const all = document.querySelectorAll("*");
        for (let i = 0; i < all.length; i += 1) {
            const el = all[i];
            const keys = Object.keys(el);

            for (let j = 0; j < keys.length; j += 1) {
                const key = keys[j];
                if (
                    key.startsWith("__reactFiber$") ||
                    key.startsWith("__reactContainer$") ||
                    key.startsWith("__reactInternalInstance$")
                ) {
                    pushRoot(el[key]);
                }
            }
        }

        return roots;
    }

    function scanObjectGraphForStore(root, limits) {
        const seen = new WeakSet();
        const queue = [root];
        let visitedObjects = 0;

        while (queue.length > 0) {
            const current = queue.shift();

            if (!isObjectLike(current)) continue;
            if (seen.has(current)) continue;

            seen.add(current);
            visitedObjects += 1;

            if (visitedObjects > limits.maxObjects) {
                break;
            }

            if (looksLikeStore(current)) {
                return {
                    store: current,
                    visitedObjects,
                };
            }

            let keys;
            try {
                keys = Reflect.ownKeys(current);
            } catch {
                continue;
            }

            for (let i = 0; i < keys.length; i += 1) {
                const key = keys[i];

                if (
                    key === "window" ||
                    key === "self" ||
                    key === "globalThis" ||
                    key === "ownerDocument" ||
                    key === "document" ||
                    key === "parentNode" ||
                    key === "parentElement" ||
                    key === "nextSibling" ||
                    key === "previousSibling"
                ) {
                    continue;
                }

                let child;
                try {
                    child = current[key];
                } catch {
                    continue;
                }

                if (!isObjectLike(child)) continue;
                queue.push(child);
            }
        }

        return {
            store: null,
            visitedObjects,
        };
    }

    function discoverStoreFromFiberRoot(root, limits) {
        const seenFibers = new WeakSet();
        const fiberQueue = [root];
        let visitedFibers = 0;
        let visitedObjects = 0;

        while (fiberQueue.length > 0) {
            const fiber = fiberQueue.shift();

            if (!isObjectLike(fiber)) continue;
            if (seenFibers.has(fiber)) continue;

            seenFibers.add(fiber);
            visitedFibers += 1;

            if (visitedFibers > limits.maxFibers) {
                break;
            }

            const candidates = [
                fiber,
                fiber.stateNode,
                fiber.memoizedState,
                fiber.memoizedProps,
                fiber.pendingProps,
                fiber.updateQueue,
                fiber.dependencies,
                fiber.return,
                fiber.child,
                fiber.sibling,
            ];

            for (let i = 0; i < candidates.length; i += 1) {
                const candidate = candidates[i];
                if (!isObjectLike(candidate)) continue;

                if (looksLikeStore(candidate)) {
                    return {
                        store: candidate,
                        visitedFibers,
                        visitedObjects,
                    };
                }

                const scanned = scanObjectGraphForStore(candidate, limits);
                visitedObjects += scanned.visitedObjects;

                if (scanned.store) {
                    return {
                        store: scanned.store,
                        visitedFibers,
                        visitedObjects,
                    };
                }
            }

            if (fiber.child) fiberQueue.push(fiber.child);
            if (fiber.sibling) fiberQueue.push(fiber.sibling);
            if (fiber.return) fiberQueue.push(fiber.return);
        }

        return {
            store: null,
            visitedFibers,
            visitedObjects,
        };
    }

    const bridge = {
        __installed: true,
        __version: BRIDGE_VERSION,
        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,
        __found: false,
        __anchorCount: 0,
        __discoveryRuns: 0,
        __visitedFibers: 0,
        __visitedObjects: 0,

        status() {
            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(this.__store),
                found: this.__found,
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                discoveryRuns: this.__discoveryRuns,
                anchorCount: this.__anchorCount,
                visitedFibers: this.__visitedFibers,
                visitedObjects: this.__visitedObjects,
                methods: {
                    deleteNode: Boolean(this.__store && typeof this.__store.deleteNode === "function"),
                    getNodeIfExists: Boolean(
                        this.__store && typeof this.__store.getNodeIfExists === "function"
                    ),
                    messageIdToExistingNodeId: Boolean(
                        this.__store &&
                            typeof this.__store.messageIdToExistingNodeId === "function"
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
            this.__meta = null;
            this.__found = false;
        },

        registerStore(store, meta = null) {
            if (!looksLikeStore(store)) {
                this.__lastError =
                    "registerStore received a value that does not look like the chat store";
                return false;
            }

            this.__store = store;
            this.__registeredAt = Date.now();
            this.__lastError = null;
            this.__meta = meta;
            this.__found = true;

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
                this.__lastError = null;
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
                const node = store.getNodeIfExists(nodeId) ?? null;
                this.__lastError = null;
                return node;
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

            const roots = getFiberRoots();
            this.__anchorCount = roots.length;

            let totalVisitedFibers = 0;
            let totalVisitedObjects = 0;

            for (let i = 0; i < roots.length; i += 1) {
                const result = discoverStoreFromFiberRoot(roots[i], {
                    maxFibers: MAX_FIBERS,
                    maxObjects: MAX_OBJECTS,
                });

                totalVisitedFibers += result.visitedFibers;
                totalVisitedObjects += result.visitedObjects;

                if (result.store) {
                    this.__visitedFibers = totalVisitedFibers;
                    this.__visitedObjects = totalVisitedObjects;
                    return this.registerStore(result.store, {
                        source: "react-fiber-scan",
                    });
                }
            }

            this.__visitedFibers = totalVisitedFibers;
            this.__visitedObjects = totalVisitedObjects;
            return false;
        },

        startDiscoveryLoop() {
            if (this.__store) {
                return;
            }

            let attempts = 0;

            const tick = () => {
                attempts += 1;

                if (!this.__store) {
                    try {
                        this.discoverNow();
                    } catch (error) {
                        this.__lastError = String(error?.message || error);
                        console.warn("[thread-optimizer bridge] discovery failed", error);
                    }
                }

                if (this.__store || attempts >= MAX_DISCOVERY_RUNS) {
                    return;
                }

                window.setTimeout(tick, DISCOVERY_RETRY_MS);
            };

            tick();
        },
    };

    window[GLOBAL_KEY] = bridge;
    bridge.startDiscoveryLoop();
})();