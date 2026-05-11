let domCacheVersion = 0;
let scrollContainerCacheVersion = 0;

let cachedContainer = null;
let cachedContainerVersion = -1;

let cachedSections = null;
let cachedSectionsVersion = -1;

let cachedScrollContainer = null;
let cachedScrollContainerVersion = -1;

/**
 * Invalidates structural DOM caches related to:
 * - conversation container
 * - conversation sections
 *
 * This intentionally does not invalidate the scroll container cache.
 */
export function invalidateConversationDomCache() {
    domCacheVersion += 1;

    cachedContainer = null;
    cachedContainerVersion = -1;

    cachedSections = null;
    cachedSectionsVersion = -1;
}

/**
 * Explicitly invalidates the scroll container cache.
 */
export function invalidateConversationScrollContainerCache() {
    scrollContainerCacheVersion += 1;

    cachedScrollContainer = null;
    cachedScrollContainerVersion = -1;
}

export function isConversationSection(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.tagName !== "SECTION") return false;

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
 * If that marker is missing, fall back to the last mounted conversation section.
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

/**
 * Finds a connected ancestor containing the mounted conversation sections.
 *
 * Store pruning owns deletion. This helper only discovers the current mounted
 * chat DOM so observers/offscreen logic can inspect what React has rendered.
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

    if (!anchor) {
        cachedContainer = null;
        cachedContainerVersion = domCacheVersion;
        return null;
    }

    let bestContainer = anchor.parentElement || anchor;
    let current = bestContainer;

    while (current instanceof HTMLElement) {
        const conversationSections = getConversationSectionsWithin(current);

        if (conversationSections.length > 1) {
            bestContainer = current;
        }

        current = current.parentElement;
    }

    cachedContainer = bestContainer;
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

    if (!container) {
        cachedSections = [];
        cachedSectionsVersion = domCacheVersion;
        return cachedSections;
    }

    cachedSections = getConversationSectionsWithin(container);
    cachedSectionsVersion = domCacheVersion;

    return cachedSections;
}

/**
 * Returns the most recent mounted sections relative to the current scroll anchor.
 */
export function getRecentSections(sectionsToKeep) {
    const sections = getConversationSections();

    if (sections.length === 0) return [];

    const safeSectionsToKeep = Math.max(
        0,
        Math.floor(Number(sectionsToKeep) || 0)
    );

    if (safeSectionsToKeep <= 0) return [];

    const anchor = getAnchorSection();
    const anchorIndex = anchor ? sections.indexOf(anchor) : -1;

    const endIndex = anchorIndex >= 0 ? anchorIndex + 1 : sections.length;
    const startIndex = Math.max(0, endIndex - safeSectionsToKeep);

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
 */
export function getConversationScrollContainer() {
    if (
        cachedScrollContainerVersion === scrollContainerCacheVersion &&
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
        cachedScrollContainerVersion = scrollContainerCacheVersion;
        return cachedScrollContainer;
    }

    let current = container.parentElement;

    while (current instanceof HTMLElement) {
        const style = window.getComputedStyle(current);
        const overflowY = style.overflowY;
        const overflow = style.overflow;

        if (
            overflowY === "auto" ||
            overflowY === "scroll" ||
            overflow === "auto" ||
            overflow === "scroll"
        ) {
            cachedScrollContainer = current;
            cachedScrollContainerVersion = scrollContainerCacheVersion;
            return cachedScrollContainer;
        }

        current = current.parentElement;
    }

    cachedScrollContainer = fallbackScrollContainer;
    cachedScrollContainerVersion = scrollContainerCacheVersion;

    return cachedScrollContainer;
}

export function resetConversationDomCacheForTests() {
    invalidateConversationDomCache();
    invalidateConversationScrollContainerCache();
}