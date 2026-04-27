import { queryTabs, sendMessageToTab, storageSyncGet, storageSyncSet } from "../shared/ext.js";

const DEFAULT_SETTINGS = {
    historyKeptExchanges: 10,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableLargeCodeBlockOptimization: true,
    enableStreamingSectionHiding: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
};

const historyKeptExchangesInput = document.getElementById("historyKeptExchanges");
const clearHistoryKeptExchangesButton = document.getElementById("clearHistoryKeptExchanges");
const enablePruningInput = document.getElementById("enablePruning");
const enableOffscreenOptimizationInput = document.getElementById("enableOffscreenOptimization");
const enableLargeCodeBlockOptimizationInput = document.getElementById("enableLargeCodeBlockOptimization");
const enableStreamingSectionHidingInput = document.getElementById("enableStreamingSectionHiding");
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

let popupStatePollTimer = null;

function setStatus(message) {
    statusEl.textContent = message;
    clearTimeout(setStatus._timer);
    setStatus._timer = setTimeout(() => {
        statusEl.textContent = "";
    }, 2000);
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
    if (totalSeconds < 10) {
        return `${totalSeconds.toFixed(2)}s`;
    }
    if (totalSeconds < 60) {
        return `${totalSeconds.toFixed(1)}s`;
    }

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

    if (popupState.replyPending) {
        lastReplyTimeValueEl.textContent = "Running…";
        return;
    }

    lastReplyTimeValueEl.textContent = formatDuration(popupState.lastReplyDurationMs || 0);
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
        refreshPopupState({ silent: true }).catch(() => {});
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
        enableStreamingSectionHiding: DEFAULT_SETTINGS.enableStreamingSectionHiding,
        enableDebugLogging: DEFAULT_SETTINGS.enableDebugLogging,
        enableStoreReadOptimization: DEFAULT_SETTINGS.enableStoreReadOptimization,
    });

    historyKeptExchangesInput.value =
        stored.historyKeptExchanges == null ? "" : String(stored.historyKeptExchanges);

    enablePruningInput.checked = Boolean(stored.enablePruning);
    enableOffscreenOptimizationInput.checked = Boolean(stored.enableOffscreenOptimization);
    enableLargeCodeBlockOptimizationInput.checked = Boolean(stored.enableLargeCodeBlockOptimization);
    enableStreamingSectionHidingInput.checked = Boolean(stored.enableStreamingSectionHiding);
    enableDebugLoggingInput.checked = Boolean(stored.enableDebugLogging);
    enableStoreReadOptimizationInput.checked = Boolean(stored.enableStoreReadOptimization);

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

    const enablePruning = enablePruningInput.checked;
    const enableOffscreenOptimization = enableOffscreenOptimizationInput.checked;
    const enableLargeCodeBlockOptimization = enableLargeCodeBlockOptimizationInput.checked;
    const enableStreamingSectionHiding = enableStreamingSectionHidingInput.checked;
    const enableDebugLogging = enableDebugLoggingInput.checked;

    const settingsToStore = {
        historyKeptExchanges,
        autoPrune: historyKeptExchanges != null,
        enablePruning,
        enableOffscreenOptimization,
        enableLargeCodeBlockOptimization,
        enableStreamingSectionHiding,
        enableDebugLogging,
        enableStoreReadOptimization: enableStoreReadOptimizationInput.checked,
    };

    await storageSyncSet(settingsToStore);

    await sendToActiveTab({
        action: "settings-updated",
        historyKeptExchanges,
        autoPrune: historyKeptExchanges != null,
        enablePruning,
        enableOffscreenOptimization,
        enableLargeCodeBlockOptimization,
        enableStreamingSectionHiding,
        enableDebugLogging,
        enableStoreReadOptimization: enableStoreReadOptimizationInput.checked,
    });

    updateFieldStates();
    updateDebugVisibility();
    await refreshPopupState();
    setStatus("Saved");
}

async function sendDebugAction(action, successMessage) {
    const response = await sendToActiveTab({ action });
    if (!response) {
        setStatus("Content script not available");
        return;
    }

    if (response.ok) {
        setStatus(successMessage);
    } else {
        setStatus(response.error || "Debug action failed");
    }
}

historyKeptExchangesInput.addEventListener("input", updateFieldStates);

historyKeptExchangesInput.addEventListener("change", async () => {
    const normalized = normalizePositiveInt(historyKeptExchangesInput.value);
    if (historyKeptExchangesInput.value !== "" && normalized != null) {
        historyKeptExchangesInput.value = String(normalized);
    }
    await saveSettings();
});

enablePruningInput.addEventListener("change", saveSettings);
enableOffscreenOptimizationInput.addEventListener("change", saveSettings);
enableLargeCodeBlockOptimizationInput.addEventListener("change", async () => {
    updateFieldStates();
    await saveSettings();
});
enableStreamingSectionHidingInput.addEventListener("change", saveSettings);
enableDebugLoggingInput.addEventListener("change", async () => {
    updateDebugVisibility();
    await saveSettings();
});

enableStoreReadOptimizationInput.addEventListener("change", saveSettings);
logDebugStorePerformanceButton.addEventListener("click", async () => {
    await sendDebugAction(
        "log-debug-store-performance",
        "Logged store cache"
    );
});

clearHistoryKeptExchangesButton.addEventListener("click", async () => {
    historyKeptExchangesInput.value = "";
    updateFieldStates();
    await saveSettings();
});

logDebugStateButton.addEventListener("click", async () => {
    await sendDebugAction("log-debug-state", "Logged debug state");
});

logDebugBucketsButton.addEventListener("click", async () => {
    await sendDebugAction("log-debug-buckets", "Logged debug buckets");
});

logDebugLogicalButton.addEventListener("click", async () => {
    await sendDebugAction("log-debug-logical", "Logged debug logical state");
});

window.addEventListener("focus", () => {
    refreshPopupState({ silent: true }).catch(() => {});
});

window.addEventListener("blur", stopPopupStatePolling);
window.addEventListener("beforeunload", stopPopupStatePolling);

async function init() {
    await loadSettings();
    await refreshPopupState({ silent: true });
    startPopupStatePolling();
}

init().catch((error) => {
    setStatus(error?.message || "Failed to initialize popup");
});