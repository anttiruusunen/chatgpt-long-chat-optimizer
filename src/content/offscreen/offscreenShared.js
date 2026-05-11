import {
    state,
    OFFSCREEN_OPT_ATTR,
} from "../core/state.js";
import { getConversationScrollContainer } from "../core/dom.js";

export const DEFAULT_INTRINSIC_HEIGHT = 100;

export function isOffscreenOptimizationEnabled() {
    return state.featureFlags.offscreenOptimization === true;
}

export function getCurrentObserverRoot() {
    if (!isOffscreenOptimizationEnabled()) {
        return null;
    }

    return getConversationScrollContainer() ?? null;
}

function normalizeMeasuredHeight(height) {
    return Math.max(1, Math.round(height || DEFAULT_INTRINSIC_HEIGHT));
}

function measureElementHeight(element) {
    return (
        element.getBoundingClientRect().height ||
        element.scrollHeight ||
        DEFAULT_INTRINSIC_HEIGHT
    );
}

/**
 * Section height is cached so content-visibility can reserve layout space
 * while older still-mounted conversation turns are skipped by the browser.
 */
export function getStoredMeasuredHeight(section) {
    const existing = Number(section?.dataset?.threadOptimizerHeight);

    return existing > 0 ? existing : null;
}

export function setMeasuredHeight(section, height) {
    if (!(section instanceof HTMLElement)) {
        return normalizeMeasuredHeight(height);
    }

    const rounded = normalizeMeasuredHeight(height);

    section.dataset.threadOptimizerHeight = String(rounded);

    if (
        isOffscreenOptimizationEnabled() &&
        section.getAttribute(OFFSCREEN_OPT_ATTR) === "true"
    ) {
        section.style.containIntrinsicSize = `auto ${rounded}px`;
    }

    return rounded;
}

export function ensureMeasuredHeight(section) {
    if (!(section instanceof HTMLElement)) {
        return DEFAULT_INTRINSIC_HEIGHT;
    }

    return (
        getStoredMeasuredHeight(section) ??
        setMeasuredHeight(section, measureElementHeight(section))
    );
}

export function invalidateMeasuredHeight(section) {
    if (!(section instanceof HTMLElement)) {
        return;
    }

    delete section.dataset.threadOptimizerHeight;
}

export function applyOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    if (!isOffscreenOptimizationEnabled()) {
        clearOffscreenOptimization(section);
        return false;
    }

    const height = ensureMeasuredHeight(section);

    section.setAttribute(OFFSCREEN_OPT_ATTR, "true");
    section.style.contentVisibility = "auto";
    section.style.containIntrinsicSize = `auto ${height}px`;

    return true;
}

export function clearOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    const hadOptimization =
        section.getAttribute(OFFSCREEN_OPT_ATTR) === "true" ||
        section.style.contentVisibility ||
        section.style.containIntrinsicSize;

    section.style.contentVisibility = "";
    section.style.containIntrinsicSize = "";
    section.removeAttribute(OFFSCREEN_OPT_ATTR);

    return Boolean(hadOptimization);
}