import { queryTabs, sendMessageToTab, storageSyncGet, storageSyncSet } from "../shared/ext.js";

const DEFAULT_SETTINGS = {
    historyKeptExchanges: 10,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableLargeCodeBlockOptimization: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableCodeBlockCollapse: true,
    enableUserMessageClamp: true,
};

const historyKeptExchangesInput = document.getElementById("historyKeptExchanges");
const clearHistoryKeptExchangesButton = document.getElementById("clearHistoryKeptExchanges");
const enablePruningInput = document.getElementById("enablePruning");
const enableOffscreenOptimizationInput = document.getElementById("enableOffscreenOptimization");
const enableLargeCodeBlockOptimizationInput = document.getElementById("enableLargeCodeBlockOptimization");
const enableCodeBlockScrollbarsInput = document.getElementById("enableCodeBlockScrollbars");
const enableDebugLoggingInput = document.getElementById("enableDebugLogging");
const hiddenMessagesValueEl = document.getElementById("hiddenMessagesValue");
const lastReplyTimeValueEl = document.getElementById("lastReplyTimeValue");
const debugSectionEl = document.getElementById("debugSection");
const logDebugStateButton = document.getElementById("logDebugState");
const logDebugBucketsButton = document.getElementById("logDebugBuckets");
const logDebugLogicalButton = document.getElementById("logDebugLogical");
const statusEl = document.getElementById("status");
const enableStoreReadOptimizationInput = document.getElementById("enableStoreReadOptimization");
const logDebugStorePerformanceButton = document.getElementById("logDebugStorePerformance");
const enableCodeBlockCollapseInput = document.getElementById("enableCodeBlockCollapse");
const enableUserMessageClampInput = document.getElementById("enableUserMessageClamp");

const REQUIRED_ELEMENTS = {
    historyKeptExchangesInput,
    clearHistoryKeptExchangesButton,
    enablePruningInput,
    enableOffscreenOptimizationInput,
    enableLargeCodeBlockOptimizationInput,
    enableCodeBlockScrollbarsInput,
    enableDebugLoggingInput,
    hiddenMessagesValueEl,
    lastReplyTimeValueEl,
    debugSectionEl,
    statusEl,
    enableStoreReadOptimizationInput,
    enableCodeBlockCollapseInput,
    enableUserMessageClampInput,
};

let popupStatePollTimer = null;
let statusTimer = null;

function assertRequiredElements() {
    const missing = Object.entries(REQUIRED_ELEMENTS)
        .filter(([, element]) => !element)
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(`Popup HTML is missing required elements: ${missing.join(", ")}`);
    }
}

function setStatus(message, { timeoutMs = 2000 } = {}) {
    if (!statusEl) {
        console.warn("[Thread Optimizer popup]", message);
        return;
    }

    statusEl.textContent = message || "";

    if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
    }

    if (message && timeoutMs > 0) {
        statusTimer = setTimeout(() => {
            statusEl.textContent = "";
            statusTimer = null;
        }, timeoutMs);
    }
}

function setPersistentError(message) {
    setStatus(message, { timeoutMs: 0 });
}

function handlePopupError(error, fallbackMessage = "Action failed") {
    console.error("[Thread Optimizer popup]", error);
    setStatus(error?.message || fallbackMessage);
}

function normalizePositiveInt(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const rounded = Math.floor(num);
    return rounded >= 1 ? rounded : null;
}

function formatDuration(ms) {
    if (!ms || ms <= 0) return "Not yet";

    const totalSeconds = ms / 1000;
    if (totalSeconds < 10) return `${totalSeconds.toFixed(2)}s`;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);
    return `${minutes}m ${seconds}s`;
}

function updateFieldStates() {
    const historyDisabled = historyKeptExchangesInput.value === "";

    historyKeptExchangesInput.placeholder = String(DEFAULT_SETTINGS.historyKeptExchanges);

    clearHistoryKeptExchangesButton.title = historyDisabled
        ? "Auto-pruning is disabled"
        : "Disable auto-pruning";
}

function updateDebugVisibility() {
    debugSectionEl.hidden = !enableDebugLoggingInput.checked;
}

function updatePopupStateView(popupState) {
    if (!popupState) {
        hiddenMessagesValueEl.textContent = "—";
        lastReplyTimeValueEl.textContent = "—";
        return;
    }

    hiddenMessagesValueEl.textContent =
        popupState.hiddenSections != null ? String(popupState.hiddenSections) : "0";

    lastReplyTimeValueEl.textContent = popupState.replyPending
        ? "Running…"
        : formatDuration(popupState.lastReplyDurationMs || 0);
}

async function getActiveTabId() {
    const tabs = await queryTabs({ active: true, currentWindow: true });
    return tabs?.[0]?.id ?? null;
}

async function sendToActiveTab(message) {
    const tabId = await getActiveTabId();

    if (!tabId) {
        return { ok: false, error: "No active tab" };
    }

    try {
        const response = await sendMessageToTab(tabId, message);
        return response ?? { ok: false, error: "No response from content script" };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || "Content script unavailable",
        };
    }
}

async function refreshPopupState({ silent = false } = {}) {
    const response = await sendToActiveTab({ action: "get-popup-state" });

    if (!response?.ok) {
        updatePopupStateView(null);

        if (!silent) {
            setStatus(response?.error || "Could not read page state");
        }

        return;
    }

    updatePopupStateView(response);
}

function startPopupStatePolling() {
    if (popupStatePollTimer) return;

    popupStatePollTimer = setInterval(() => {
        refreshPopupState({ silent: true }).catch((error) => {
            console.debug("[Thread Optimizer popup] polling failed", error);
        });
    }, 500);
}

function stopPopupStatePolling() {
    if (!popupStatePollTimer) return;

    clearInterval(popupStatePollTimer);
    popupStatePollTimer = null;
}

async function loadSettings() {
    const stored = await storageSyncGet({
        historyKeptExchanges: DEFAULT_SETTINGS.historyKeptExchanges,
        enablePruning: DEFAULT_SETTINGS.enablePruning,
        enableOffscreenOptimization: DEFAULT_SETTINGS.enableOffscreenOptimization,
        enableLargeCodeBlockOptimization: DEFAULT_SETTINGS.enableLargeCodeBlockOptimization,
        enableDebugLogging: DEFAULT_SETTINGS.enableDebugLogging,
        enableStoreReadOptimization: DEFAULT_SETTINGS.enableStoreReadOptimization,
        enableCodeBlockScrollbars: DEFAULT_SETTINGS.enableCodeBlockScrollbars,
        enableCodeBlockCollapse: DEFAULT_SETTINGS.enableCodeBlockCollapse,
        enableUserMessageClamp: DEFAULT_SETTINGS.enableUserMessageClamp,
    });

    historyKeptExchangesInput.value =
        stored.historyKeptExchanges == null ? "" : String(stored.historyKeptExchanges);

    enablePruningInput.checked = Boolean(stored.enablePruning);
    enableOffscreenOptimizationInput.checked = Boolean(stored.enableOffscreenOptimization);
    enableLargeCodeBlockOptimizationInput.checked = Boolean(stored.enableLargeCodeBlockOptimization);
    enableDebugLoggingInput.checked = Boolean(stored.enableDebugLogging);
    enableStoreReadOptimizationInput.checked = Boolean(stored.enableStoreReadOptimization);
    enableCodeBlockScrollbarsInput.checked = Boolean(stored.enableCodeBlockScrollbars);
    enableCodeBlockCollapseInput.checked = Boolean(stored.enableCodeBlockCollapse);
    enableUserMessageClampInput.checked = Boolean(stored.enableUserMessageClamp);

    updateFieldStates();
    updateDebugVisibility();
}

async function saveSettings() {
    const historyKeptExchanges = historyKeptExchangesInput.value === ""
        ? null
        : normalizePositiveInt(historyKeptExchangesInput.value);

    if (historyKeptExchangesInput.value !== "" && historyKeptExchanges == null) {
        setStatus("Chat history kept must be 1 or more");
        historyKeptExchangesInput.focus();
        return;
    }

    const settingsToStore = {
        historyKeptExchanges,
        autoPrune: historyKeptExchanges != null,
        enablePruning: enablePruningInput.checked,
        enableOffscreenOptimization: enableOffscreenOptimizationInput.checked,
        enableLargeCodeBlockOptimization: enableLargeCodeBlockOptimizationInput.checked,
        enableDebugLogging: enableDebugLoggingInput.checked,
        enableStoreReadOptimization: enableStoreReadOptimizationInput.checked,
        enableCodeBlockScrollbars: enableCodeBlockScrollbarsInput.checked,
        enableCodeBlockCollapse: enableCodeBlockCollapseInput.checked,
        enableUserMessageClamp: enableUserMessageClampInput.checked,
    };

    await storageSyncSet(settingsToStore);

    const response = await sendToActiveTab({
        action: "settings-updated",
        ...settingsToStore,
    });

    if (!response?.ok) {
        console.debug("[Thread Optimizer popup] settings saved, page update skipped", response);
    }

    updateFieldStates();
    updateDebugVisibility();
    await refreshPopupState({ silent: true });
    setStatus("Saved");
}

async function sendDebugAction(action, successMessage) {
    const response = await sendToActiveTab({ action });

    if (response?.ok) {
        setStatus(successMessage);
        return;
    }

    setStatus(response?.error || "Debug action failed");
}

function bindEvent(element, eventName, handler) {
    if (!element) return;

    element.addEventListener(eventName, (event) => {
        Promise.resolve(handler(event)).catch((error) => {
            handlePopupError(error);
        });
    });
}

function bindEvents() {
    bindEvent(historyKeptExchangesInput, "input", updateFieldStates);

    bindEvent(historyKeptExchangesInput, "change", async () => {
        const normalized = normalizePositiveInt(historyKeptExchangesInput.value);

        if (historyKeptExchangesInput.value !== "" && normalized != null) {
            historyKeptExchangesInput.value = String(normalized);
        }

        await saveSettings();
    });

    bindEvent(enablePruningInput, "change", saveSettings);
    bindEvent(enableOffscreenOptimizationInput, "change", saveSettings);

    bindEvent(enableLargeCodeBlockOptimizationInput, "change", async () => {
        updateFieldStates();
        await saveSettings();
    });

    bindEvent(enableDebugLoggingInput, "change", async () => {
        updateDebugVisibility();
        await saveSettings();
    });

    bindEvent(enableStoreReadOptimizationInput, "change", saveSettings);
    bindEvent(enableCodeBlockScrollbarsInput, "change", saveSettings);
    bindEvent(enableCodeBlockCollapseInput, "change", saveSettings);
    bindEvent(enableUserMessageClampInput, "change", saveSettings);

    bindEvent(clearHistoryKeptExchangesButton, "click", async () => {
        historyKeptExchangesInput.value = "";
        updateFieldStates();
        await saveSettings();
    });

    bindEvent(logDebugStateButton, "click", () =>
        sendDebugAction("debug-log-state", "Logged debug state")
    );

    bindEvent(logDebugBucketsButton, "click", () =>
        sendDebugAction("debug-log-buckets", "Logged debug buckets")
    );

    bindEvent(logDebugLogicalButton, "click", () =>
        sendDebugAction("debug-log-logical", "Logged debug logical state")
    );

    bindEvent(logDebugStorePerformanceButton, "click", () =>
        sendDebugAction("log-debug-store-performance", "Logged store cache")
    );

    window.addEventListener("focus", () => {
        refreshPopupState({ silent: true }).catch((error) => {
            console.debug("[Thread Optimizer popup] focus refresh failed", error);
        });
    });

    window.addEventListener("blur", stopPopupStatePolling);
    window.addEventListener("beforeunload", stopPopupStatePolling);
}

async function init() {
    assertRequiredElements();
    bindEvents();

    updatePopupStateView(null);

    await loadSettings();
    await refreshPopupState({ silent: true });
    startPopupStatePolling();
}

init().catch((error) => {
    console.error("[Thread Optimizer popup] failed to initialize", error);

    try {
        updatePopupStateView(null);
        setPersistentError(error?.message || "Failed to initialize popup");
    } catch {
        // Last-resort guard: avoid throwing from the crash handler itself.
    }
});