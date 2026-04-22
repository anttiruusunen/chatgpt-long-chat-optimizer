import {
    PAGE_BRIDGE_GLOBAL,
    PAGE_BRIDGE_READY_EVENT,
} from "./chatStoreBridgeProtocol.js";

(function installPageBridge() {
    if (window[PAGE_BRIDGE_GLOBAL]?.__installed) {
        return;
    }

    function isObjectLike(value) {
        return value !== null && (typeof value === "object" || typeof value === "function");
    }

    function looksLikeChatStore(value) {
        if (!isObjectLike(value)) return false;

        let proto;
        try {
            proto = Object.getPrototypeOf(value);
        } catch {
            return false;
        }

        return Boolean(
            proto &&
                typeof proto.deleteNode === "function" &&
                typeof proto.getNodeIfExists === "function" &&
                typeof proto.messageIdToExistingNodeId === "function"
        );
    }

    const bridge = {
        __installed: true,
        __store: null,
        __registeredAt: null,
        __lastError: null,
        __meta: null,

        status() {
            return {
                installed: true,
                hasStore: Boolean(this.__store),
                registeredAt: this.__registeredAt,
                lastError: this.__lastError,
                meta: this.__meta,
                methods: this.__store
                    ? {
                          deleteNode: typeof this.__store.deleteNode === "function",
                          getNodeIfExists:
                              typeof this.__store.getNodeIfExists === "function",
                          messageIdToExistingNodeId:
                              typeof this.__store.messageIdToExistingNodeId === "function",
                      }
                    : null,
            };
        },

        registerStore(store, meta = null) {
            if (!looksLikeChatStore(store)) {
                this.__lastError = "registerStore received a value that does not look like the chat store";
                return false;
            }

            this.__store = store;
            this.__registeredAt = Date.now();
            this.__lastError = null;
            this.__meta = meta;

            console.log("[thread-optimizer bridge] store registered", this.status());
            return true;
        },

        clearStore() {
            this.__store = null;
            this.__registeredAt = null;
            this.__meta = null;
            this.__lastError = null;
        },

        hasStore() {
            return Boolean(this.__store);
        },

        getStore() {
            return this.__store;
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

    Object.defineProperty(window, PAGE_BRIDGE_GLOBAL, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: bridge,
    });

    window.dispatchEvent(
        new CustomEvent(PAGE_BRIDGE_READY_EVENT, {
            detail: {
                globalName: PAGE_BRIDGE_GLOBAL,
            },
        })
    );

    console.log("[thread-optimizer bridge] page bridge installed");
})();