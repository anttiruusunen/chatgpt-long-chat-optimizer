import {
    queryTabs,
    sendMessageToTab,
    storageSyncGet,
    storageSyncSet,
} from "../shared/ext.js";

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

const POLL_INTERVAL_MS = 500;
const STATUS_TIMEOUT_MS = 2000;

const elements = {
    historyKeptExchanges: document.getElementById("historyKeptExchanges"),
    clearHistoryKeptExchanges: document.getElementById("clearHistoryKeptExchanges"),
    enablePruning: document.getElementById("enablePruning"),
    enableOffscreenOptimization: document.getElementById("enableOffscreenOptimization"),
    enableLargeCodeBlockOptimization: document.getElementById("enableLargeCodeBlockOptimization"),
    enableCodeBlockScrollbars: document.getElementById("enableCodeBlockScrollbars"),
    enableDebugLogging: document.getElementById("enableDebugLogging"),
    enableStoreReadOptimization: document.getElementById("enableStoreReadOptimization"),
    enableCodeBlockCollapse: document.getElementById("enableCodeBlockCollapse"),
    enableUserMessageClamp: document.getElementById("enableUserMessageClamp"),
    hiddenMessagesValue: document.getElementById("hiddenMessagesValue"),
    lastReplyTimeValue: document.getElementById("lastReplyTimeValue"),
    debugSection: document.getElementById("debugSection"),
    logDebugState: document.getElementById("logDebugState"),
    logDebugBuckets: document.getElementById("logDebugBuckets"),
    logDebugLogical: document.getElementById("logDebugLogical"),
    logDebugStorePerformance: document.getElementById("logDebugStorePerformance"),
    status: document.getElementById("status"),
};

let popupStatePollTimer = null;
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

function handlePopupError(error, fallbackMessage = "Action failed") {
    console.error("[Thread Optimizer popup]", error);
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

function formatDuration(ms) {
    if (!ms || ms <= 0) {
        return "Not yet";
    }

    const totalSeconds = ms / 1000;

    if (totalSeconds < 10) return `${totalSeconds.toFixed(2)}s`;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds % 60);

    return `${minutes}m ${seconds}s`;
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
    elements.debugSection.hidden = !elements.enableDebugLogging.checked;
}

function updatePopupStateView(popupState) {
    if (!popupState) {
        elements.hiddenMessagesValue.textContent = "—";
        elements.lastReplyTimeValue.textContent = "—";
        return;
    }

    elements.hiddenMessagesValue.textContent =
        popupState.hiddenSections != null
            ? String(popupState.hiddenSections)
            : "0";

    elements.lastReplyTimeValue.textContent = popupState.replyPending
        ? "Running…"
        : formatDuration(popupState.lastReplyDurationMs || 0);
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
    if (popupStatePollTimer) {
        return;
    }

    popupStatePollTimer = setInterval(() => {
        refreshPopupState({ silent: true }).catch((error) => {
            console.debug("[Thread Optimizer popup] polling failed", error);
        });
    }, POLL_INTERVAL_MS);
}

function stopPopupStatePolling() {
    if (!popupStatePollTimer) {
        return;
    }

    clearInterval(popupStatePollTimer);
    popupStatePollTimer = null;
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
    elements.enableLargeCodeBlockOptimization.checked = Boolean(
        stored.enableLargeCodeBlockOptimization
    );
    elements.enableDebugLogging.checked = Boolean(stored.enableDebugLogging);
    elements.enableStoreReadOptimization.checked = Boolean(
        stored.enableStoreReadOptimization
    );
    elements.enableCodeBlockScrollbars.checked = Boolean(
        stored.enableCodeBlockScrollbars
    );
    elements.enableCodeBlockCollapse.checked = Boolean(
        stored.enableCodeBlockCollapse
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
            enableLargeCodeBlockOptimization:
                elements.enableLargeCodeBlockOptimization.checked,
            enableDebugLogging: elements.enableDebugLogging.checked,
            enableStoreReadOptimization:
                elements.enableStoreReadOptimization.checked,
            enableCodeBlockScrollbars: elements.enableCodeBlockScrollbars.checked,
            enableCodeBlockCollapse: elements.enableCodeBlockCollapse.checked,
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
        console.debug(
            "[Thread Optimizer popup] settings saved, page update skipped",
            response
        );
    }

    updateFieldStates();
    updateDebugVisibility();

    await refreshPopupState({ silent: true });

    setStatus("Saved");
}

async function sendDebugAction(action, successMessage) {
    const response = await sendToActiveTab({ action });

    setStatus(response?.ok ? successMessage : response?.error || "Debug action failed");
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
    bindEvent(elements.enableLargeCodeBlockOptimization, "change", saveSettings);
    bindEvent(elements.enableStoreReadOptimization, "change", saveSettings);
    bindEvent(elements.enableCodeBlockScrollbars, "change", saveSettings);
    bindEvent(elements.enableCodeBlockCollapse, "change", saveSettings);
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
        // Avoid throwing from the crash handler itself.
    }
});