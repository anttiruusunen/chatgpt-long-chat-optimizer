import { state } from "../core/state.js";
import {
    getConversationSections,
    getLatestAssistantSection,
} from "../core/dom.js";
import { debugLog } from "../core/logger.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    configureCodeBlockOptimization,
    refreshObservedCodeBlocks,
    resetCodeBlockOptimization,
    reconcileLatestStreamingAssistantCodeBlocksNow,
} from "./offscreenCodeBlocks.js";

const OFFSCREEN_ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const OFFSCREEN_LIVE_ATTR = "data-thread-optimizer-offscreen-live";

function getStyleRoot() {
    return document.documentElement;
}

function setSectionLiveOverride(section, isLive) {
    if (!(section instanceof HTMLElement)) return;

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
        if (section === sectionToKeep) continue;
        setSectionLiveOverride(section, false);
    }
}

function syncSectionCssMode() {
    const root = getStyleRoot();
    if (!root) return;

    if (state.featureFlags.offscreenOptimization) {
        if (root.getAttribute(OFFSCREEN_ROOT_ATTR) !== "true") {
            root.setAttribute(OFFSCREEN_ROOT_ATTR, "true");
        }
    } else if (root.hasAttribute(OFFSCREEN_ROOT_ATTR)) {
        root.removeAttribute(OFFSCREEN_ROOT_ATTR);
    }
}

function syncLiveSectionState() {
    const previousLiveSection = getCurrentLiveSection();

    if (!state.featureFlags.offscreenOptimization) {
        clearCurrentLiveSection();
        return;
    }

    const nextLiveSection = getLatestAssistantSection();

    const needsBootstrapCleanup =
        !previousLiveSection ||
        !previousLiveSection.isConnected;

    if (needsBootstrapCleanup) {
        clearStaleLiveOverridesExcept(nextLiveSection);
    }

    if (previousLiveSection === nextLiveSection && !needsBootstrapCleanup) {
        if (isReplyStreaming()) {
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

    if (isReplyStreaming()) {
        debugLog("Offscreen: updated latest assistant live pin during active reply");
    }
}

export function clearOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) return;

    if (getCurrentLiveSection() === section) {
        state.offscreenLiveSection = null;
    }

    setSectionLiveOverride(section, false);
}

export function ensureSectionCssOffscreenMode() {
    syncSectionCssMode();
    syncLiveSectionState();
    debugLog("Offscreen: section offscreening is CSS-driven");
    return null;
}

export function handleReplyStreamingStarted() {
    syncSectionCssMode();
    syncLiveSectionState();
    reconcileLatestStreamingAssistantCodeBlocksNow();
    scheduleOffscreenRefresh();
    debugLog("Offscreen: reply streaming started");
}

export function resetOffscreenOptimization({ clearMeasurements = false } = {}) {
    clearCurrentLiveSection();
    clearStaleLiveOverridesExcept(null);
    syncSectionCssMode();
    resetCodeBlockOptimization({ clearMeasurements });

    if (state.offscreenRefreshTimer) {
        clearTimeout(state.offscreenRefreshTimer);
        state.offscreenRefreshTimer = null;
    }
    state.isOffscreenRefreshScheduled = false;

    debugLog("Offscreen: reset optimization state", {
        clearMeasurements,
        sectionMode: "css-driven",
    });
}

export function refreshObservedSections() {
    syncSectionCssMode();
    syncLiveSectionState();

    if (!state.featureFlags.offscreenOptimization) {
        resetCodeBlockOptimization();
        return;
    }

    refreshObservedCodeBlocks();

    debugLog("Offscreen: refreshed CSS-driven section state");
}

export function scheduleOffscreenRefresh() {
    if (state.isOffscreenRefreshScheduled) {
        debugLog("Offscreen: skipped duplicate refresh schedule");
        return;
    }

    state.isOffscreenRefreshScheduled = true;

    state.offscreenRefreshTimer = setTimeout(() => {
        try {
            refreshObservedSections();
        } finally {
            state.isOffscreenRefreshScheduled = false;
            state.offscreenRefreshTimer = null;
        }
    }, 0);

    debugLog("Offscreen: scheduled refresh");
}

export function setOffscreenOptimizationEnabled(enabled) {
    if (!enabled) {
        state.featureFlags.offscreenOptimization = false;
        syncSectionCssMode();
        clearCurrentLiveSection();
        clearStaleLiveOverridesExcept(null);
        resetCodeBlockOptimization({ clearMeasurements: true });
        debugLog("Offscreen: feature disabled");
        return;
    }

    state.featureFlags.offscreenOptimization = true;
    syncSectionCssMode();
    scheduleOffscreenRefresh();
    debugLog("Offscreen: feature enabled");
}

configureCodeBlockOptimization({
    scheduleRefresh: scheduleOffscreenRefresh,
});