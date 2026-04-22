import {
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
} from "../core/state.js";
import { getConversationScrollContainer } from "../core/dom.js";

export const DEFAULT_INTRINSIC_HEIGHT = 100;

export function getCurrentObserverRoot() {
    return getConversationScrollContainer() ?? null;
}

export function getStoredMeasuredHeight(section) {
    const existing = Number(section.dataset.threadOptimizerHeight);
    return existing > 0 ? existing : null;
}

export function setMeasuredHeight(section, height) {
    const rounded = Math.max(1, Math.round(height || DEFAULT_INTRINSIC_HEIGHT));
    section.dataset.threadOptimizerHeight = String(rounded);

    if (section.getAttribute(OFFSCREEN_OPT_ATTR) === "true") {
        section.style.containIntrinsicSize = `auto ${rounded}px`;
    }

    return rounded;
}

export function invalidateMeasuredHeight(section) {
    delete section.dataset.threadOptimizerHeight;
}

export function ensureMeasuredHeight(section) {
    return getStoredMeasuredHeight(section) ?? setMeasuredHeight(
        section,
        section.getBoundingClientRect().height || section.scrollHeight || DEFAULT_INTRINSIC_HEIGHT
    );
}

export function clearOffscreenOptimization(section) {
    section.style.contentVisibility = "";
    section.style.containIntrinsicSize = "";
    section.removeAttribute(OFFSCREEN_OPT_ATTR);
}

export function getStoredCodeBlockHeight(pre) {
    const existing = Number(pre.dataset.threadOptimizerCodeHeight);
    return existing > 0 ? existing : null;
}

export function setCodeBlockHeight(pre, height) {
    const rounded = Math.max(1, Math.round(height || DEFAULT_INTRINSIC_HEIGHT));
    pre.dataset.threadOptimizerCodeHeight = String(rounded);

    if (pre.getAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR) === "true") {
        pre.style.containIntrinsicSize = `auto ${rounded}px`;
    }

    return rounded;
}

export function ensureCodeBlockHeight(pre) {
    return getStoredCodeBlockHeight(pre) ?? setCodeBlockHeight(
        pre,
        pre.getBoundingClientRect().height || pre.scrollHeight || DEFAULT_INTRINSIC_HEIGHT
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