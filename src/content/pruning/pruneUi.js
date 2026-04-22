import { state, PLACEHOLDER_ATTR } from "../core/state.js";
import {
    getConversationContainer,
    getConversationSectionMountNode,
} from "../core/dom.js";

const STARTUP_MASK_ATTR = "data-thread-optimizer-startup-mask";
const STARTUP_MASK_STYLE_ID = "thread-optimizer-startup-mask-style";
const PLACEHOLDER_HIDDEN_ATTR = "data-thread-optimizer-placeholder-hidden";

export function getHiddenLabel(hiddenCount) {
    const messages = Math.max(0, Number(hiddenCount) || 0);
    return `${messages} older message${messages === 1 ? "" : "s"} hidden`;
}

function createSimpleBanner(attrName, text) {
    const section = document.createElement("section");
    section.setAttribute(attrName, "true");
    section.style.padding = "12px 16px";
    section.style.margin = "8px 0";
    section.style.borderRadius = "12px";
    section.style.opacity = "0.85";
    section.style.fontStyle = "italic";
    section.style.background = "rgba(127, 127, 127, 0.12)";

    const label = document.createElement("div");
    label.textContent = text;
    section.appendChild(label);

    return { root: section, label };
}

function createPlaceholder() {
    const { root } = createSimpleBanner(
        PLACEHOLDER_ATTR,
        getHiddenLabel(state.hiddenCount)
    );
    return root;
}

function getPlaceholderLabelNode(placeholder) {
    return placeholder?.firstElementChild ?? null;
}

function isPlaceholderVisible(placeholder) {
    return Boolean(
        placeholder &&
            placeholder.isConnected &&
            !placeholder.hidden &&
            placeholder.getAttribute(PLACEHOLDER_HIDDEN_ATTR) !== "true"
    );
}

function setPlaceholderVisible(placeholder, visible) {
    if (!(placeholder instanceof HTMLElement)) {
        return false;
    }

    const nextVisible = Boolean(visible);
    const wasVisible = isPlaceholderVisible(placeholder);

    if (nextVisible === wasVisible) {
        return false;
    }

    placeholder.hidden = !nextVisible;

    if (nextVisible) {
        placeholder.removeAttribute(PLACEHOLDER_HIDDEN_ATTR);
    } else {
        placeholder.setAttribute(PLACEHOLDER_HIDDEN_ATTR, "true");
    }

    return true;
}

function isPlaceholderInCorrectPosition(placeholder, container, beforeNode) {
    return Boolean(
        placeholder &&
            placeholder.isConnected &&
            placeholder.parentElement === container &&
            placeholder.nextSibling === beforeNode
    );
}

function safelyPlacePlaceholder(placeholder, container, beforeNode) {
    if (!(placeholder instanceof HTMLElement) || !(container instanceof HTMLElement)) {
        return false;
    }

    if (!(beforeNode instanceof Node) || beforeNode.parentElement !== container) {
        if (placeholder.parentElement !== container || container.firstChild !== placeholder) {
            try {
                container.prepend(placeholder);
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    if (isPlaceholderInCorrectPosition(placeholder, container, beforeNode)) {
        return false;
    }

    try {
        container.insertBefore(placeholder, beforeNode);
        return true;
    } catch {
        try {
            if (placeholder.parentElement !== container || container.firstChild !== placeholder) {
                container.prepend(placeholder);
                return true;
            }
        } catch {}
        return false;
    }
}

export function removePlaceholder({ destroy = false } = {}) {
    const placeholder = state.placeholder;
    if (!(placeholder instanceof HTMLElement)) {
        return false;
    }

    const hadVisiblePlaceholder = isPlaceholderVisible(placeholder);

    if (destroy) {
        if (placeholder.isConnected) {
            placeholder.remove();
        }
        state.placeholder = null;
        return hadVisiblePlaceholder;
    }

    if (placeholder.isConnected) {
        setPlaceholderVisible(placeholder, false);
    }

    return hadVisiblePlaceholder;
}

export function ensurePlaceholderState(firstVisibleSection) {
    const container = getConversationContainer();

    if (!container || !firstVisibleSection || state.hiddenCount <= 0) {
        const hadPlaceholder = isPlaceholderVisible(state.placeholder);
        removePlaceholder();
        return hadPlaceholder;
    }

    const expectedLabel = getHiddenLabel(state.hiddenCount);

    let placeholder = state.placeholder;
    if (!(placeholder instanceof HTMLElement)) {
        placeholder = createPlaceholder();
        state.placeholder = placeholder;
    }

    let changed = false;

    const labelNode = getPlaceholderLabelNode(placeholder);
    if (labelNode && labelNode.textContent !== expectedLabel) {
        labelNode.textContent = expectedLabel;
        changed = true;
    }

    const beforeNode =
        getConversationSectionMountNode(firstVisibleSection) || firstVisibleSection;

    if (safelyPlacePlaceholder(placeholder, container, beforeNode)) {
        changed = true;
    }

    if (setPlaceholderVisible(placeholder, true)) {
        changed = true;
    }

    return changed;
}

export function revealContainer(container) {
    container.style.visibility = "";
}

export function hideContainer(container) {
    container.style.visibility = "hidden";
}

function getStartupMaskStyleElement() {
    return document.getElementById(STARTUP_MASK_STYLE_ID);
}

export function installStartupPruneMask(container, visibleSectionsLimit) {
    if (!(container instanceof HTMLElement)) return;
    if (!Number.isFinite(visibleSectionsLimit) || visibleSectionsLimit < 1) return;

    removeStartupPruneMask();

    const styleEl = document.createElement("style");
    styleEl.id = STARTUP_MASK_STYLE_ID;
    styleEl.textContent = `
[${STARTUP_MASK_ATTR}="true"] > section[data-turn]:not(:nth-last-of-type(-n + ${Math.floor(visibleSectionsLimit)})),
[${STARTUP_MASK_ATTR}="true"] > [data-turn-id-container]:not(:nth-last-of-type(-n + ${Math.floor(visibleSectionsLimit)})) {
    display: none !important;
}
`;

    container.setAttribute(STARTUP_MASK_ATTR, "true");
    (document.head || document.documentElement).appendChild(styleEl);
}

export function removeStartupPruneMask() {
    document
        .querySelectorAll(`[${STARTUP_MASK_ATTR}="true"]`)
        .forEach((el) => el.removeAttribute(STARTUP_MASK_ATTR));

    getStartupMaskStyleElement()?.remove();
}