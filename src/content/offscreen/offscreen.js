import { state } from "../core/state.js";
import {
    getConversationSections,
    isConversationSection,
} from "../core/dom.js";
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

function getReasonText(reason = "unknown") {
    if (typeof reason === "string") {
        return reason;
    }

    return reason?.reason || "unknown";
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
        reason: getReasonText(reason),
        enabled,
        sectionCount: sections.length,
        fullSync: true,
    });
}

function syncBrowserNativeOffscreenRootMode(reason = "unknown") {
    const enabled = Boolean(state.featureFlags.offscreenOptimization);

    setRootOffscreenMode(enabled);

    debugLog("Offscreen: synced browser-native root mode", {
        reason: getReasonText(reason),
        enabled,
    });
}

function collectConversationSectionsFromNodes(nodes) {
    const sections = [];

    for (const node of nodes || []) {
        if (!(node instanceof Element)) {
            continue;
        }

        if (isConversationSection(node)) {
            sections.push(node);
        }

        for (const section of node.querySelectorAll("section")) {
            if (isConversationSection(section)) {
                sections.push(section);
            }
        }
    }

    return sections;
}

export function clearOffscreenOptimization(section) {
    return clearSectionOffscreenOptimization(section);
}

export function ensureSectionCssOffscreenMode(reason = "ensure-section-css-offscreen-mode") {
    syncBrowserNativeOffscreenRootMode(reason);
    return null;
}

export function handleReplyStreamingStarted() {
    debugLog("Offscreen: reply streaming started");
}

export function optimizeAddedConversationNodes(
    nodes,
    reason = "added-conversation-nodes"
) {
    if (!state.featureFlags.offscreenOptimization) {
        return 0;
    }

    const sections = collectConversationSectionsFromNodes(nodes);

    setRootOffscreenMode(true);

    for (const section of sections) {
        applyOffscreenOptimization(section);
    }

    if (sections.length > 0) {
        debugLog("Offscreen: optimized added conversation sections", {
            reason: getReasonText(reason),
            sectionCount: sections.length,
        });
    }

    return sections.length;
}

export function optimizeUnoptimizedConversationSections(
    reason = "reconcile-unoptimized-sections"
) {
    if (!state.featureFlags.offscreenOptimization) {
        return 0;
    }

    const sections = document.querySelectorAll(
        [
            `section[data-turn]:not([data-thread-optimizer-offscreen-opt="true"])`,
            `section[data-testid^="conversation-turn-"]:not([data-thread-optimizer-offscreen-opt="true"])`,
        ].join(", ")
    );

    setRootOffscreenMode(true);

    let optimizedCount = 0;

    for (const section of sections) {
        if (!isConversationSection(section)) {
            continue;
        }

        applyOffscreenOptimization(section);
        optimizedCount += 1;
    }

    if (optimizedCount > 0) {
        debugLog("Offscreen: reconciled unoptimized conversation sections", {
            reason: getReasonText(reason),
            sectionCount: optimizedCount,
        });
    }

    return optimizedCount;
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
        syncBrowserNativeOffscreenMode(`disabled:${getReasonText(reason)}`);
        return;
    }

    if (state.isOffscreenRefreshScheduled) {
        debugLog("Offscreen: skipped duplicate refresh schedule", {
            reason: getReasonText(reason),
        });
        return;
    }

    state.isOffscreenRefreshScheduled = true;
    scheduleUiPipelineTask(OFFSCREEN_REFRESH_TASK, reason);

    debugLog("Offscreen: scheduled refresh in UI pipeline", {
        reason: getReasonText(reason),
    });
}

export function setOffscreenOptimizationEnabled(enabled) {
    state.featureFlags.offscreenOptimization = Boolean(enabled);

    syncBrowserNativeOffscreenMode("feature-toggle");

    if (enabled) {
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
