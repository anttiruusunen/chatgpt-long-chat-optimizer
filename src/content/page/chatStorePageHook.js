(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";
    const METHOD_NAMES = [
        "messageIdToExistingNodeId",
        "getNodeIfExists",
        "deleteNode",
    ];

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    const patchedPrototypes = new WeakSet();
    const wrappedFactories = new WeakMap();
    const patchedChunkArrays = new WeakSet();

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

    const bridge = {
        __installed: true,
        __version: 3,
        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,
        __hookRuns: 0,
        __hookedChunks: 0,
        __wrappedFactories: 0,
        __seenChunkArrays: 0,

        status() {
            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(this.__store),
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                hookRuns: this.__hookRuns,
                hookedChunks: this.__hookedChunks,
                wrappedFactories: this.__wrappedFactories,
                seenChunkArrays: this.__seenChunkArrays,
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

            if (this.__store === store) {
                this.__lastError = null;
                this.__meta = meta ?? this.__meta;
                return true;
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
    };

    function maybeRegisterStore(store, source) {
        if (!looksLikeChatStore(store)) {
            return false;
        }

        return bridge.registerStore(store, { source });
    }

    function patchPrototype(proto, source) {
        if (!proto || patchedPrototypes.has(proto)) {
            return false;
        }

        const hasTargetMethods = METHOD_NAMES.every(
            (name) => typeof proto[name] === "function"
        );

        if (!hasTargetMethods) {
            return false;
        }

        patchedPrototypes.add(proto);

        for (const name of METHOD_NAMES) {
            const original = proto[name];
            if (typeof original !== "function") {
                continue;
            }

            if (original.__threadOptimizerWrapped) {
                continue;
            }

            const wrapped = function (...args) {
                maybeRegisterStore(this, `${source}:${name}`);
                return original.apply(this, args);
            };

            Object.defineProperty(wrapped, "__threadOptimizerWrapped", {
                value: true,
                configurable: false,
                enumerable: false,
                writable: false,
            });

            Object.defineProperty(wrapped, "__threadOptimizerOriginal", {
                value: original,
                configurable: false,
                enumerable: false,
                writable: false,
            });

            try {
                Object.defineProperty(wrapped, "name", {
                    value: original.name,
                    configurable: true,
                });
            } catch {}

            proto[name] = wrapped;
        }

        return true;
    }

    function inspectExportValue(value, source, depth = 0, seen = new WeakSet()) {
        if (!isObjectLike(value)) return false;
        if (seen.has(value)) return false;
        if (depth > 2) return false;

        seen.add(value);

        if (looksLikeChatStore(value)) {
            maybeRegisterStore(value, `${source}:instance`);
            return true;
        }

        try {
            const proto = Object.getPrototypeOf(value);
            if (patchPrototype(proto, `${source}:prototype`)) {
                return true;
            }
        } catch {}

        let keys;
        try {
            keys = Object.keys(value);
        } catch {
            return false;
        }

        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            let child;

            try {
                child = value[key];
            } catch {
                continue;
            }

            if (!isObjectLike(child)) {
                continue;
            }

            if (inspectExportValue(child, `${source}.${key}`, depth + 1, seen)) {
                return true;
            }
        }

        return false;
    }

    function wrapFactory(factory, moduleId, chunkLabel) {
        if (typeof factory !== "function") {
            return factory;
        }

        const existing = wrappedFactories.get(factory);
        if (existing) {
            return existing;
        }

        const wrapped = function (...args) {
            const result = factory.apply(this, args);

            try {
                const module = args[0];
                const exportsObject = args[1];

                inspectExportValue(
                    module?.exports,
                    `webpack:${chunkLabel}:${String(moduleId)}:module.exports`
                );
                inspectExportValue(
                    exportsObject,
                    `webpack:${chunkLabel}:${String(moduleId)}:exports`
                );
            } catch (error) {
                bridge.__lastError = String(error?.message || error);
                console.warn("[thread-optimizer bridge] export inspection failed", error);
            }

            return result;
        };

        wrappedFactories.set(factory, wrapped);
        wrappedFactories.set(wrapped, wrapped);
        bridge.__wrappedFactories += 1;

        return wrapped;
    }

    function patchChunkRegistrationRecord(record, chunkLabel) {
        if (!Array.isArray(record)) {
            return;
        }

        const modules = record[1];
        if (!modules || typeof modules !== "object") {
            return;
        }

        const moduleIds = Object.keys(modules);
        let patchedCount = 0;

        for (let i = 0; i < moduleIds.length; i += 1) {
            const moduleId = moduleIds[i];
            const originalFactory = modules[moduleId];
            const wrappedFactory = wrapFactory(originalFactory, moduleId, chunkLabel);

            if (wrappedFactory !== originalFactory) {
                modules[moduleId] = wrappedFactory;
                patchedCount += 1;
            }
        }

        if (patchedCount > 0) {
            bridge.__hookedChunks += patchedCount;
        }
    }

    function patchChunkArray(chunkArray, label) {
        if (!Array.isArray(chunkArray)) {
            return;
        }

        if (patchedChunkArrays.has(chunkArray)) {
            return;
        }

        patchedChunkArrays.add(chunkArray);
        bridge.__seenChunkArrays += 1;

        for (let i = 0; i < chunkArray.length; i += 1) {
            patchChunkRegistrationRecord(chunkArray[i], label);
        }

        const originalPush = chunkArray.push;
        if (typeof originalPush !== "function") {
            return;
        }

        chunkArray.push = function (...items) {
            bridge.__hookRuns += 1;

            for (let i = 0; i < items.length; i += 1) {
                patchChunkRegistrationRecord(items[i], label);
            }

            return originalPush.apply(this, items);
        };
    }

    function patchWebpackChunkGlobals() {
        bridge.__hookRuns += 1;

        let keys;
        try {
            keys = Object.getOwnPropertyNames(window);
        } catch {
            return;
        }

        for (let i = 0; i < keys.length; i += 1) {
            const key = keys[i];
            if (!key.startsWith("webpackChunk")) {
                continue;
            }

            let value;
            try {
                value = window[key];
            } catch {
                continue;
            }

            patchChunkArray(value, key);
        }
    }

    window[GLOBAL_KEY] = bridge;

    patchWebpackChunkGlobals();

    let attempts = 0;
    const maxAttempts = 120;
    const intervalMs = 250;

    const timer = window.setInterval(() => {
        patchWebpackChunkGlobals();

        attempts += 1;
        if (bridge.hasStore() || attempts >= maxAttempts) {
            window.clearInterval(timer);
        }
    }, intervalMs);

    window.addEventListener(
        "load",
        () => {
            patchWebpackChunkGlobals();
        },
        { once: true }
    );
})();