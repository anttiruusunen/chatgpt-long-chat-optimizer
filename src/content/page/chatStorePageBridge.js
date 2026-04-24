(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";
    const MESSAGE_SOURCE = "thread-optimizer";
    const VERSION = 10;

    if (window[GLOBAL_KEY]?.installed && window[GLOBAL_KEY]?.version >= VERSION) {
        return;
    }

    const prunedMessageIds = [];

    function isObjectLike(value) {
        return value !== null && (typeof value === "object" || typeof value === "function");
    }

    function isString(value) {
        return typeof value === "string" && value.length > 0;
    }

    function safeGet(value, key) {
        try {
            return value?.[key];
        } catch {
            return undefined;
        }
    }

    function safeCall(fn, thisArg, ...args) {
        try {
            return fn.apply(thisArg, args);
        } catch (error) {
            return { __threadOptimizerCallError: error };
        }
    }

    function hasFunction(value, key) {
        return typeof safeGet(value, key) === "function";
    }

    function looksLikeChatTreeStore(value) {
        if (!isObjectLike(value)) {
            return false;
        }

        return (
            hasFunction(value, "messageIdToExistingNodeId") &&
            hasFunction(value, "getNodeIfExists") &&
            hasFunction(value, "deleteNode")
        );
    }

    function readStoreValue(store, key) {
        try {
            const value = store?.[key];
            return typeof value === "function" ? value() : value;
        } catch {
            return null;
        }
    }

    function getReactFiberFromElement(element) {
        if (!element || typeof element !== "object") {
            return null;
        }

        for (const key of Object.keys(element)) {
            if (
                key.startsWith("__reactFiber$") ||
                key.startsWith("__reactInternalInstance$")
            ) {
                return element[key];
            }
        }

        return null;
    }

    function shouldSkipObject(value) {
        if (!isObjectLike(value)) {
            return true;
        }

        if (value === window || value === document || value === document.documentElement) {
            return true;
        }

        if (value instanceof Window || value instanceof Document || value instanceof Element) {
            return true;
        }

        return false;
    }

    function getSafeObjectValues(value) {
        if (!isObjectLike(value)) {
            return [];
        }

        try {
            const descriptors = Object.getOwnPropertyDescriptors(value);
            const values = [];

            for (const descriptor of Object.values(descriptors)) {
                if ("value" in descriptor && isObjectLike(descriptor.value)) {
                    values.push(descriptor.value);
                }
            }

            return values;
        } catch {
            return [];
        }
    }

    function getCandidateAnchorElements() {
        const selectors = [
            "main",
            "[role='main']",
            "article",
            "[data-message-id]",
            "[data-testid]",
            "[data-testid*='conversation']",
            "[data-testid*='turn']",
        ];

        const anchors = new Set();

        for (const selector of selectors) {
            try {
                for (const element of document.querySelectorAll(selector)) {
                    anchors.add(element);
                    if (anchors.size >= 500) {
                        return [...anchors];
                    }
                }
            } catch {
                // ignore selector failures
            }
        }

        try {
            for (const element of document.body?.querySelectorAll("*") || []) {
                anchors.add(element);
                if (anchors.size >= 500) {
                    break;
                }
            }
        } catch {
            // ignore
        }

        return [...anchors];
    }

    const bridge = {
        installed: true,
        version: VERSION,

        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,

        __discoveryRuns: 0,
        __visitedFibers: 0,
        __visitedObjects: 0,
        __anchorCount: 0,
        __found: false,

        registerStore(store, meta = null) {
            if (!looksLikeChatTreeStore(store)) {
                this.__lastError =
                    "registerStore received a value that does not look like the chat tree store";
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

        clearStore() {
            this.__store = null;
            this.__registeredAt = null;
            this.__meta = null;
            this.__found = false;
        },

        getStore() {
            return this.__store;
        },

        hasStore() {
            return looksLikeChatTreeStore(this.__store);
        },

        status() {
            const store = this.__store;

            return {
                installed: true,
                version: VERSION,
                hasStore: this.hasStore(),
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                found: this.__found,
                discoveryRuns: this.__discoveryRuns,
                visitedFibers: this.__visitedFibers,
                visitedObjects: this.__visitedObjects,
                anchorCount: this.__anchorCount,
                rootId: store ? readStoreValue(store, "rootId") : null,
                currentLeafId: store ? readStoreValue(store, "currentLeafId") : null,
                nodeCount: Array.isArray(readStoreValue(store, "nodes"))
                    ? readStoreValue(store, "nodes").length
                    : null,
                methods: {
                    deleteNode: hasFunction(store, "deleteNode"),
                    getNodeIfExists: hasFunction(store, "getNodeIfExists"),
                    messageIdToExistingNodeId: hasFunction(
                        store,
                        "messageIdToExistingNodeId"
                    ),
                },
                prunedMessageIds: prunedMessageIds.length,
            };
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

        rememberPrunedMessageId(messageId) {
            if (!isString(messageId)) {
                return false;
            }

            if (!prunedMessageIds.includes(messageId)) {
                prunedMessageIds.push(messageId);
            }

            return true;
        },

        getPrunedMessageIds() {
            return [...prunedMessageIds];
        },

        clearPrunedMessageIds() {
            prunedMessageIds.length = 0;
            return true;
        },

        getPrunedNode(indexOrMessageId = 0) {
            const messageId =
                typeof indexOrMessageId === "number"
                    ? prunedMessageIds[indexOrMessageId]
                    : indexOrMessageId;

            if (!messageId) {
                return null;
            }

            return this.getNodeByMessageId(messageId);
        },

        deletePrunedMessage(indexOrMessageId = 0) {
            const messageId =
                typeof indexOrMessageId === "number"
                    ? prunedMessageIds[indexOrMessageId]
                    : indexOrMessageId;

            if (!messageId) {
                return {
                    ok: false,
                    deleted: false,
                    messageId: null,
                    reason: "missing-message-id",
                };
            }

            const nodeBefore = this.getNodeByMessageId(messageId);
            const deleted = this.deleteMessageById(messageId);
            const nodeAfter = this.getNodeByMessageId(messageId);

            return {
                ok: deleted,
                deleted,
                messageId,
                nodeId: nodeBefore?.id ?? null,
                nodeBefore,
                nodeAfter,
                reason: deleted ? null : this.__lastError,
            };
        },

        discoverNow() {
            this.__discoveryRuns += 1;

            const anchors = getCandidateAnchorElements();
            this.__anchorCount = anchors.length;

            const visitedFibers = new Set();
            const visitedObjects = new Set();

            const fiberQueue = [];
            const objectQueue = [];

            for (const element of anchors) {
                const fiber = getReactFiberFromElement(element);
                if (fiber) {
                    fiberQueue.push(fiber);
                }
            }

            while (fiberQueue.length && visitedFibers.size < 800) {
                const fiber = fiberQueue.shift();

                if (!isObjectLike(fiber) || visitedFibers.has(fiber)) {
                    continue;
                }

                visitedFibers.add(fiber);

                if (isObjectLike(fiber.memoizedProps)) {
                    objectQueue.push(fiber.memoizedProps);
                }

                if (isObjectLike(fiber.memoizedState)) {
                    objectQueue.push(fiber.memoizedState);
                }

                if (isObjectLike(fiber.stateNode) && !(fiber.stateNode instanceof Element)) {
                    objectQueue.push(fiber.stateNode);
                }

                if (isObjectLike(fiber.child)) {
                    fiberQueue.push(fiber.child);
                }

                if (isObjectLike(fiber.sibling)) {
                    fiberQueue.push(fiber.sibling);
                }

                if (isObjectLike(fiber.return)) {
                    fiberQueue.push(fiber.return);
                }
            }

            while (objectQueue.length && visitedObjects.size < 30000) {
                const value = objectQueue.shift();

                if (!isObjectLike(value) || visitedObjects.has(value) || shouldSkipObject(value)) {
                    continue;
                }

                visitedObjects.add(value);

                if (looksLikeChatTreeStore(value)) {
                    this.__visitedFibers = visitedFibers.size;
                    this.__visitedObjects = visitedObjects.size;
                    return this.registerStore(value, { source: "react-fiber-scan" });
                }

                for (const child of getSafeObjectValues(value)) {
                    if (!visitedObjects.has(child)) {
                        objectQueue.push(child);
                    }
                }
            }

            this.__visitedFibers = visitedFibers.size;
            this.__visitedObjects = visitedObjects.size;
            return false;
        },

        startDiscoveryLoop() {
            if (this.hasStore()) {
                return true;
            }

            const delays = [0, 250, 750, 1500, 3000, 5000, 8000, 12000];

            for (const delay of delays) {
                window.setTimeout(() => {
                    if (!this.hasStore()) {
                        this.discoverNow();
                    }
                }, delay);
            }

            return true;
        },
    };

    window[GLOBAL_KEY] = bridge;

    window.addEventListener("message", (event) => {
        if (event.source !== window) {
            return;
        }

        const data = event.data;
        if (!data || data.source !== MESSAGE_SOURCE) {
            return;
        }

        if (data.type === "THREAD_OPTIMIZER_PRUNED_MESSAGE_ID") {
            bridge.rememberPrunedMessageId(data.messageId);
        }
    });

    bridge.startDiscoveryLoop();
})();