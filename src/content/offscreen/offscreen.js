import { state } from "../core/state.js";
import {
    getConversationSections,
    getLatestAssistantSection,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    registerUiPipelineTask,
    scheduleUiPipelineTask,
} from "../core/uiPipelineScheduler.js";

const OFFSCREEN_ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const OFFSCREEN_LIVE_ATTR = "data-thread-optimizer-offscreen-live";
const OFFSCREEN_REFRESH_TASK = "offscreen-refresh";

function getStyleRoot() {
    return document.documentElement;
}

function setSectionLiveOverride(section, isLive) {
    if (!(section instanceof HTMLElement)) {
        return;
    }

    if (isLive) {
        if (section.getAttribute(OFFSCREEN_LIVE_ATTR) !== "true") {
            section.setAttribute(OFFSCREEN_LIVE_ATTR, "true");
        }

        return;
    }

    if (section.hasAttribute(OFFSCREEN_LIVE_ATTR)) {
        section.removeAttribute(OFFSCREEN_LIVE_ATTR);
    }
}

function getCurrentLiveSection() {
    return state.offscreenLiveSection instanceof HTMLElement
        ? state.offscreenLiveSection
        : null;
}

function setCurrentLiveSection(section) {
    state.offscreenLiveSection = section instanceof HTMLElement ? section : null;
}

function collectSectionCssModePlan() {
    return {
        root: getStyleRoot(),
        enabled: Boolean(state.featureFlags.offscreenOptimization),
    };
}

function applySectionCssModePlan({ root, enabled }) {
    if (!root) {
        return;
    }

    if (enabled) {
        if (root.getAttribute(OFFSCREEN_ROOT_ATTR) !== "true") {
            root.setAttribute(OFFSCREEN_ROOT_ATTR, "true");
        }

        return;
    }

    if (root.hasAttribute(OFFSCREEN_ROOT_ATTR)) {
        root.removeAttribute(OFFSCREEN_ROOT_ATTR);
    }
}

function clearStaleLiveOverridesExcept(sectionToKeep) {
    const sections = getConversationSections();

    for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];

        if (section === sectionToKeep) {
            continue;
        }

        setSectionLiveOverride(section, false);
    }
}

function pinLatestAssistantLiveOnly(reason = "unknown") {
    const enabled = Boolean(state.featureFlags.offscreenOptimization);

    applySectionCssModePlan({
        root: getStyleRoot(),
        enabled: enabled && !isReplyStreaming(),
    });

    if (!enabled) {
        clearStaleLiveOverridesExcept(null);
        state.offscreenLiveSection = null;
        return null;
    }

    const latestAssistant = getLatestAssistantSection();

    clearStaleLiveOverridesExcept(latestAssistant);

    if (latestAssistant) {
        setSectionLiveOverride(latestAssistant, true);
        setCurrentLiveSection(latestAssistant);
    } else {
        state.offscreenLiveSection = null;
    }

    debugLog("Offscreen: pinned latest assistant only", {
        reason,
        hasLatestAssistant: Boolean(latestAssistant),
        replyStreaming: isReplyStreaming(),
    });

    return latestAssistant;
}

function collectLiveSectionPlan() {
    const previousLiveSection = getCurrentLiveSection();
    const enabled = Boolean(state.featureFlags.offscreenOptimization);
    const nextLiveSection = enabled ? getLatestAssistantSection() : null;

    const needsBootstrapCleanup =
        !previousLiveSection || !previousLiveSection.isConnected;

    const sectionsToClear =
        enabled && needsBootstrapCleanup
            ? getConversationSections().filter(
                  (section) => section !== nextLiveSection
              )
            : [];

    return {
        enabled,
        previousLiveSection,
        nextLiveSection,
        needsBootstrapCleanup,
        sectionsToClear,
        replyStreaming: isReplyStreaming(),
    };
}

function applyLiveSectionPlan({
    enabled,
    previousLiveSection,
    nextLiveSection,
    needsBootstrapCleanup,
    sectionsToClear,
    replyStreaming,
}) {
    if (!enabled) {
        if (previousLiveSection) {
            setSectionLiveOverride(previousLiveSection, false);
        }

        for (let i = 0; i < sectionsToClear.length; i += 1) {
            setSectionLiveOverride(sectionsToClear[i], false);
        }

        state.offscreenLiveSection = null;
        return;
    }

    for (let i = 0; i < sectionsToClear.length; i += 1) {
        setSectionLiveOverride(sectionsToClear[i], false);
    }

    if (previousLiveSection === nextLiveSection && !needsBootstrapCleanup) {
        if (replyStreaming) {
            debugLog("Offscreen: latest assistant already pinned live during active reply");
        }

        return;
    }

    if (previousLiveSection && previousLiveSection !== nextLiveSection) {
        setSectionLiveOverride(previousLiveSection, false);
    }

    if (nextLiveSection) {
        setSectionLiveOverride(nextLiveSection, true);
        setCurrentLiveSection(nextLiveSection);
    } else {
        state.offscreenLiveSection = null;
    }

    if (replyStreaming) {
        debugLog("Offscreen: updated latest assistant live pin during active reply");
    }
}

function collectOffscreenSectionPlan() {
    return {
        cssModePlan: collectSectionCssModePlan(),
        liveSectionPlan: collectLiveSectionPlan(),
    };
}

function applyOffscreenSectionPlan(plan) {
    applySectionCssModePlan(plan.cssModePlan);
    applyLiveSectionPlan(plan.liveSectionPlan);
}

function applyOffscreenSectionPlanSafely(reason = "unknown") {
    if (isReplyStreaming()) {
        pinLatestAssistantLiveOnly(reason);
        return;
    }

    applyOffscreenSectionPlan(collectOffscreenSectionPlan());
}

function clearCurrentLiveSection() {
    const currentLiveSection = getCurrentLiveSection();

    if (currentLiveSection) {
        setSectionLiveOverride(currentLiveSection, false);
    }

    state.offscreenLiveSection = null;
}

function syncSectionCssMode() {
    applySectionCssModePlan(collectSectionCssModePlan());
}

export function clearOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) {
        return;
    }

    if (getCurrentLiveSection() === section) {
        state.offscreenLiveSection = null;
    }

    setSectionLiveOverride(section, false);
}

export function ensureSectionCssOffscreenMode() {
    applyOffscreenSectionPlanSafely("ensure-section-css-offscreen-mode");

    debugLog("Offscreen: section offscreening is CSS-driven");
    return null;
}

export function handleReplyStreamingStarted() {
    pinLatestAssistantLiveOnly("reply-streaming-started");

    debugLog("Offscreen: reply streaming started");
}

export function resetOffscreenOptimization() {
    clearCurrentLiveSection();
    clearStaleLiveOverridesExcept(null);
    syncSectionCssMode();

    if (state.offscreenRefreshTimer) {
        clearTimeout(state.offscreenRefreshTimer);
        state.offscreenRefreshTimer = null;
    }

    state.isOffscreenRefreshScheduled = false;

    debugLog("Offscreen: reset optimization state", {
        sectionMode: "css-driven",
    });
}

export function refreshObservedSections() {
    applyOffscreenSectionPlanSafely("refresh-observed-sections");

    debugLog("Offscreen: refreshed CSS-driven section state");
}

export function scheduleOffscreenRefresh(reason = "unknown") {
    if (isReplyStreaming()) {
        pinLatestAssistantLiveOnly(`scheduled-during-streaming:${reason}`);
        return;
    }

    if (state.isOffscreenRefreshScheduled) {
        debugLog("Offscreen: skipped duplicate refresh schedule");
        return;
    }

    state.isOffscreenRefreshScheduled = true;
    scheduleUiPipelineTask(OFFSCREEN_REFRESH_TASK, reason);

    debugLog("Offscreen: scheduled refresh in UI pipeline");
}

export function setOffscreenOptimizationEnabled(enabled) {
    state.featureFlags.offscreenOptimization = Boolean(enabled);

    applyOffscreenSectionPlanSafely("feature-toggle");

    if (!enabled) {
        clearStaleLiveOverridesExcept(null);

        debugLog("Offscreen: feature disabled");
        return;
    }

    if (!isReplyStreaming()) {
        scheduleOffscreenRefresh("feature-enabled");
    }

    debugLog("Offscreen: feature enabled");
}

registerUiPipelineTask(OFFSCREEN_REFRESH_TASK, () => {
    try {
        refreshObservedSections();
    } finally {
        state.isOffscreenRefreshScheduled = false;
        state.offscreenRefreshTimer = null;
    }
});