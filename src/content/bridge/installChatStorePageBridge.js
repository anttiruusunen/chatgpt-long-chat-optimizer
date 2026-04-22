import { ext } from "../../shared/ext.js";
import {
    PAGE_BRIDGE_BUNDLE_PATH,
    PAGE_BRIDGE_GLOBAL,
    PAGE_BRIDGE_SCRIPT_ID,
} from "./chatStoreBridgeProtocol.js";

let installAttempted = false;

function getBridgeScriptUrl() {
    const runtime = ext?.runtime ?? globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
    if (!runtime?.getURL) {
        throw new Error("Extension runtime.getURL() is unavailable");
    }

    return runtime.getURL(PAGE_BRIDGE_BUNDLE_PATH);
}

function hasInstalledBridgeGlobal() {
    try {
        return Boolean(window[PAGE_BRIDGE_GLOBAL]?.__installed);
    } catch {
        return false;
    }
}

export function installChatStorePageBridge() {
    if (hasInstalledBridgeGlobal()) {
        return;
    }

    if (document.getElementById(PAGE_BRIDGE_SCRIPT_ID)) {
        return;
    }

    if (installAttempted) {
        return;
    }

    installAttempted = true;

    const script = document.createElement("script");
    script.id = PAGE_BRIDGE_SCRIPT_ID;
    script.src = getBridgeScriptUrl();
    script.async = false;

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
            installAttempted = false;
            console.warn("[thread-optimizer bridge] failed to load page bridge script");
            script.remove();
        },
        { once: true }
    );

    (document.head || document.documentElement).appendChild(script);
}

export function getChatStorePageBridgeGlobalName() {
    return PAGE_BRIDGE_GLOBAL;
}