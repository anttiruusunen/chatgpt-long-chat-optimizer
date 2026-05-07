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

function clearCurrentLiveSection() {
    const currentLiveSection = getCurrentLiveSection();

    if (currentLiveSection) {
        setSectionLiveOverride(currentLiveSection, false);
    }

    state.offscreenLiveSection = null;
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
    applyOffscreenSectionPlan(collectOffscreenSectionPlan());

    debugLog("Offscreen: section offscreening is CSS-driven");
    return null;
}

export function handleReplyStreamingStarted() {
    applyOffscreenSectionPlan(collectOffscreenSectionPlan());
    scheduleOffscreenRefresh("reply-streaming-started");

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
    applyOffscreenSectionPlan(collectOffscreenSectionPlan());

    debugLog("Offscreen: refreshed CSS-driven section state");
}

export function scheduleOffscreenRefresh(reason = "unknown") {
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

    applyOffscreenSectionPlan(collectOffscreenSectionPlan());

    if (!enabled) {
        clearStaleLiveOverridesExcept(null);

        debugLog("Offscreen: feature disabled");
        return;
    }

    scheduleOffscreenRefresh("feature-enabled");

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