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

    if (beforeNode instanceof Node && beforeNode.parentNode === container) {
        if (placeholder.parentNode === container && placeholder.nextSibling === beforeNode) {
            return false;
        }

        try {
            container.insertBefore(placeholder, beforeNode);
            return true;
        } catch {
            return false;
        }
    }

    if (placeholder.parentNode === container && container.firstChild === placeholder) {
        return false;
    }

    try {
        container.prepend(placeholder);
        return true;
    } catch {
        return false;
    }
}

function collectRemovePlaceholderPlan({ destroy = false } = {}) {
    const placeholder = state.placeholder;

    return {
        destroy: Boolean(destroy),
        placeholder,
        hadVisiblePlaceholder: isPlaceholderVisible(placeholder),
    };
}

function applyRemovePlaceholderPlan(plan) {
    const { placeholder, destroy, hadVisiblePlaceholder } = plan;

    if (!(placeholder instanceof HTMLElement)) {
        return false;
    }

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

export function removePlaceholder({ destroy = false } = {}) {
    const plan = collectRemovePlaceholderPlan({ destroy });
    return applyRemovePlaceholderPlan(plan);
}

function collectPlaceholderStatePlan(firstVisibleSection) {
    const container = getConversationContainer();
    const shouldRemove =
        !container || !firstVisibleSection || state.hiddenCount <= 0;

    if (shouldRemove) {
        return {
            type: "remove",
            removePlan: collectRemovePlaceholderPlan(),
        };
    }

    let placeholder = state.placeholder;
    const needsCreate = !(placeholder instanceof HTMLElement);

    if (needsCreate) {
        placeholder = createPlaceholder();
    }

    const beforeNode =
        getConversationSectionMountNode(firstVisibleSection) || firstVisibleSection;

    return {
        type: "ensure",
        container,
        placeholder,
        needsCreate,
        expectedLabel: getHiddenLabel(state.hiddenCount),
        beforeNode,
    };
}

function applyPlaceholderStatePlan(plan) {
    if (plan.type === "remove") {
        return applyRemovePlaceholderPlan(plan.removePlan);
    }

    const {
        container,
        placeholder,
        needsCreate,
        expectedLabel,
        beforeNode,
    } = plan;

    if (needsCreate) {
        state.placeholder = placeholder;
    }

    let changed = false;

    const labelNode = getPlaceholderLabelNode(placeholder);
    if (labelNode && labelNode.textContent !== expectedLabel) {
        labelNode.textContent = expectedLabel;
        changed = true;
    }

    if (safelyPlacePlaceholder(placeholder, container, beforeNode)) {
        changed = true;
    }

    if (setPlaceholderVisible(placeholder, true)) {
        changed = true;
    }

    return changed;
}

export function ensurePlaceholderState(firstVisibleSection) {
    const plan = collectPlaceholderStatePlan(firstVisibleSection);
    return applyPlaceholderStatePlan(plan);
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

function collectStartupPruneMaskPlan(container, visibleSectionsLimit) {
    if (!(container instanceof HTMLElement)) {
        return {
            shouldApply: false,
        };
    }

    if (!Number.isFinite(visibleSectionsLimit) || visibleSectionsLimit < 1) {
        return {
            shouldApply: false,
        };
    }

    const safeVisibleSectionsLimit = Math.floor(visibleSectionsLimit);

    return {
        shouldApply: true,
        container,
        styleText: `
[${STARTUP_MASK_ATTR}="true"] > section[data-turn]:not(:nth-last-of-type(-n + ${safeVisibleSectionsLimit})),
[${STARTUP_MASK_ATTR}="true"] > [data-turn-id-container]:not(:nth-last-of-type(-n + ${safeVisibleSectionsLimit})) {
    display: none !important;
}
`,
    };
}

function collectRemoveStartupPruneMaskPlan() {
    return {
        maskedElements: Array.from(
            document.querySelectorAll(`[${STARTUP_MASK_ATTR}="true"]`)
        ),
        styleEl: getStartupMaskStyleElement(),
    };
}

function applyRemoveStartupPruneMaskPlan(plan) {
    for (let i = 0; i < plan.maskedElements.length; i += 1) {
        plan.maskedElements[i].removeAttribute(STARTUP_MASK_ATTR);
    }

    plan.styleEl?.remove();
}

function applyStartupPruneMaskPlan(plan) {
    if (!plan.shouldApply) {
        return;
    }

    applyRemoveStartupPruneMaskPlan(collectRemoveStartupPruneMaskPlan());

    const styleEl = document.createElement("style");
    styleEl.id = STARTUP_MASK_STYLE_ID;
    styleEl.textContent = plan.styleText;

    plan.container.setAttribute(STARTUP_MASK_ATTR, "true");
    (document.head || document.documentElement).appendChild(styleEl);
}

export function installStartupPruneMask(container, visibleSectionsLimit) {
    const plan = collectStartupPruneMaskPlan(container, visibleSectionsLimit);
    applyStartupPruneMaskPlan(plan);
}

export function removeStartupPruneMask() {
    const plan = collectRemoveStartupPruneMaskPlan();
    applyRemoveStartupPruneMaskPlan(plan);
}