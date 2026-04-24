const PAGE_BRIDGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge";
const PAGE_BRIDGE_SCRIPT_PATH = "page/chatStorePageBridge.js";

export function getPageBridgeScriptId() {
    return PAGE_BRIDGE_SCRIPT_ID;
}

export function getPageBridgeScriptPath() {
    return PAGE_BRIDGE_SCRIPT_PATH;
}

function getRuntimeUrl(path) {
    const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;

    if (!runtime || typeof runtime.getURL !== "function") {
        return null;
    }

    return runtime.getURL(path);
}

export function installChatStorePageBridgeBootstrap(doc = document) {
    if (!doc?.documentElement) {
        return false;
    }

    if (doc.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
        return true;
    }

    const src = getRuntimeUrl(PAGE_BRIDGE_SCRIPT_PATH);
    if (!src) {
        return false;
    }

    const script = doc.createElement("script");
    script.id = PAGE_BRIDGE_SCRIPT_ID;
    script.src = src;
    script.async = false;

    script.addEventListener(
        "error",
        () => {
            console.warn("[thread-optimizer bridge] failed to load page bridge script");
        },
        { once: true }
    );

    (doc.head || doc.documentElement).appendChild(script);
    return true;
}

installChatStorePageBridgeBootstrap();