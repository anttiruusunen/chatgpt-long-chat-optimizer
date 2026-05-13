import {
    queryTabs,
    sendMessageToTab,
    storageSyncGet,
    storageSyncSet,
} from "../shared/ext.js";

const IS_DEV_BUILD = typeof __DEV__ !== "undefined" && __DEV__ === true;

const DEFAULT_SETTINGS = {
    historyKeptExchanges: 10,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableUserMessageClamp: true,
};

const STATUS_TIMEOUT_MS = 2000;

const elements = {
    historyKeptExchanges: document.getElementById("historyKeptExchanges"),
    clearHistoryKeptExchanges: document.getElementById("clearHistoryKeptExchanges"),
    enablePruning: document.getElementById("enablePruning"),
    enableOffscreenOptimization: document.getElementById("enableOffscreenOptimization"),
    enableCodeBlockScrollbars: document.getElementById("enableCodeBlockScrollbars"),
    enableDebugLogging: document.getElementById("enableDebugLogging"),
    enableStoreReadOptimization: document.getElementById("enableStoreReadOptimization"),
    enableUserMessageClamp: document.getElementById("enableUserMessageClamp"),
    debugSection: document.getElementById("debugSection"),
    debugButtons: document.getElementById("debugButtons"),
    logDebugState: document.getElementById("logDebugState"),
    logDebugBuckets: document.getElementById("logDebugBuckets"),
    logDebugLogical: document.getElementById("logDebugLogical"),
    logDebugStorePerformance: document.getElementById("logDebugStorePerformance"),
    status: document.getElementById("status"),
};

let statusTimer = null;

function assertRequiredElements() {
    const missing = Object.entries(elements)
        .filter(([, element]) => !element)
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(
            `Popup HTML is missing required elements: ${missing.join(", ")}`
        );
    }
}

function setStatus(message, { timeoutMs = STATUS_TIMEOUT_MS } = {}) {
    elements.status.textContent = message || "";

    if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
    }

    if (message && timeoutMs > 0) {
        statusTimer = setTimeout(() => {
            elements.status.textContent = "";
            statusTimer = null;
        }, timeoutMs);
    }
}

function setPersistentError(message) {
    setStatus(message, { timeoutMs: 0 });
}

function logPopupError(message, error, details) {
    if (!IS_DEV_BUILD && !elements.enableDebugLogging?.checked) {
        return;
    }

    if (details === undefined) {
        console.warn(`[Thread Optimizer popup] ${message}`, error);
        return;
    }

    console.warn(`[Thread Optimizer popup] ${message}`, error, details);
}

function handlePopupError(error, fallbackMessage = "Action failed") {
    logPopupError("action failed", error);
    setStatus(error?.message || fallbackMessage);
}

function normalizePositiveInt(value) {
    const num = Number(value);

    if (!Number.isFinite(num)) {
        return null;
    }

    const rounded = Math.floor(num);

    return rounded >= 1 ? rounded : null;
}

function updateFieldStates() {
    const historyDisabled = elements.historyKeptExchanges.value === "";

    elements.historyKeptExchanges.placeholder = String(
        DEFAULT_SETTINGS.historyKeptExchanges
    );

    elements.clearHistoryKeptExchanges.title = historyDisabled
        ? "Auto-pruning is disabled"
        : "Disable auto-pruning";
}

function updateDebugVisibility() {
    const debugEnabled = elements.enableDebugLogging.checked;

    elements.debugSection.hidden = !debugEnabled;
    elements.debugButtons.hidden = !(IS_DEV_BUILD && debugEnabled);
}

async function getActiveTabId() {
    const tabs = await queryTabs({
        active: true,
        currentWindow: true,
    });

    return tabs?.[0]?.id ?? null;
}

async function sendToActiveTab(message) {
    const tabId = await getActiveTabId();

    if (!tabId) {
        return { ok: false, error: "No active tab" };
    }

    try {
        const response = await sendMessageToTab(tabId, message);

        return response ?? {
            ok: false,
            error: "No response from content script",
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || "Content script unavailable",
        };
    }
}

async function loadSettings() {
    const stored = await storageSyncGet(DEFAULT_SETTINGS);

    elements.historyKeptExchanges.value =
        stored.historyKeptExchanges == null
            ? ""
            : String(stored.historyKeptExchanges);

    elements.enablePruning.checked = Boolean(stored.enablePruning);
    elements.enableOffscreenOptimization.checked = Boolean(
        stored.enableOffscreenOptimization
    );
    elements.enableDebugLogging.checked = Boolean(stored.enableDebugLogging);
    elements.enableStoreReadOptimization.checked = Boolean(
        stored.enableStoreReadOptimization
    );
    elements.enableCodeBlockScrollbars.checked = Boolean(
        stored.enableCodeBlockScrollbars
    );
    elements.enableUserMessageClamp.checked = Boolean(
        stored.enableUserMessageClamp
    );

    updateFieldStates();
    updateDebugVisibility();
}

function collectSettingsFromForm() {
    const historyValue = elements.historyKeptExchanges.value;
    const historyKeptExchanges =
        historyValue === "" ? null : normalizePositiveInt(historyValue);

    if (historyValue !== "" && historyKeptExchanges == null) {
        return {
            ok: false,
            error: "Chat history kept must be 1 or more",
        };
    }

    return {
        ok: true,
        settings: {
            historyKeptExchanges,
            autoPrune: historyKeptExchanges != null,
            enablePruning: elements.enablePruning.checked,
            enableOffscreenOptimization: elements.enableOffscreenOptimization.checked,
            enableDebugLogging: elements.enableDebugLogging.checked,
            enableStoreReadOptimization:
                elements.enableStoreReadOptimization.checked,
            enableCodeBlockScrollbars: elements.enableCodeBlockScrollbars.checked,
            enableUserMessageClamp: elements.enableUserMessageClamp.checked,
        },
    };
}

/**
 * Saves settings to extension storage, then best-effort notifies the current tab.
 *
 * Storage remains the source of truth; the runtime message makes the active page
 * react immediately without requiring a reload.
 */
async function saveSettings() {
    const formState = collectSettingsFromForm();

    if (!formState.ok) {
        setStatus(formState.error);
        elements.historyKeptExchanges.focus();
        return;
    }

    await storageSyncSet(formState.settings);

    const response = await sendToActiveTab({
        action: "settings-updated",
        ...formState.settings,
    });

    if (!response?.ok) {
        logPopupError("settings saved, page update skipped", response);
    }

    updateFieldStates();
    updateDebugVisibility();

    setStatus("Saved");
}

async function sendDebugAction(action, successMessage) {
    if (!IS_DEV_BUILD) {
        setStatus("Debug actions are unavailable in production builds");
        return;
    }

    const response = await sendToActiveTab({ action });

    setStatus(
        response?.ok
            ? successMessage
            : response?.error || "Debug action failed"
    );
}

function bindEvent(element, eventName, handler) {
    element.addEventListener(eventName, (event) => {
        Promise.resolve(handler(event)).catch((error) => {
            handlePopupError(error);
        });
    });
}

function bindEvents() {
    bindEvent(elements.historyKeptExchanges, "input", updateFieldStates);

    bindEvent(elements.historyKeptExchanges, "change", async () => {
        const normalized = normalizePositiveInt(
            elements.historyKeptExchanges.value
        );

        if (elements.historyKeptExchanges.value !== "" && normalized != null) {
            elements.historyKeptExchanges.value = String(normalized);
        }

        await saveSettings();
    });

    bindEvent(elements.clearHistoryKeptExchanges, "click", async () => {
        elements.historyKeptExchanges.value = "";
        updateFieldStates();
        await saveSettings();
    });

    bindEvent(elements.enablePruning, "change", saveSettings);
    bindEvent(elements.enableOffscreenOptimization, "change", saveSettings);
    bindEvent(elements.enableStoreReadOptimization, "change", saveSettings);
    bindEvent(elements.enableCodeBlockScrollbars, "change", saveSettings);
    bindEvent(elements.enableUserMessageClamp, "change", saveSettings);

    bindEvent(elements.enableDebugLogging, "change", async () => {
        updateDebugVisibility();
        await saveSettings();
    });

    bindEvent(elements.logDebugState, "click", () =>
        sendDebugAction("debug-log-state", "Logged debug state")
    );

    bindEvent(elements.logDebugBuckets, "click", () =>
        sendDebugAction("debug-log-buckets", "Logged debug buckets")
    );

    bindEvent(elements.logDebugLogical, "click", () =>
        sendDebugAction("debug-log-logical", "Logged debug logical state")
    );

    bindEvent(elements.logDebugStorePerformance, "click", () =>
        sendDebugAction("log-debug-store-performance", "Logged store cache")
    );
}

async function init() {
    assertRequiredElements();
    bindEvents();

    await loadSettings();
}

init().catch((error) => {
    logPopupError("failed to initialize", error);

    try {
        setPersistentError(error?.message || "Failed to initialize popup");
    } catch {
        // Avoid throwing from the crash handler itself.
    }
});