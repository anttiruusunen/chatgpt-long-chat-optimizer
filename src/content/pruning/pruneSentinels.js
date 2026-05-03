import {
    state,
    TOP_RESTORE_SENTINEL_ATTR,
    BOTTOM_PRUNE_SENTINEL_ATTR,
    UNPRUNEABLE_ATTR,
} from "../core/state.js";
import {
    getConversationContainer,
    getConversationSections,
} from "../core/dom.js";

function createInvisibleSentinel(attributeName) {
    const section = document.createElement("section");

    section.setAttribute(attributeName, "true");
    section.style.height = "1px";
    section.style.margin = "0";
    section.style.padding = "0";
    section.style.pointerEvents = "none";
    section.style.opacity = "0";

    return section;
}

function createTopRestoreSentinel() {
    return createInvisibleSentinel(TOP_RESTORE_SENTINEL_ATTR);
}

function createBottomPruneSentinel() {
    return createInvisibleSentinel(BOTTOM_PRUNE_SENTINEL_ATTR);
}

export function isSectionUnpruneable(section) {
    return section?.getAttribute?.(UNPRUNEABLE_ATTR) === "true";
}

export function markSectionUnpruneable(section) {
    section?.setAttribute?.(UNPRUNEABLE_ATTR, "true");
}

export function clearSectionUnpruneable(section) {
    section?.removeAttribute?.(UNPRUNEABLE_ATTR);
}

/**
 * Restored sections are temporarily protected so scrolling near the bottom
 * can re-prune them later through the bottom sentinel.
 */
export function getProtectedVisibleSections() {
    return getConversationSections().filter(isSectionUnpruneable);
}

export function hasProtectedVisibleSections() {
    return getProtectedVisibleSections().length > 0;
}

export function removeTopRestoreSentinel() {
    if (state.topRestoreSentinel?.isConnected) {
        state.topRestoreSentinel.remove();
    }

    state.topRestoreSentinel = null;
}

export function removeBottomPruneSentinel() {
    if (state.bottomPruneSentinel?.isConnected) {
        state.bottomPruneSentinel.remove();
    }

    state.bottomPruneSentinel = null;
}

function isTopRestoreSentinelInCorrectPosition(
    sentinel,
    container,
    firstVisibleSection
) {
    return Boolean(
        sentinel &&
            sentinel.isConnected &&
            sentinel.parentElement === container &&
            sentinel.nextElementSibling === firstVisibleSection
    );
}

function isBottomPruneSentinelInCorrectPosition(
    sentinel,
    container,
    lastVisibleSection
) {
    return Boolean(
        sentinel &&
            sentinel.isConnected &&
            sentinel.parentElement === container &&
            sentinel.previousElementSibling === lastVisibleSection
    );
}

/**
 * Top sentinel sits immediately before the first visible section.
 *
 * When it enters view, the observer can restore one older soft-pruned exchange.
 */
export function ensureTopRestoreSentinelState(firstVisibleSection) {
    const container = getConversationContainer();

    if (
        !container ||
        !firstVisibleSection ||
        state.softPrunedSections.length <= 0
    ) {
        const hadSentinel = Boolean(state.topRestoreSentinel?.isConnected);
        removeTopRestoreSentinel();
        return hadSentinel;
    }

    const sentinel = state.topRestoreSentinel;

    if (
        sentinel &&
        sentinel.isConnected &&
        isTopRestoreSentinelInCorrectPosition(
            sentinel,
            container,
            firstVisibleSection
        )
    ) {
        return false;
    }

    removeTopRestoreSentinel();

    const nextSentinel = createTopRestoreSentinel();

    if (firstVisibleSection.parentElement === container) {
        container.insertBefore(nextSentinel, firstVisibleSection);
    } else {
        container.prepend(nextSentinel);
    }

    state.topRestoreSentinel = nextSentinel;

    return true;
}

/**
 * Bottom sentinel sits immediately after the newest visible section.
 *
 * It only exists while protected/restored sections are visible; when reached,
 * those sections can be moved back into the soft-pruned buffer.
 */
export function ensureBottomPruneSentinelState(lastVisibleSection) {
    const container = getConversationContainer();
    const protectedVisibleSections = getProtectedVisibleSections();

    if (
        !container ||
        !lastVisibleSection ||
        protectedVisibleSections.length <= 0
    ) {
        const hadSentinel = Boolean(state.bottomPruneSentinel?.isConnected);
        removeBottomPruneSentinel();
        return hadSentinel;
    }

    const sentinel = state.bottomPruneSentinel;

    if (
        sentinel &&
        sentinel.isConnected &&
        isBottomPruneSentinelInCorrectPosition(
            sentinel,
            container,
            lastVisibleSection
        )
    ) {
        return false;
    }

    removeBottomPruneSentinel();

    const nextSentinel = createBottomPruneSentinel();

    if (lastVisibleSection.nextSibling) {
        container.insertBefore(nextSentinel, lastVisibleSection.nextSibling);
    } else {
        container.appendChild(nextSentinel);
    }

    state.bottomPruneSentinel = nextSentinel;

    return true;
}