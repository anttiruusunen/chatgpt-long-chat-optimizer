import {
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../core/state.js";

const STRUCTURAL_STOP_TAGS = new Set(["MAIN", "BODY", "HTML"]);

/**
 * =========================
 * Cache Layer
 * =========================
 */

let domCacheVersion = 0;

let cachedContainer = null;
let cachedContainerVersion = -1;

let cachedSections = null;
let cachedSectionsVersion = -1;

const mountNodeCache = new WeakMap();

export function invalidateConversationDomCache() {
    domCacheVersion += 1;

    cachedContainer = null;
    cachedContainerVersion = -1;

    cachedSections = null;
    cachedSectionsVersion = -1;
}

/**
 * =========================
 * Core helpers
 * =========================
 */

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

/**
 * =========================
 * Mount node (cached)
 * =========================
 */

export function getConversationSectionMountNode(section) {
    if (!isConversationSection(section)) return null;

    const cached = mountNodeCache.get(section);
    if (cached?.version === domCacheVersion && cached.node?.isConnected) {
        return cached.node;
    }

    const explicitWrapper = section.closest("[data-turn-id-container]");
    if (explicitWrapper instanceof HTMLElement) {
        mountNodeCache.set(section, {
            version: domCacheVersion,
            node: explicitWrapper,
        });
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

    mountNodeCache.set(section, {
        version: domCacheVersion,
        node: mountNode,
    });

    return mountNode;
}

/**
 * =========================
 * Container (cached)
 * =========================
 */

export function getConversationContainer() {
    if (
        cachedContainerVersion === domCacheVersion &&
        cachedContainer instanceof HTMLElement &&
        cachedContainer.isConnected
    ) {
        return cachedContainer;
    }

    const anchor = getAnchorSection();
    if (!anchor) return null;

    const anchorMountNode =
        getConversationSectionMountNode(anchor) || anchor.parentElement || anchor;

    let current = anchorMountNode.parentElement;
    while (current instanceof HTMLElement) {
        const conversationSections = getConversationSectionsWithin(current);
        if (conversationSections.length > 1) {
            cachedContainer = current;
            cachedContainerVersion = domCacheVersion;
            return current;
        }
        current = current.parentElement;
    }

    cachedContainer = anchorMountNode.parentElement || null;
    cachedContainerVersion = domCacheVersion;
    return cachedContainer;
}

/**
 * =========================
 * Sections (cached)
 * =========================
 */

export function getConversationSections() {
    if (
        cachedSectionsVersion === domCacheVersion &&
        Array.isArray(cachedSections) &&
        cachedSections.every((section) => section.isConnected)
    ) {
        return cachedSections;
    }

    const container = getConversationContainer();
    if (!container) return [];

    cachedSections = getConversationSectionsWithin(container);
    cachedSectionsVersion = domCacheVersion;
    return cachedSections;
}

/**
 * =========================
 * Consumers
 * =========================
 */

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

export function resetConversationDomCacheForTests() {
    invalidateConversationDomCache();
}