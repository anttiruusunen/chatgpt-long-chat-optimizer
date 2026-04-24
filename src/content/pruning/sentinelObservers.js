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

function tryScheduleTopRestore({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (shouldSuspendSentinelAutomation()) return;
    if (!state.isTopRestoreSentinelVisible) return;
    if (!state.softPrunedSections.length) return;
    if (!state.isTopRestoreArmed) return;
    if (state.isTopRestoreScheduled) return;
    if (state.isBottomPruneScheduled) return;
    if (state.isApplyingDomChanges) return;
    if (!consumeTopRestoreIntent()) return;

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

            debugLog(
                "Sentinels: restored one exchange from top edge intent"
            );
        } finally {
            state.isTopRestoreScheduled = false;
        }
    }, 0);
}

function tryScheduleBottomPrune({
    ensureObserverAttached,
    withDomMutationGuard,
    refreshObservedSections,
}) {
    if (shouldSuspendSentinelAutomation()) return;
    if (!state.isBottomPruneSentinelVisible) return;
    if (!hasProtectedVisibleSections()) return;
    if (!state.isBottomPruneArmed) return;
    if (state.isBottomPruneScheduled) return;
    if (state.isTopRestoreScheduled) return;
    if (state.isApplyingDomChanges) return;
    if (!consumeBottomPruneIntent()) return;

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

            debugLog(
                "Sentinels: repruned one exchange from bottom edge intent"
            );
        } finally {
            state.isBottomPruneScheduled = false;
        }
    }, 0);
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

export function refreshTopRestoreSentinelObservation(args) {
    ensureScrollIntentListener();

    window.removeEventListener(
        "thread-optimizer-top-edge-intent",
        state.topRestoreIntentHandler
    );

    state.topRestoreIntentHandler = () => {
        tryScheduleTopRestore(args);
    };

    window.addEventListener(
        "thread-optimizer-top-edge-intent",
        state.topRestoreIntentHandler
    );

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

export function refreshBottomPruneSentinelObservation(args) {
    ensureScrollIntentListener();

    window.removeEventListener(
        "thread-optimizer-bottom-edge-intent",
        state.bottomPruneIntentHandler
    );

    state.bottomPruneIntentHandler = () => {
        tryScheduleBottomPrune(args);
    };

    window.addEventListener(
        "thread-optimizer-bottom-edge-intent",
        state.bottomPruneIntentHandler
    );

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