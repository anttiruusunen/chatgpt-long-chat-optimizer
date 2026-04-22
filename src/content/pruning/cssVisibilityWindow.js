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

export function clearCssVisibilityWindow() {
    const marked = document.querySelectorAll(`section[${OUT_OF_WINDOW_ATTR}="true"]`);
    for (const section of marked) {
        section.removeAttribute(OUT_OF_WINDOW_ATTR);
    }
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

export function syncCssVisibilityWindow() {
    clearCssVisibilityWindow();

    if (!state.featureFlags.pruning) {
        debugLog("CSS visibility window: skipped sync because pruning is disabled");
        return [];
    }

    const sections = getConversationSections();
    if (sections.length === 0) {
        debugLog("CSS visibility window: skipped sync because there are no conversation sections");
        return [];
    }

    const visibleLimit = getVisibleSectionsLimit();
    const sectionsToHide = getCssHiddenSections({
        sections,
        visibleLimit,
    });

    for (const section of sectionsToHide) {
        section.setAttribute(OUT_OF_WINDOW_ATTR, "true");
    }

    debugLog("CSS visibility window: synced", {
        totalSections: sections.length,
        eligibleVisibleSections: getEligibleVisibleSections(sections).length,
        visibleLimit,
        cssHiddenSections: sectionsToHide.length,
    });

    return sectionsToHide;
}