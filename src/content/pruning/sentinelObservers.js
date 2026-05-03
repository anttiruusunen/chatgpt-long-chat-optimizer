import { getConversationScrollContainer } from "../core/dom.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    restoreOneExchangeFromSoftPruned,
    repruneOneExchangeFromVisibleProtected,
} from "../pruning/prune.js";
import { hasProtectedVisibleSections } from "../pruning/pruneSentinels.js";
import { state } from "../core/state.js";
import { debugLog } from "../core/logger.js";
import {
    ensureScrollIntentListener,
    consumeTopRestoreIntent,
    consumeBottomPruneIntent,
} from "../pruning/scrollIntent.js";

let latestTopRestoreArgs = null;
let latestBottomPruneArgs = null;

let topRestoreIntentListenerInstalled = false;
let bottomPruneIntentListenerInstalled = false;

function getObserverRoot() {
    return getConversationScrollContainer() ?? null;
}

function shouldSuspendSentinelAutomation() {
    return isReplyStreaming();
}

function clearTopObservedSentinel() {
    state.topRestoreObservedSentinel = null;
}

function clearBottomObservedSentinel() {
    state.bottomPruneObservedSentinel = null;
}

function disconnectTopRestoreObserver() {
    state.topRestoreObserver?.disconnect();
    clearTopObservedSentinel();
}

function disconnectBottomPruneObserver() {
    state.bottomPruneObserver?.disconnect();
    clearBottomObservedSentinel();
}

function canScheduleTopRestore() {
    return (
        !shouldSuspendSentinelAutomation() &&
        state.isTopRestoreSentinelVisible &&
        state.softPrunedSections.length > 0 &&
        state.isTopRestoreArmed &&
        !state.isTopRestoreScheduled &&
        !state.isBottomPruneScheduled &&
        !state.isApplyingDomChanges &&
        consumeTopRestoreIntent()
    );
}

function canScheduleBottomPrune() {
    return (
        !shouldSuspendSentinelAutomation() &&
        state.isBottomPruneSentinelVisible &&
        hasProtectedVisibleSections() &&
        state.isBottomPruneArmed &&
        !state.isBottomPruneScheduled &&
        !state.isTopRestoreScheduled &&
        !state.isApplyingDomChanges &&
        consumeBottomPruneIntent()
    );
}

/**
 * Restores one soft-pruned exchange when both conditions are true:
 * the top sentinel is visible and the user intentionally pushed past the top.
 */
function tryScheduleTopRestore({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!canScheduleTopRestore()) {
        return;
    }

    state.isTopRestoreScheduled = true;
    state.isTopRestoreArmed = false;

    setTimeout(() => {
        try {
            if (shouldSuspendSentinelAutomation()) return;
            if (state.isApplyingDomChanges) return;
            if (!state.softPrunedSections.length) return;
            if (state.isBottomPruneScheduled) return;

            restoreOneExchangeFromSoftPruned({
                ensureObserverAttached,
                withDomMutationGuard,
                refreshObservedSections,
            });

            debugLog("Sentinels: restored one exchange from top edge intent");
        } finally {
            state.isTopRestoreScheduled = false;
        }
    }, 0);
}

/**
 * Re-prunes one restored/protected exchange when the user intentionally pushes
 * past the bottom of the visible restored area.
 */
function tryScheduleBottomPrune({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (!canScheduleBottomPrune()) {
        return;
    }

    state.isBottomPruneScheduled = true;
    state.isBottomPruneArmed = false;

    setTimeout(() => {
        try {
            if (shouldSuspendSentinelAutomation()) return;
            if (state.isApplyingDomChanges) return;
            if (state.isTopRestoreScheduled) return;
            if (!hasProtectedVisibleSections()) return;

            repruneOneExchangeFromVisibleProtected({
                ensureObserverAttached,
                withDomMutationGuard,
                refreshObservedSections,
            });

            debugLog("Sentinels: repruned one exchange from bottom edge intent");
        } finally {
            state.isBottomPruneScheduled = false;
        }
    }, 0);
}

function ensureTopRestoreIntentListener() {
    if (topRestoreIntentListenerInstalled) {
        return;
    }

    window.addEventListener("thread-optimizer-top-edge-intent", () => {
        if (latestTopRestoreArgs) {
            tryScheduleTopRestore(latestTopRestoreArgs);
        }
    });

    topRestoreIntentListenerInstalled = true;
}

function ensureBottomPruneIntentListener() {
    if (bottomPruneIntentListenerInstalled) {
        return;
    }

    window.addEventListener("thread-optimizer-bottom-edge-intent", () => {
        if (latestBottomPruneArgs) {
            tryScheduleBottomPrune(latestBottomPruneArgs);
        }
    });

    bottomPruneIntentListenerInstalled = true;
}

export function disconnectSentinelObservers() {
    disconnectTopRestoreObserver();
    disconnectBottomPruneObserver();
}

export function invalidateSentinelObserversForRootChange() {
    const nextRoot = getObserverRoot();

    if (
        state.topRestoreObserver &&
        state.topRestoreObserverRoot !== nextRoot
    ) {
        disconnectTopRestoreObserver();
        state.topRestoreObserver = null;
        state.topRestoreObserverRoot = null;
    }

    if (
        state.bottomPruneObserver &&
        state.bottomPruneObserverRoot !== nextRoot
    ) {
        disconnectBottomPruneObserver();
        state.bottomPruneObserver = null;
        state.bottomPruneObserverRoot = null;
    }
}

/**
 * Observes the top restore sentinel.
 *
 * Intersection alone is not enough to restore history; scrollIntent.js must
 * also report that the user pushed past the top edge.
 */
export function refreshTopRestoreSentinelObservation(args) {
    ensureScrollIntentListener();

    latestTopRestoreArgs = args;
    ensureTopRestoreIntentListener();

    if (shouldSuspendSentinelAutomation()) {
        disconnectTopRestoreObserver();
        return;
    }

    const root = getObserverRoot();

    if (!state.topRestoreObserver || state.topRestoreObserverRoot !== root) {
        disconnectTopRestoreObserver();

        state.topRestoreObserver = new IntersectionObserver(
            (entries) => {
                const isIntersecting = entries.some(
                    (entry) => entry.isIntersecting
                );

                state.isTopRestoreSentinelVisible = isIntersecting;

                if (!isIntersecting) {
                    state.isTopRestoreArmed = true;
                    return;
                }

                tryScheduleTopRestore(args);
            },
            {
                root,
                rootMargin: "48px 0px 0px 0px",
                threshold: 0,
            }
        );

        state.topRestoreObserverRoot = root;
    }

    const sentinel = state.topRestoreSentinel;

    if (!sentinel?.isConnected || state.softPrunedSections.length <= 0) {
        disconnectTopRestoreObserver();
        return;
    }

    if (state.topRestoreObservedSentinel === sentinel) {
        return;
    }

    disconnectTopRestoreObserver();
    state.topRestoreObserver.observe(sentinel);
    state.topRestoreObservedSentinel = sentinel;
}

/**
 * Observes the bottom prune sentinel for restored/protected exchanges.
 *
 * The bottom sentinel only matters after the user has restored older messages;
 * scrolling back down re-prunes them into the soft-pruned buffer.
 */
export function refreshBottomPruneSentinelObservation(args) {
    ensureScrollIntentListener();

    latestBottomPruneArgs = args;
    ensureBottomPruneIntentListener();

    if (shouldSuspendSentinelAutomation()) {
        disconnectBottomPruneObserver();
        return;
    }

    const root = getObserverRoot();

    if (
        !state.bottomPruneObserver ||
        state.bottomPruneObserverRoot !== root
    ) {
        disconnectBottomPruneObserver();

        state.bottomPruneObserver = new IntersectionObserver(
            (entries) => {
                const isIntersecting = entries.some(
                    (entry) => entry.isIntersecting
                );

                state.isBottomPruneSentinelVisible = isIntersecting;

                if (!isIntersecting) {
                    state.isBottomPruneArmed = true;
                    return;
                }

                tryScheduleBottomPrune(args);
            },
            {
                root,
                rootMargin: "0px 0px 64px 0px",
                threshold: 0,
            }
        );

        state.bottomPruneObserverRoot = root;
    }

    const sentinel = state.bottomPruneSentinel;

    if (!sentinel?.isConnected || !hasProtectedVisibleSections()) {
        disconnectBottomPruneObserver();
        return;
    }

    if (state.bottomPruneObservedSentinel === sentinel) {
        return;
    }

    disconnectBottomPruneObserver();
    state.bottomPruneObserver.observe(sentinel);
    state.bottomPruneObservedSentinel = sentinel;
}