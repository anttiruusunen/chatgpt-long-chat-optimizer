(() => {
    const GLOBAL_KEY = "__threadOptimizerChatStoreBridge";

    const CONFIG = {
        bridgeVersion: 3,

        storeMethodNames: [
            "messageIdToExistingNodeId",
            "getNodeIfExists",
            "deleteNode",
        ],

        discovery: {
            maxExportInspectionDepth: 2,
            maxPollingAttempts: 120,
            pollingIntervalMs: 250,
        },

        logPrefix: "[thread-optimizer bridge]",
    };

    if (window[GLOBAL_KEY]?.__installed) {
        return;
    }

    const patchedPrototypes = new WeakSet();
    const wrappedFactories = new WeakMap();
    const patchedChunkArrays = new WeakSet();

    function isObjectLike(value) {
        return (
            value !== null &&
            (typeof value === "object" || typeof value === "function")
        );
    }

    function safeRead(fn, fallback = null) {
        try {
            return fn();
        } catch {
            return fallback;
        }
    }

    function looksLikeChatStore(value) {
        if (!isObjectLike(value)) {
            return false;
        }

        try {
            return CONFIG.storeMethodNames.every(
                (name) => typeof value[name] === "function"
            );
        } catch {
            return false;
        }
    }

    function getStoreNodeCount(store) {
        return safeRead(() => {
            const nodes = store?.nodes;

            if (Array.isArray(nodes)) {
                return nodes.length;
            }

            if (nodes && typeof nodes === "object") {
                return Object.keys(nodes).length;
            }

            return null;
        });
    }

    function getStoreInfo(store) {
        if (!store) {
            return { found: false };
        }

        return {
            found: true,
            nodeCount: getStoreNodeCount(store),
            currentLeafId: safeRead(() => store.currentLeafId ?? null),
            rootId: safeRead(() => store.rootId ?? null),
        };
    }

    function defineHiddenValue(target, name, value) {
        Object.defineProperty(target, name, {
            value,
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }

    function copyFunctionName(target, source) {
        try {
            Object.defineProperty(target, "name", {
                value: source.name,
                configurable: true,
            });
        } catch {}
    }

    const bridge = {
        __installed: true,
        __version: CONFIG.bridgeVersion,

        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,

        __hookRuns: 0,
        __hookedChunks: 0,
        __wrappedFactories: 0,
        __seenChunkArrays: 0,

        status() {
            const store = this.__store;

            return {
                installed: true,
                version: this.__version,
                hasStore: Boolean(store),
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                hookRuns: this.__hookRuns,
                hookedChunks: this.__hookedChunks,
                wrappedFactories: this.__wrappedFactories,
                seenChunkArrays: this.__seenChunkArrays,
                methods: {
                    deleteNode: Boolean(store?.deleteNode),
                    getNodeIfExists: Boolean(store?.getNodeIfExists),
                    messageIdToExistingNodeId: Boolean(
                        store?.messageIdToExistingNodeId
                    ),
                },
                ...getStoreInfo(store),
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

            console.log(`${CONFIG.logPrefix} store registered`, this.status());

            return true;
        },

        resolveNodeIdFromMessageId(messageId) {
            const store = this.__store;

            if (!store) {
                this.__lastError = "store not registered";
                return null;
            }

            try {
                const nodeId = store.messageIdToExistingNodeId(messageId) ?? null;
                this.__lastError = null;
                return nodeId;
            } catch (error) {
                this.__lastError = String(error?.message || error);

                console.warn(
                    `${CONFIG.logPrefix} messageIdToExistingNodeId failed`,
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

                console.warn(`${CONFIG.logPrefix} getNodeIfExists failed`, error);

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

                console.warn(`${CONFIG.logPrefix} deleteNode failed`, error);

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

        const hasTargetMethods = CONFIG.storeMethodNames.every(
            (name) => typeof proto[name] === "function"
        );

        if (!hasTargetMethods) {
            return false;
        }

        patchedPrototypes.add(proto);

        for (const name of CONFIG.storeMethodNames) {
            const original = proto[name];

            if (
                typeof original !== "function" ||
                original.__threadOptimizerWrapped
            ) {
                continue;
            }

            const wrapped = function threadOptimizerStoreMethodWrapper(...args) {
                maybeRegisterStore(this, `${source}:${name}`);
                return original.apply(this, args);
            };

            defineHiddenValue(wrapped, "__threadOptimizerWrapped", true);
            defineHiddenValue(wrapped, "__threadOptimizerOriginal", original);
            copyFunctionName(wrapped, original);

            proto[name] = wrapped;
        }

        return true;
    }

    function inspectExportValue(
        value,
        source,
        depth = 0,
        seen = new WeakSet()
    ) {
        if (!isObjectLike(value)) {
            return false;
        }

        if (seen.has(value)) {
            return false;
        }

        if (depth > CONFIG.discovery.maxExportInspectionDepth) {
            return false;
        }

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

            if (
                isObjectLike(child) &&
                inspectExportValue(child, `${source}.${key}`, depth + 1, seen)
            ) {
                return true;
            }
        }

        return false;
    }

    function inspectWebpackFactoryResult(args, moduleId, chunkLabel) {
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

            console.warn(`${CONFIG.logPrefix} export inspection failed`, error);
        }
    }

    function wrapFactory(factory, moduleId, chunkLabel) {
        if (typeof factory !== "function") {
            return factory;
        }

        const existing = wrappedFactories.get(factory);
        if (existing) {
            return existing;
        }

        const wrapped = function threadOptimizerWebpackFactoryWrapper(...args) {
            const result = factory.apply(this, args);

            inspectWebpackFactoryResult(args, moduleId, chunkLabel);

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

    function patchExistingChunkRecords(chunkArray, label) {
        for (let i = 0; i < chunkArray.length; i += 1) {
            patchChunkRegistrationRecord(chunkArray[i], label);
        }
    }

    function patchChunkArrayPush(chunkArray, label) {
        const originalPush = chunkArray.push;

        if (typeof originalPush !== "function") {
            return;
        }

        chunkArray.push = function threadOptimizerWebpackChunkPush(...items) {
            bridge.__hookRuns += 1;

            for (let i = 0; i < items.length; i += 1) {
                patchChunkRegistrationRecord(items[i], label);
            }

            return originalPush.apply(this, items);
        };
    }

    function patchChunkArray(chunkArray, label) {
        if (!Array.isArray(chunkArray) || patchedChunkArrays.has(chunkArray)) {
            return;
        }

        patchedChunkArrays.add(chunkArray);
        bridge.__seenChunkArrays += 1;

        patchExistingChunkRecords(chunkArray, label);
        patchChunkArrayPush(chunkArray, label);
    }

    function getWindowPropertyNames() {
        try {
            return Object.getOwnPropertyNames(window);
        } catch {
            return [];
        }
    }

    function patchWebpackChunkGlobals() {
        bridge.__hookRuns += 1;

        const keys = getWindowPropertyNames();

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

    function installPollingDiscovery() {
        let attempts = 0;

        const timer = window.setInterval(() => {
            patchWebpackChunkGlobals();

            attempts += 1;

            if (
                bridge.hasStore() ||
                attempts >= CONFIG.discovery.maxPollingAttempts
            ) {
                window.clearInterval(timer);
            }
        }, CONFIG.discovery.pollingIntervalMs);
    }

    function installLoadDiscovery() {
        window.addEventListener(
            "load",
            () => {
                patchWebpackChunkGlobals();
            },
            { once: true }
        );
    }

    function install() {
        window[GLOBAL_KEY] = bridge;

        patchWebpackChunkGlobals();
        installPollingDiscovery();
        installLoadDiscovery();
    }

    install();
})();