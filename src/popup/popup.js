import {
    queryTabs,
    sendMessageToTab,
    storageSyncGet,
    storageSyncSet,
} from "../shared/ext.js";
import { DEFAULT_SETTINGS } from "../shared/settingsDefaults.js";

const IS_DEV_BUILD = typeof __DEV__ !== "undefined" && __DEV__ === true;

const STATUS_TIMEOUT_MS = 2000;
const SAVE_SETTINGS_DEBOUNCE_MS = 400;

const elements = {
    historyKeptExchanges: document.getElementById("historyKeptExchanges"),
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
let pendingSaveTimer = null;
let pendingSavePromise = null;

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
        console.warn(`[Long Chat Optimizer popup] ${message}`, error);
        return;
    }

    console.warn(`[Long Chat Optimizer popup] ${message}`, error, details);
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

function getNormalizedHistoryKeptExchanges() {
    return (
        normalizePositiveInt(elements.historyKeptExchanges.value) ??
        DEFAULT_SETTINGS.historyKeptExchanges
    );
}

function normalizeHistoryKeptExchangesField() {
    const normalized = getNormalizedHistoryKeptExchanges();

    elements.historyKeptExchanges.value = String(normalized);

    return normalized;
}

function updateFieldStates() {
    elements.historyKeptExchanges.placeholder = String(
        DEFAULT_SETTINGS.historyKeptExchanges
    );
}

function updateDebugVisibility() {
    const debugEnabled = elements.enableDebugLogging.checked;

    elements.debugSection.hidden = !debugEnabled;
    elements.debugButtons.hidden = !(IS_DEV_BUILD && debugEnabled);
}

function toggleInfoPanel(button) {
    const targetId = button?.dataset?.infoTarget;
    if (!targetId) {
        return;
    }

    const panel = document.getElementById(targetId);
    if (!panel) {
        return;
    }

    const nextExpanded = panel.hidden;
    panel.hidden = !nextExpanded;
    button.setAttribute("aria-expanded", String(nextExpanded));
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
            unexpected: true,
            error: error?.message || "Content script unavailable",
        };
    }
}

async function loadSettings() {
    const stored = await storageSyncGet(DEFAULT_SETTINGS);
    const historyKeptExchanges =
        normalizePositiveInt(stored.historyKeptExchanges) ??
        DEFAULT_SETTINGS.historyKeptExchanges;

    elements.historyKeptExchanges.value = String(historyKeptExchanges);

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
    const historyKeptExchanges = getNormalizedHistoryKeptExchanges();

    return {
        ok: true,
        settings: {
            historyKeptExchanges,
            autoPrune: true,
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

async function saveSettings() {
    normalizeHistoryKeptExchangesField();

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

    if (!response?.ok && response?.unexpected === true && IS_DEV_BUILD) {
        logPopupError(
            "settings saved, page update skipped",
            new Error(response?.error || "No active content script response"),
            response
        );
    }

    updateFieldStates();
    updateDebugVisibility();

    setStatus("Saved");
}

function clearPendingSettingsSave() {
    if (pendingSaveTimer) {
        clearTimeout(pendingSaveTimer);
        pendingSaveTimer = null;
    }
}

function runSaveSettingsSafely() {
    pendingSavePromise = Promise.resolve(saveSettings())
        .catch((error) => {
            handlePopupError(error);
        })
        .finally(() => {
            pendingSavePromise = null;
        });

    return pendingSavePromise;
}

function scheduleSettingsSave() {
    clearPendingSettingsSave();

    pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        runSaveSettingsSafely();
    }, SAVE_SETTINGS_DEBOUNCE_MS);
}

function flushPendingSettingsSave() {
    if (!pendingSaveTimer) {
        return pendingSavePromise;
    }

    clearPendingSettingsSave();

    return runSaveSettingsSafely();
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

function bindInfoButtons() {
    document.querySelectorAll("[data-info-target]").forEach((button) => {
        bindEvent(button, "click", () => {
            toggleInfoPanel(button);
        });
    });
}

function bindCloseFlushEvents() {
    window.addEventListener("blur", () => {
        flushPendingSettingsSave();
    });

    window.addEventListener("pagehide", () => {
        flushPendingSettingsSave();
    });

    window.addEventListener("beforeunload", () => {
        flushPendingSettingsSave();
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushPendingSettingsSave();
        }
    });
}

function bindEvents() {
    bindEvent(elements.historyKeptExchanges, "input", () => {
        updateFieldStates();
        scheduleSettingsSave();
    });

    bindEvent(elements.historyKeptExchanges, "change", () => {
        normalizeHistoryKeptExchangesField();
        scheduleSettingsSave();
    });

    bindEvent(elements.historyKeptExchanges, "blur", () => {
        flushPendingSettingsSave();
    });

    bindEvent(elements.enablePruning, "change", scheduleSettingsSave);
    bindEvent(elements.enableOffscreenOptimization, "change", scheduleSettingsSave);
    bindEvent(elements.enableStoreReadOptimization, "change", scheduleSettingsSave);
    bindEvent(elements.enableCodeBlockScrollbars, "change", scheduleSettingsSave);
    bindEvent(elements.enableUserMessageClamp, "change", scheduleSettingsSave);

    bindEvent(elements.enableDebugLogging, "change", () => {
        updateDebugVisibility();
        scheduleSettingsSave();
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

    bindInfoButtons();
    bindCloseFlushEvents();
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