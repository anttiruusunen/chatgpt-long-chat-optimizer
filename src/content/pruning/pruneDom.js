import {
    state,
    PRUNED_ATTR,
    OFFSCREEN_OPT_ATTR,
    CODE_BLOCK_OFFSCREEN_OPT_ATTR,
    UNPRUNEABLE_ATTR,
} from "../core/state.js";
import { getConversationTurnRoot } from "../core/dom.js";

export function destroySectionForGc(section) {
    try {
        state.intersectionObserver?.unobserve(section);
    } catch {}

    try {
        state.resizeObserver?.unobserve(section);
    } catch {}

    state.observedSections?.delete(section);

    const codeBlocks = Array.from(section.querySelectorAll("pre"));

    for (const pre of codeBlocks) {
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
    const turnRoot = getConversationTurnRoot(section) ?? section;

    section.setAttribute(PRUNED_ATTR, "true");
    section.removeAttribute(UNPRUNEABLE_ATTR);

    if (turnRoot.isConnected) {
        turnRoot.remove();
    }
}

export function restoreSoftPrunedSection(section, container, beforeNode = null) {
    const turnRoot = getConversationTurnRoot(section) ?? section;
    const beforeRoot = beforeNode ? getConversationTurnRoot(beforeNode) ?? beforeNode : null;

    section.removeAttribute(PRUNED_ATTR);

    if (!(container instanceof Element)) {
        return;
    }

    if (
        beforeRoot instanceof Node &&
        beforeRoot.parentElement === container
    ) {
        container.insertBefore(turnRoot, beforeRoot);
    } else {
        container.appendChild(turnRoot);
    }
}

export function hardEvictSection(section) {
    const turnRoot = getConversationTurnRoot(section) ?? section;

    if (turnRoot.isConnected) {
        turnRoot.remove();
    }

    destroySectionForGc(section);
}