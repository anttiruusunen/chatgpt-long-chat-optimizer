// bridgeBootstrap.js

const PAGE_SCRIPT_PATH = "page/chatStorePageBridge.js";
const PAGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge-script";
const PAGE_SCRIPT_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";

// Safe 16-byte hex token generator
function createBridgeToken() {
    const bytes = new Uint8Array(16);
    if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Assign token once per page load
if (!window.THREAD_OPTIMIZER_BRIDGE_TOKEN) {
    window.THREAD_OPTIMIZER_BRIDGE_TOKEN = createBridgeToken();
}

// Ensure global bridge object exists
if (!window.__threadOptimizerChatStoreBridge) {
    Object.defineProperty(window, "__threadOptimizerChatStoreBridge", {
        value: { __installed: false },
        writable: false,
        configurable: false,
    });
}

// Inject page bridge script
function injectBridge(doc = document) {
    if (doc.getElementById(PAGE_SCRIPT_ID)) return true;

    const getURL = typeof chrome !== "undefined" && chrome.runtime?.getURL;
    if (!getURL) {
        console.warn("[Thread Optimizer] chrome.runtime.getURL not available, skipping injection");
        return false;
    }

    try {
        const script = doc.createElement("script");
        script.id = PAGE_SCRIPT_ID;
        script.src = getURL(PAGE_SCRIPT_PATH);
        script.setAttribute(PAGE_SCRIPT_TOKEN_ATTR, window.THREAD_OPTIMIZER_BRIDGE_TOKEN);
        (doc.head || doc.documentElement).appendChild(script);

        script.onload = () => {
            window.__threadOptimizerChatStoreBridge.__installed = true;
            console.log("[Thread Optimizer] Bridge installed successfully");
        };

        return true;
    } catch (err) {
        console.error("[Thread Optimizer] bridge bootstrap failed", err);
        return false;
    }
}

// Inject immediately or on DOMContentLoaded
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => injectBridge());
} else {
    injectBridge();
}

// Optional helpers for other scripts
export const getChatStorePageBridgeToken = () => window.THREAD_OPTIMIZER_BRIDGE_TOKEN;
export const getPageBridgeScriptId = () => PAGE_SCRIPT_ID;
export const getPageBridgeScriptPath = () => PAGE_SCRIPT_PATH;

// bridgeBootstrap.js

export function installChatStorePageBridgeBootstrap(doc = document) {
    return injectBridge(doc);
}