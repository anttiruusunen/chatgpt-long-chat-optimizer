const PAGE_SCRIPT_PATH = "page/chatStorePageBridge.js";
const PAGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge-script";
const PAGE_BRIDGE_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";

/**
 * Generates a per-page token used to authenticate messages between
 * the content script and the page context.
 *
 * This avoids collisions with other extensions or scripts using postMessage.
 */
function createBridgeToken() {
    const bytes = new Uint8Array(16);

    if (crypto?.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");
}

/**
 * Token is generated once per page load and reused for all bridge messages.
 */
if (!window.THREAD_OPTIMIZER_BRIDGE_TOKEN) {
    window.THREAD_OPTIMIZER_BRIDGE_TOKEN = createBridgeToken();
}

/**
 * Global bridge state lives on window so both content + page script
 * can coordinate installation status.
 */
if (!window.__threadOptimizerChatStoreBridge) {
    Object.defineProperty(window, "__threadOptimizerChatStoreBridge", {
        value: { __installed: false },
        writable: false,
        configurable: false,
    });
}

/**
 * Injects the page-context bridge script.
 *
 * Required because content scripts cannot directly access the page's
 * JS runtime (e.g. ChatGPT's internal stores).
 */
function injectBridge(doc = document) {
    // Prevent duplicate injections across reloads / re-runs
    if (doc.getElementById(PAGE_SCRIPT_ID)) {
        return true;
    }

    const getURL = typeof chrome !== "undefined" && chrome.runtime?.getURL;

    if (!getURL) {
        console.warn(
            "[Long Chat Optimizer] chrome.runtime.getURL not available, skipping injection"
        );
        return false;
    }

    try {
        const script = doc.createElement("script");
        script.id = PAGE_SCRIPT_ID;
        script.src = getURL(PAGE_SCRIPT_PATH);

        // Pass token to page context via attribute (safe cross-context channel)
        script.setAttribute(
            PAGE_BRIDGE_TOKEN_ATTR,
            window.THREAD_OPTIMIZER_BRIDGE_TOKEN
        );

        (doc.head || doc.documentElement).appendChild(script);

        script.onload = () => {
            window.__threadOptimizerChatStoreBridge.__installed = true;
            console.log("[Long Chat Optimizer] Bridge installed successfully");
        };

        return true;
    } catch (error) {
        console.error("[Long Chat Optimizer] bridge bootstrap failed", error);
        return false;
    }
}

/**
 * Ensure injection happens once DOM is ready.
 */
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => injectBridge());
} else {
    injectBridge();
}

/**
 * Helpers used by other modules (e.g. bridge client)
 */
export const getChatStorePageBridgeToken = () =>
    window.THREAD_OPTIMIZER_BRIDGE_TOKEN;

export const getPageBridgeScriptId = () => PAGE_SCRIPT_ID;

export const getPageBridgeScriptPath = () => PAGE_SCRIPT_PATH;

/**
 * Explicit entrypoint for tests or manual bootstrapping.
 */
export function installChatStorePageBridgeBootstrap(doc = document) {
    return injectBridge(doc);
}