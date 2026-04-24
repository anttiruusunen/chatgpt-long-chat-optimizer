const PAGE_SCRIPT_PATH = "page/chatStorePageBridge.js";
const PAGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge-script";
const PAGE_SCRIPT_DATA_ATTR = "data-thread-optimizer-chat-store-page-bridge";

function getRuntimeApi() {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        return chrome.runtime;
    }

    if (typeof browser !== "undefined" && browser?.runtime?.getURL) {
        return browser.runtime;
    }

    return null;
}

export function getPageBridgeScriptId() {
    return PAGE_SCRIPT_ID;
}

export function getPageBridgeScriptPath() {
    return PAGE_SCRIPT_PATH;
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

    const script = doc.createElement("script");
    script.id = PAGE_SCRIPT_ID;
    script.src = runtime.getURL(PAGE_SCRIPT_PATH);
    script.async = false;
    script.setAttribute(PAGE_SCRIPT_DATA_ATTR, "true");

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