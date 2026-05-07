import {
    PRUNED_ATTR,
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
    return beforeNode
        ? getConversationTurnRoot(beforeNode) ?? beforeNode
        : null;
}

function insertTurnRoot(container, turnRoot, beforeRoot = null) {
    if (!(container instanceof Element) || !(turnRoot instanceof Node)) {
        return;
    }

    if (beforeRoot instanceof Node && beforeRoot.parentElement === container) {
        container.insertBefore(turnRoot, beforeRoot);
        return;
    }

    container.appendChild(turnRoot);
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

        if (!(section instanceof HTMLElement)) {
            continue;
        }

        const turnRoot = getTurnRoot(section);

        section.removeAttribute(PRUNED_ATTR);
        fragment.appendChild(turnRoot);

        restoredCount += 1;
        onRestore?.(section);
    }

    if (restoredCount === 0) {
        return 0;
    }

    if (beforeRoot instanceof Node && beforeRoot.parentElement === container) {
        container.insertBefore(fragment, beforeRoot);
    } else {
        container.appendChild(fragment);
    }

    return restoredCount;
}