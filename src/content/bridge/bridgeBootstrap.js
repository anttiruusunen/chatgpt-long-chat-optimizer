import { DEFAULT_SETTINGS } from "../../shared/settingsDefaults.js";
import { storageSyncGet } from "../../shared/ext.js";

const PAGE_SCRIPT_PATH = "page/chatStorePageBridge.js";
const PAGE_SCRIPT_ID = "thread-optimizer-chat-store-page-bridge-script";
const PAGE_BRIDGE_TOKEN_ATTR = "data-thread-optimizer-chat-store-page-bridge-token";

const EARLY_INITIAL_LOAD_HIDING_SETTINGS_ATTR =
    "data-thread-optimizer-initial-load-hiding-settings";
const EARLY_INITIAL_LOAD_HIDING_SETTINGS_EVENT =
    "thread-optimizer:initial-load-hiding-settings";
const EARLY_SETTINGS_SYNC_RETRIES = 40;
const EARLY_SETTINGS_SYNC_RETRY_DELAY_MS = 50;



const IS_DEV_BUILD = typeof __DEV__ !== "undefined" && __DEV__ === true;

function devWarn(...args) {
    if (IS_DEV_BUILD) {
        console.warn(...args);
    }
}

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

function normalizePositiveInt(value, fallback) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    const rounded = Math.floor(number);

    return rounded >= 1 ? rounded : fallback;
}

function normalizeInitialLoadHidingSettings(settings = {}) {
    return {
        enabled: Boolean(settings.enablePruning),
        historyKeptExchanges: normalizePositiveInt(
            settings.historyKeptExchanges,
            DEFAULT_SETTINGS.historyKeptExchanges
        ),
        debug: Boolean(settings.enableDebugLogging),
    };
}

async function loadInitialLoadHidingSettings() {
    try {
        const stored = await storageSyncGet(DEFAULT_SETTINGS);

        return normalizeInitialLoadHidingSettings(stored);
    } catch (error) {
        devWarn(
            "[Long Chat Optimizer] failed to load early initial-load hiding settings; sending disabled fallback",
            error
        );

        return {
            enabled: false,
            historyKeptExchanges: DEFAULT_SETTINGS.historyKeptExchanges,
            debug: false,
        };
    }
}

let earlyInitialLoadHidingSettingsSyncStarted = false;

function postInitialLoadHidingSettings(settings) {
    if (
        typeof document === "undefined" ||
        !document.documentElement ||
        typeof document.dispatchEvent !== "function"
    ) {
        return false;
    }

    const root = document.documentElement;

    root.setAttribute(
        EARLY_INITIAL_LOAD_HIDING_SETTINGS_ATTR,
        JSON.stringify({
            enabled: Boolean(settings.enabled),
            historyKeptExchanges: settings.historyKeptExchanges,
            debug: Boolean(settings.debug),
        })
    );

    document.dispatchEvent(
        new Event(EARLY_INITIAL_LOAD_HIDING_SETTINGS_EVENT)
    );

    return true;
}

async function syncInitialLoadHidingSettingsEarly() {
    if (earlyInitialLoadHidingSettingsSyncStarted) {
        return;
    }

    earlyInitialLoadHidingSettingsSyncStarted = true;

    const settings = await loadInitialLoadHidingSettings();

    let attempts = 0;

    function postRepeatedly() {
        const posted = postInitialLoadHidingSettings(settings);

        if (!posted) {
            return;
        }

        attempts += 1;

        if (attempts < EARLY_SETTINGS_SYNC_RETRIES) {
            window.setTimeout(
                postRepeatedly,
                EARLY_SETTINGS_SYNC_RETRY_DELAY_MS
            );
        }
    }

    postRepeatedly();
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
        devWarn(
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
            syncInitialLoadHidingSettingsEarly();
        };

        return true;
    } catch (error) {
        devWarn("[Long Chat Optimizer] bridge bootstrap failed", error);
        return false;
    }
}

/**
 * Inject as early as possible.
 *
 * The page bridge installs a dormant fetch interceptor immediately. The early
 * settings sync below wakes it up only after the real popup settings have been
 * loaded from extension storage.
 */
if (!injectBridge() && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => injectBridge(), {
        once: true,
    });
}

syncInitialLoadHidingSettingsEarly();

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