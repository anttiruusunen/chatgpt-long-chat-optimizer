import {
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
} from "../core/state.js";
import { getConversationScrollContainer } from "../core/dom.js";

export const DEFAULT_INTRINSIC_HEIGHT = 100;

export function getCurrentObserverRoot() {
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
 * while old conversation turns are skipped by the browser.
 */
export function getStoredMeasuredHeight(section) {
    const existing = Number(section.dataset.threadOptimizerHeight);

    return existing > 0 ? existing : null;
}

export function setMeasuredHeight(section, height) {
    const rounded = normalizeMeasuredHeight(height);

    section.dataset.threadOptimizerHeight = String(rounded);

    if (section.getAttribute(OFFSCREEN_OPT_ATTR) === "true") {
        section.style.containIntrinsicSize = `auto ${rounded}px`;
    }

    return rounded;
}

export function ensureMeasuredHeight(section) {
    return (
        getStoredMeasuredHeight(section) ??
        setMeasuredHeight(section, measureElementHeight(section))
    );
}

export function invalidateMeasuredHeight(section) {
    delete section.dataset.threadOptimizerHeight;
}

export function clearOffscreenOptimization(section) {
    section.style.contentVisibility = "";
    section.style.containIntrinsicSize = "";
    section.removeAttribute(OFFSCREEN_OPT_ATTR);
}

/**
 * Code block height is tracked separately from section height because large
 * <pre> nodes can be detached/restored independently.
 */
export function getStoredCodeBlockHeight(pre) {
    const existing = Number(pre.dataset.threadOptimizerCodeHeight);

    return existing > 0 ? existing : null;
}

export function setCodeBlockHeight(pre, height) {
    const rounded = normalizeMeasuredHeight(height);

    pre.dataset.threadOptimizerCodeHeight = String(rounded);

    if (pre.getAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR) === "true") {
        pre.style.containIntrinsicSize = `auto ${rounded}px`;
    }

    return rounded;
}

export function ensureCodeBlockHeight(pre) {
    return (
        getStoredCodeBlockHeight(pre) ??
        setCodeBlockHeight(pre, measureElementHeight(pre))
    );
}

export function invalidateCodeBlockHeight(pre) {
    delete pre.dataset.threadOptimizerCodeHeight;
}

export function clearCodeBlockOffscreenOptimization(pre) {
    pre.style.contentVisibility = "";
    pre.style.containIntrinsicSize = "";
    pre.removeAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR);
}