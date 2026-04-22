import {
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../core/state.js";

export function isConversationSection(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName !== "SECTION") return false;
    if (el.hasAttribute(PLACEHOLDER_ATTR)) return false;
    if (el.hasAttribute(TOP_RESTORE_SENTINEL_ATTR)) return false;
    if (el.hasAttribute(BOTTOM_PRUNE_SENTINEL_ATTR)) return false;

    const testId = el.getAttribute("data-testid") || "";
    const hasConversationTestId = testId.startsWith("conversation-turn-");
    const hasTurnAttr = el.hasAttribute("data-turn");

    return hasConversationTestId || hasTurnAttr;
}

function getLastConversationSectionInDocument() {
    const sections = Array.from(document.querySelectorAll("section"));
    for (let i = sections.length - 1; i >= 0; i--) {
        if (isConversationSection(sections[i])) {
            return sections[i];
        }
    }
    return null;
}

export function getAnchorSection() {
    const anchored = document.querySelector('section[data-scroll-anchor="true"]');
    if (isConversationSection(anchored)) {
        return anchored;
    }

    return getLastConversationSectionInDocument();
}

function getConversationSectionsWithin(root) {
    if (!(root instanceof HTMLElement)) return [];
    return Array.from(root.querySelectorAll("section")).filter(isConversationSection);
}

export function getConversationTurnRoot(section) {
    if (!isConversationSection(section)) return null;

    const wrapper = section.closest("[data-turn-id-container]");
    if (wrapper instanceof HTMLElement) {
        return wrapper;
    }

    return section;
}

export function getConversationSectionMountNode(section) {
    return getConversationTurnRoot(section);
}

export function getConversationContainer() {
    const anchor = getAnchorSection();
    if (!anchor) return null;

    let current = getConversationTurnRoot(anchor)?.parentElement || anchor.parentElement;
    while (current) {
        const conversationSections = getConversationSectionsWithin(current);
        if (conversationSections.length > 1) {
            return current;
        }
        current = current.parentElement;
    }

    return getConversationTurnRoot(anchor)?.parentElement || anchor.parentElement || null;
}

export function getConversationSections() {
    const container = getConversationContainer();
    if (!container) return [];

    return getConversationSectionsWithin(container);
}

export function getRecentSections(sectionsToKeep) {
    const sections = getConversationSections();
    if (sections.length === 0) return [];

    const anchor = getAnchorSection();
    const anchorIndex = anchor ? sections.indexOf(anchor) : -1;
    const endIndex = anchorIndex >= 0 ? anchorIndex + 1 : sections.length;
    const startIndex = Math.max(0, endIndex - sectionsToKeep);

    return sections.slice(startIndex, endIndex);
}

export function getLatestAssistantSection() {
    const sections = getConversationSections();

    for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i].getAttribute("data-turn") === "assistant") {
            return sections[i];
        }
    }

    return null;
}

export function getConversationScrollContainer() {
    const container = getConversationContainer();
    if (!container) {
        return document.scrollingElement || document.documentElement;
    }

    let current = container.parentElement;
    while (current) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const overflow = style.overflow;

        const isScrollable =
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflow === "auto" ||
            overflow === "scroll";

        if (isScrollable) {
            return current;
        }

        current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement;
}