const STARTUP_MASK_ATTR = "data-thread-optimizer-startup-mask";
const STARTUP_MASK_STYLE_ID = "thread-optimizer-startup-mask-style";

export function revealContainer(container) {
    if (container instanceof HTMLElement) {
        container.style.visibility = "";
    }
}

export function hideContainer(container) {
    if (container instanceof HTMLElement) {
        container.style.visibility = "hidden";
    }
}

function getStartupMaskStyleElement() {
    return document.getElementById(STARTUP_MASK_STYLE_ID);
}

/**
 * Creates a temporary CSS mask used during startup pruning.
 *
 * Store-native pruning can happen before ChatGPT reconciles the visible DOM.
 * This mask hides older turns during that window so the full conversation does
 * not flash on page load.
 */
function collectStartupPruneMaskPlan(container, visibleSectionsLimit) {
    if (!(container instanceof HTMLElement)) {
        return { shouldApply: false };
    }

    if (!Number.isFinite(visibleSectionsLimit) || visibleSectionsLimit < 1) {
        return { shouldApply: false };
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
    applyStartupPruneMaskPlan(
        collectStartupPruneMaskPlan(container, visibleSectionsLimit)
    );
}

export function removeStartupPruneMask() {
    applyRemoveStartupPruneMaskPlan(collectRemoveStartupPruneMaskPlan());
}