import {
    PLACEHOLDER_ATTR,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
} from "../core/state.js";

const STRUCTURAL_STOP_TAGS = new Set(["MAIN", "BODY", "HTML"]);

let domCacheVersion = 0;

let cachedContainer = null;
let cachedContainerVersion = -1;

let cachedSections = null;
let cachedSectionsVersion = -1;

let cachedScrollContainer = null;
let cachedScrollContainerVersion = -1;

const mountNodeCache = new WeakMap();

export function invalidateConversationDomCache() {
    domCacheVersion += 1;

    cachedContainer = null;
    cachedContainerVersion = -1;

    cachedSections = null;
    cachedSectionsVersion = -1;

    cachedScrollContainer = null;
    cachedScrollContainerVersion = -1;
}

export function isConversationSection(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.tagName !== "SECTION") return false;

    if (
        element.hasAttribute(PLACEHOLDER_ATTR) ||
        element.hasAttribute(TOP_RESTORE_SENTINEL_ATTR) ||
        element.hasAttribute(BOTTOM_PRUNE_SENTINEL_ATTR)
    ) {
        return false;
    }

    const testId = element.getAttribute("data-testid") || "";

    return (
        testId.startsWith("conversation-turn-") ||
        element.hasAttribute("data-turn")
    );
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

/**
 * ChatGPT marks the current bottom turn with data-scroll-anchor when possible.
 * If that marker is missing, fall back to the last conversation section.
 */
export function getAnchorSection() {
    const anchored = document.querySelector('section[data-scroll-anchor="true"]');

    if (isConversationSection(anchored)) {
        return anchored;
    }

    return getLastConversationSectionInDocument();
}

function getConversationSectionsWithin(root) {
    if (!(root instanceof HTMLElement)) return [];

    return Array.from(root.querySelectorAll("section")).filter(
        isConversationSection
    );
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
 * Returns the DOM node that should be removed/restored for a conversation turn.
 *
 * ChatGPT often wraps each <section> in one or more single-child layout nodes.
 * Removing only the section can leave empty wrappers behind, so we climb through
 * safe single-child wrappers until we reach a structural boundary.
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
 * Finds the smallest ancestor that contains the visible conversation turns.
 *
 * The container is derived from the current anchor instead of hardcoded
 * selectors so the extension survives ChatGPT DOM reshuffles.
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
        getConversationSectionMountNode(anchor) ||
        anchor.parentElement ||
        anchor;

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
 * Returns the most recent sections relative to the current scroll anchor.
 *
 * This is used by pruning so "recent" follows ChatGPT's anchor when it exists,
 * rather than blindly using the physical end of the DOM.
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

/**
 * Finds the scrollable ancestor for the conversation.
 *
 * Falls back to the document scroller because ChatGPT's scroll container can
 * change between layouts, logged-out states, and test fixtures.
 */
export function getConversationScrollContainer() {
    if (
        cachedScrollContainerVersion === domCacheVersion &&
        cachedScrollContainer instanceof Element &&
        cachedScrollContainer.isConnected
    ) {
        return cachedScrollContainer;
    }

    const fallbackScrollContainer =
        document.scrollingElement || document.documentElement;

    const container = getConversationContainer();
    if (!container) {
        cachedScrollContainer = fallbackScrollContainer;
        cachedScrollContainerVersion = domCacheVersion;
        return cachedScrollContainer;
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
            cachedScrollContainer = current;
            cachedScrollContainerVersion = domCacheVersion;
            return cachedScrollContainer;
        }

        current = current.parentElement;
    }

    cachedScrollContainer = fallbackScrollContainer;
    cachedScrollContainerVersion = domCacheVersion;

    return cachedScrollContainer;
}

export function resetConversationDomCacheForTests() {
    invalidateConversationDomCache();
}