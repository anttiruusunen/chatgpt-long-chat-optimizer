const PAGE_SCRIPT_PATH = "page/chatStorePageBridge.js";
const PAGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge-script";
const PAGE_SCRIPT_DATA_ATTR = "data-thread-optimizer-chat-store-page-bridge";
const PAGE_SCRIPT_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";

let pageBridgeToken = null;

function getRuntimeApi() {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        return chrome.runtime;
    }

    if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
        return browser.runtime;
    }

    return null;
}

function createBridgeToken() {
    const bytes = new Uint8Array(16);

    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }

    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function ensurePageBridgeToken() {
    if (!pageBridgeToken) {
        pageBridgeToken = createBridgeToken();
    }

    return pageBridgeToken;
}

export function getPageBridgeScriptId() {
    return PAGE_SCRIPT_ID;
}

export function getPageBridgeScriptPath() {
    return PAGE_SCRIPT_PATH;
}

export function getChatStorePageBridgeToken() {
    return ensurePageBridgeToken();
}

export function installChatStorePageBridgeBootstrap(doc = document) {
    if (!doc || !doc.documentElement) {
        return false;
    }

    if (doc.getElementById(PAGE_SCRIPT_ID)) {
        return true;
    }

    const runtime = getRuntimeApi();
    if (!runtime) {
        console.warn("[thread-optimizer bridge] runtime.getURL unavailable");
        return false;
    }

    const token = ensurePageBridgeToken();

    const script = doc.createElement("script");
    script.id = PAGE_SCRIPT_ID;
    script.src = runtime.getURL(PAGE_SCRIPT_PATH);
    script.async = false;
    script.setAttribute(PAGE_SCRIPT_DATA_ATTR, "true");
    script.setAttribute(PAGE_SCRIPT_TOKEN_ATTR, token);

    script.addEventListener(
        "load",
        () => {
            script.remove();
        },
        { once: true }
    );

    script.addEventListener(
        "error",
        () => {
            console.warn("[thread-optimizer bridge] failed to load page bridge script");
            script.remove();
        },
        { once: true }
    );

    (doc.head || doc.documentElement).appendChild(script);
    return true;
}

installChatStorePageBridgeBootstrap();