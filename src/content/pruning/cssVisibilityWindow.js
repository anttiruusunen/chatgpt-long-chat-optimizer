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

export function getVisibleSectionsLimit() {
    return VISIBLE_EXCHANGES * SECTIONS_PER_EXCHANGE;
}

function collectMarkedOutOfWindowSections() {
    return Array.from(
        document.querySelectorAll(`section[${OUT_OF_WINDOW_ATTR}="true"]`)
    );
}

function applyClearCssVisibilityWindow(markedSections) {
    for (let i = 0; i < markedSections.length; i += 1) {
        markedSections[i].removeAttribute(OUT_OF_WINDOW_ATTR);
    }
}

export function clearCssVisibilityWindow() {
    const markedSections = collectMarkedOutOfWindowSections();
    applyClearCssVisibilityWindow(markedSections);
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
    const markedSections = collectMarkedOutOfWindowSections();
    const eligibleVisibleSections = getEligibleVisibleSections(sections);
    const visibleWindow = new Set(eligibleVisibleSections.slice(-visibleLimit));
    const sectionsToHide = eligibleVisibleSections.filter(
        (section) => !visibleWindow.has(section)
    );

    return {
        sections,
        markedSections,
        eligibleVisibleSections,
        visibleLimit,
        sectionsToHide,
    };
}

function applyCssVisibilityWindowPlan(plan) {
    applyClearCssVisibilityWindow(plan.markedSections);

    for (let i = 0; i < plan.sectionsToHide.length; i += 1) {
        plan.sectionsToHide[i].setAttribute(OUT_OF_WINDOW_ATTR, "true");
    }
}

export function syncCssVisibilityWindow() {
    const plan = collectCssVisibilityWindowPlan();

    applyClearCssVisibilityWindow(plan.markedSections);

    if (!state.featureFlags.pruning) {
        debugLog("CSS visibility window: skipped sync because pruning is disabled");
        return [];
    }

    if (plan.sections.length === 0) {
        debugLog("CSS visibility window: skipped sync because there are no conversation sections");
        return [];
    }

    applyCssVisibilityWindowPlan({
        ...plan,
        markedSections: [],
    });

    debugLog("CSS visibility window: synced", {
        totalSections: plan.sections.length,
        eligibleVisibleSections: plan.eligibleVisibleSections.length,
        visibleLimit: plan.visibleLimit,
        cssHiddenSections: plan.sectionsToHide.length,
    });

    return plan.sectionsToHide;
}