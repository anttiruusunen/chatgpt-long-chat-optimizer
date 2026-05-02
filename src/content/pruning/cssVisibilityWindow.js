import {
    state,
    PRUNED_ATTR,
    UNPRUNEABLE_ATTR,
    OUT_OF_WINDOW_ATTR,
} from "../core/state.js";
import { getConversationSections } from "../core/dom.js";
import { debugLog } from "../core/logger.js";

export const VISIBLE_EXCHANGES = 1;
export const SECTIONS_PER_EXCHANGE = 2;

let currentlyHiddenSections = new Set();

export function getVisibleSectionsLimit() {
    return VISIBLE_EXCHANGES * SECTIONS_PER_EXCHANGE;
}

function collectMarkedOutOfWindowSections() {
    return Array.from(
        document.querySelectorAll(`section[${OUT_OF_WINDOW_ATTR}="true"]`)
    );
}

function clearOutOfWindowAttr(section) {
    if (section?.hasAttribute?.(OUT_OF_WINDOW_ATTR)) {
        section.removeAttribute(OUT_OF_WINDOW_ATTR);
        return true;
    }

    return false;
}

function setOutOfWindowAttr(section) {
    if (section?.getAttribute?.(OUT_OF_WINDOW_ATTR) !== "true") {
        section.setAttribute(OUT_OF_WINDOW_ATTR, "true");
        return true;
    }

    return false;
}

function clearTrackedCssVisibilityWindow() {
    let clearedCount = 0;

    for (const section of currentlyHiddenSections) {
        if (clearOutOfWindowAttr(section)) {
            clearedCount += 1;
        }
    }

    currentlyHiddenSections.clear();

    return clearedCount;
}

function clearAllMarkedCssVisibilityWindow() {
    const markedSections = collectMarkedOutOfWindowSections();

    for (let i = 0; i < markedSections.length; i += 1) {
        clearOutOfWindowAttr(markedSections[i]);
    }

    currentlyHiddenSections.clear();

    return markedSections.length;
}

export function clearCssVisibilityWindow() {
    clearAllMarkedCssVisibilityWindow();
}

export function getEligibleVisibleSections(sections = getConversationSections()) {
    return sections.filter(
        (section) =>
            !section.hasAttribute(PRUNED_ATTR) &&
            !section.hasAttribute(UNPRUNEABLE_ATTR)
    );
}

export function getCssHiddenSections({
    sections = getConversationSections(),
    visibleLimit = getVisibleSectionsLimit(),
} = {}) {
    const eligibleVisibleSections = getEligibleVisibleSections(sections);
    const visibleWindow = new Set(eligibleVisibleSections.slice(-visibleLimit));

    return eligibleVisibleSections.filter((section) => !visibleWindow.has(section));
}

function collectCssVisibilityWindowPlan({
    sections = getConversationSections(),
    visibleLimit = getVisibleSectionsLimit(),
} = {}) {
    const eligibleVisibleSections = getEligibleVisibleSections(sections);
    const visibleWindow = new Set(eligibleVisibleSections.slice(-visibleLimit));
    const sectionsToHide = eligibleVisibleSections.filter(
        (section) => !visibleWindow.has(section)
    );

    return {
        sections,
        eligibleVisibleSections,
        visibleLimit,
        sectionsToHide,
    };
}

function applyCssVisibilityWindowDiff(sectionsToHide) {
    const nextHiddenSections = new Set(sectionsToHide);

    let clearedCount = 0;
    let markedCount = 0;

    for (const section of currentlyHiddenSections) {
        if (!nextHiddenSections.has(section)) {
            if (clearOutOfWindowAttr(section)) {
                clearedCount += 1;
            }
        }
    }

    for (const section of nextHiddenSections) {
        if (setOutOfWindowAttr(section)) {
            markedCount += 1;
        }
    }

    currentlyHiddenSections = nextHiddenSections;

    return {
        clearedCount,
        markedCount,
    };
}

function reconcileExternallyMarkedSections(sectionsToHide) {
    const nextHiddenSections = new Set(sectionsToHide);
    const markedSections = collectMarkedOutOfWindowSections();

    let clearedCount = 0;

    for (let i = 0; i < markedSections.length; i += 1) {
        const section = markedSections[i];

        if (!nextHiddenSections.has(section)) {
            if (clearOutOfWindowAttr(section)) {
                clearedCount += 1;
            }
        }
    }

    return clearedCount;
}

export function syncCssVisibilityWindow() {
    const plan = collectCssVisibilityWindowPlan();

    if (!state.featureFlags.pruning) {
        const clearedCount = clearAllMarkedCssVisibilityWindow();

        debugLog("CSS visibility window: skipped sync because pruning is disabled", {
            clearedCount,
        });

        return [];
    }

    if (plan.sections.length === 0) {
        const clearedCount = clearAllMarkedCssVisibilityWindow();

        debugLog("CSS visibility window: skipped sync because there are no conversation sections", {
            clearedCount,
        });

        return [];
    }

    const externallyClearedCount = reconcileExternallyMarkedSections(
        plan.sectionsToHide
    );

    const { clearedCount, markedCount } = applyCssVisibilityWindowDiff(
        plan.sectionsToHide
    );

    debugLog("CSS visibility window: synced", {
        totalSections: plan.sections.length,
        eligibleVisibleSections: plan.eligibleVisibleSections.length,
        visibleLimit: plan.visibleLimit,
        cssHiddenSections: plan.sectionsToHide.length,
        clearedCount: clearedCount + externallyClearedCount,
        markedCount,
    });

    return plan.sectionsToHide;
}

export function resetCssVisibilityWindowForTests() {
    currentlyHiddenSections = new Set();
}