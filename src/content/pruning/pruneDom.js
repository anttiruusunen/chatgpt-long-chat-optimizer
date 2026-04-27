import {
    state,
    PRUNED_ATTR,
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
    UNPRUNEABLE_ATTR,
} from "../core/state.js";
import { getConversationTurnRoot } from "../core/dom.js";

function getTurnRoot(section) {
    return getConversationTurnRoot(section) ?? section;
}

function detachTurnRoot(turnRoot) {
    if (turnRoot?.isConnected) {
        turnRoot.remove();
    }
}

function getRestoreBeforeRoot(beforeNode) {
    return beforeNode ? getConversationTurnRoot(beforeNode) ?? beforeNode : null;
}

function insertTurnRoot(container, turnRoot, beforeRoot = null) {
    if (!(container instanceof Element) || !(turnRoot instanceof Node)) {
        return;
    }

    if (
        beforeRoot instanceof Node &&
        beforeRoot.parentElement === container
    ) {
        container.insertBefore(turnRoot, beforeRoot);
        return;
    }

    container.appendChild(turnRoot);
}

function getSectionCodeBlocks(section) {
    if (!(section instanceof HTMLElement)) {
        return [];
    }

    return Array.from(section.querySelectorAll("pre"));
}

function getSoftPrunePlan(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    return {
        section,
        turnRoot: getTurnRoot(section),
    };
}

function applySoftPrunePlan(plan) {
    if (!plan) {
        return false;
    }

    const { section, turnRoot } = plan;

    section.setAttribute(PRUNED_ATTR, "true");
    section.removeAttribute(UNPRUNEABLE_ATTR);

    detachTurnRoot(turnRoot);

    return true;
}

function getHardEvictPlan(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    return {
        section,
        turnRoot: getTurnRoot(section),
        codeBlocks: getSectionCodeBlocks(section),
    };
}

function applyHardEvictPlan(plan) {
    if (!plan) {
        return false;
    }

    const { section, turnRoot, codeBlocks } = plan;

    detachTurnRoot(turnRoot);
    destroySectionForGc(section, { codeBlocks });

    return true;
}

export function destroySectionForGc(section, { codeBlocks = null } = {}) {
    try {
        state.intersectionObserver?.unobserve(section);
    } catch {}

    try {
        state.resizeObserver?.unobserve(section);
    } catch {}

    state.observedSections?.delete(section);

    const sectionCodeBlocks = Array.isArray(codeBlocks)
        ? codeBlocks
        : getSectionCodeBlocks(section);

    for (const pre of sectionCodeBlocks) {
        try {
            state.codeBlockIntersectionObserver?.unobserve(pre);
        } catch {}

        state.observedCodeBlocks?.delete(pre);

        pre.style.contentVisibility = "";
        pre.style.containIntrinsicSize = "";
        pre.removeAttribute(CODE_BLOCK_OFFSCREEN_OPT_ATTR);
        delete pre.dataset.threadOptimizerCodeHeight;
        delete pre.dataset.threadOptimizerLargeCode;
    }

    section.style.contentVisibility = "";
    section.style.containIntrinsicSize = "";
    section.removeAttribute(OFFSCREEN_OPT_ATTR);
    section.removeAttribute(PRUNED_ATTR);
    section.removeAttribute(UNPRUNEABLE_ATTR);
    delete section.dataset.threadOptimizerHeight;

    section.replaceChildren();
}

export function softPruneSection(section) {
    return applySoftPrunePlan(getSoftPrunePlan(section));
}

export function softPruneSections(sections) {
    const plans = [];

    for (let i = 0; i < sections.length; i += 1) {
        const plan = getSoftPrunePlan(sections[i]);
        if (plan) {
            plans.push(plan);
        }
    }

    let prunedCount = 0;

    for (let i = 0; i < plans.length; i += 1) {
        if (applySoftPrunePlan(plans[i])) {
            prunedCount += 1;
        }
    }

    return prunedCount;
}

export function restoreSoftPrunedSection(section, container, beforeNode = null) {
    const turnRoot = getTurnRoot(section);
    const beforeRoot = getRestoreBeforeRoot(beforeNode);

    section.removeAttribute(PRUNED_ATTR);
    insertTurnRoot(container, turnRoot, beforeRoot);
}

export function restoreSoftPrunedSections(
    sections,
    container,
    beforeNode = null,
    { onRestore } = {}
) {
    if (!(container instanceof Element)) {
        return 0;
    }

    const beforeRoot = getRestoreBeforeRoot(beforeNode);
    const fragment = document.createDocumentFragment();
    let restoredCount = 0;

    for (let i = 0; i < sections.length; i += 1) {
        const section = sections[i];
        if (!(section instanceof HTMLElement)) continue;

        const turnRoot = getTurnRoot(section);

        section.removeAttribute(PRUNED_ATTR);
        fragment.appendChild(turnRoot);

        restoredCount += 1;
        onRestore?.(section);
    }

    if (restoredCount === 0) {
        return 0;
    }

    if (
        beforeRoot instanceof Node &&
        beforeRoot.parentElement === container
    ) {
        container.insertBefore(fragment, beforeRoot);
    } else {
        container.appendChild(fragment);
    }

    return restoredCount;
}

export function hardEvictSection(section) {
    return applyHardEvictPlan(getHardEvictPlan(section));
}

export function hardEvictSections(sections) {
    const plans = [];

    for (let i = 0; i < sections.length; i += 1) {
        const plan = getHardEvictPlan(sections[i]);
        if (plan) {
            plans.push(plan);
        }
    }

    let evictedCount = 0;

    for (let i = 0; i < plans.length; i += 1) {
        if (applyHardEvictPlan(plans[i])) {
            evictedCount += 1;
        }
    }

    return evictedCount;
}