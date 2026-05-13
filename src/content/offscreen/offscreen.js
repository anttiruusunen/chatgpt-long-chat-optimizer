import { state } from "../core/state.js";
import { getConversationSections } from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import {
    registerUiPipelineTask,
    scheduleUiPipelineTask,
} from "../core/uiPipelineScheduler.js";
import {
    applyOffscreenOptimization,
    clearOffscreenOptimization as clearSectionOffscreenOptimization,
} from "./offscreenShared.js";

const OFFSCREEN_ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const OFFSCREEN_REFRESH_TASK = "offscreen-refresh";

function getStyleRoot() {
    return document.documentElement;
}

function setRootOffscreenMode(enabled) {
    const root = getStyleRoot();

    if (!root) {
        return;
    }

    if (enabled) {
        root.setAttribute(OFFSCREEN_ROOT_ATTR, "true");
        return;
    }

    root.removeAttribute(OFFSCREEN_ROOT_ATTR);
}

function syncBrowserNativeOffscreenMode(reason = "unknown") {
    const enabled = Boolean(state.featureFlags.offscreenOptimization);
    const sections = getConversationSections();

    setRootOffscreenMode(enabled);

    for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];

        if (enabled) {
            applyOffscreenOptimization(section);
        } else {
            clearSectionOffscreenOptimization(section);
        }
    }

    debugLog("Offscreen: synced browser-native content visibility", {
        reason,
        enabled,
        sectionCount: sections.length,
    });
}

export function clearOffscreenOptimization(section) {
    return clearSectionOffscreenOptimization(section);
}

export function ensureSectionCssOffscreenMode() {
    syncBrowserNativeOffscreenMode("ensure-section-css-offscreen-mode");
    return null;
}

export function handleReplyStreamingStarted() {
    debugLog("Offscreen: reply streaming started");
}

export function resetOffscreenOptimization() {
    if (state.offscreenRefreshTimer) {
        clearTimeout(state.offscreenRefreshTimer);
        state.offscreenRefreshTimer = null;
    }

    state.isOffscreenRefreshScheduled = false;
    state.offscreenLiveSection = null;

    syncBrowserNativeOffscreenMode("reset");
}

export function refreshObservedSections() {
    syncBrowserNativeOffscreenMode("refresh-observed-sections");
}

export function scheduleOffscreenRefresh(reason = "unknown") {
    if (!state.featureFlags.offscreenOptimization) {
        syncBrowserNativeOffscreenMode(`disabled:${reason}`);
        return;
    }

    if (state.isOffscreenRefreshScheduled) {
        debugLog("Offscreen: skipped duplicate refresh schedule", {
            reason,
        });
        return;
    }

    state.isOffscreenRefreshScheduled = true;
    scheduleUiPipelineTask(OFFSCREEN_REFRESH_TASK, reason);

    debugLog("Offscreen: scheduled refresh in UI pipeline", {
        reason,
    });
}

export function setOffscreenOptimizationEnabled(enabled) {
    state.featureFlags.offscreenOptimization = Boolean(enabled);

    syncBrowserNativeOffscreenMode("feature-toggle");

    if (enabled) {
        scheduleOffscreenRefresh("feature-enabled");
        debugLog("Offscreen: feature enabled");
    } else {
        debugLog("Offscreen: feature disabled");
    }
}

registerUiPipelineTask(OFFSCREEN_REFRESH_TASK, () => {
    try {
        refreshObservedSections();
    } finally {
        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
    }
});