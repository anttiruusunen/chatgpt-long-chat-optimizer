import { OFFSCREEN_OPT_ATTR } from "../core/state.js";

export const DEFAULT_INTRINSIC_HEIGHT = 160;
export const SECTION_INTRINSIC_SIZE_VAR =
    "--thread-optimizer-section-intrinsic-size";

function normalizeMeasuredHeight(height) {
    return Math.max(1, Math.round(Number(height) || DEFAULT_INTRINSIC_HEIGHT));
}

function measureElementHeight(element) {
    if (!(element instanceof HTMLElement)) {
        return DEFAULT_INTRINSIC_HEIGHT;
    }

    return (
        element.getBoundingClientRect().height ||
        element.offsetHeight ||
        element.scrollHeight ||
        DEFAULT_INTRINSIC_HEIGHT
    );
}

export function getStoredMeasuredHeight(section) {
    const existing = Number(section?.dataset?.threadOptimizerHeight);
    return existing > 0 ? existing : null;
}

export function setMeasuredHeight(section, height) {
    const rounded = normalizeMeasuredHeight(height);

    if (!(section instanceof HTMLElement)) {
        return rounded;
    }

    section.dataset.threadOptimizerHeight = String(rounded);
    section.style.setProperty(SECTION_INTRINSIC_SIZE_VAR, `${rounded}px`);

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
    section.style.removeProperty(SECTION_INTRINSIC_SIZE_VAR);
}

export function applyOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    ensureMeasuredHeight(section);
    section.setAttribute(OFFSCREEN_OPT_ATTR, "true");

    return true;
}

export function clearOffscreenOptimization(section) {
    if (!(section instanceof HTMLElement)) {
        return false;
    }

    const hadOptimization =
        section.getAttribute(OFFSCREEN_OPT_ATTR) === "true" ||
        section.style.getPropertyValue(SECTION_INTRINSIC_SIZE_VAR);

    section.removeAttribute(OFFSCREEN_OPT_ATTR);
    section.style.removeProperty(SECTION_INTRINSIC_SIZE_VAR);

    return Boolean(hadOptimization);
}