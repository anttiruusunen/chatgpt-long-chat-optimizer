import {
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../core/state.js";

const STRUCTURAL_STOP_TAGS = new Set(["MAIN", "BODY", "HTML"]);

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
    for (let i = sections.length - 1; i >= 0; i -= 1) {
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

function countConversationSectionsWithin(root) {
    return getConversationSectionsWithin(root).length;
}

function hasOnlyCurrentAsElementChild(parent, current) {
    if (!(parent instanceof HTMLElement) || !(current instanceof Element)) {
        return false;
    }

    const elementChildren = Array.from(parent.children);
    return elementChildren.length === 1 && elementChildren[0] === current;
}

export function getConversationTurnRoot(section) {
    return getConversationSectionMountNode(section);
}

export function getConversationSectionMountNode(section) {
    if (!isConversationSection(section)) return null;

    const explicitWrapper = section.closest("[data-turn-id-container]");
    if (explicitWrapper instanceof HTMLElement) {
        return explicitWrapper;
    }

    let mountNode = section;
    let current = section;

    while (current.parentElement instanceof HTMLElement) {
        const parent = current.parentElement;

        if (STRUCTURAL_STOP_TAGS.has(parent.tagName)) {
            break;
        }

        if (
            parent.hasAttribute(PLACEHOLDER_ATTR) ||
            parent.hasAttribute(TOP_RESTORE_SENTINEL_ATTR) ||
            parent.hasAttribute(BOTTOM_PRUNE_SENTINEL_ATTR)
        ) {
            break;
        }

        if (!hasOnlyCurrentAsElementChild(parent, current)) {
            break;
        }

        if (countConversationSectionsWithin(parent) !== 1) {
            break;
        }

        const grandparent = parent.parentElement;
        if (grandparent && STRUCTURAL_STOP_TAGS.has(grandparent.tagName)) {
            break;
        }

        mountNode = parent;
        current = parent;
    }

    return mountNode;
}

export function getConversationContainer() {
    const anchor = getAnchorSection();
    if (!anchor) return null;

    const anchorMountNode =
        getConversationSectionMountNode(anchor) || anchor.parentElement || anchor;

    let current = anchorMountNode.parentElement;
    while (current instanceof HTMLElement) {
        const conversationSections = getConversationSectionsWithin(current);
        if (conversationSections.length > 1) {
            return current;
        }
        current = current.parentElement;
    }

    return anchorMountNode.parentElement || null;
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

    for (let i = sections.length - 1; i >= 0; i -= 1) {
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
    while (current instanceof HTMLElement) {
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