let navigationWatcherInstalled = false;
let lastKnownLocationKey = "";
let scheduledCheckTimers = new Set();

let originalPushState = null;
let originalReplaceState = null;

let currentNavigationCallback = null;

function getCurrentLocationKey() {
    return `${location.pathname}${location.search}${location.hash}`;
}

function clearScheduledChecks() {
    for (const timer of scheduledCheckTimers) {
        clearTimeout(timer);
    }

    scheduledCheckTimers.clear();
}

/**
 * Schedules a delayed URL check.
 *
 * ChatGPT navigation often updates the URL before the new conversation DOM is
 * fully mounted, so click-triggered checks use short follow-up delays.
 */
function scheduleNavigationCheck(
    reason,
    {
        delayMs = 0,
        alwaysNotify = false,
    } = {}
) {
    const timer = setTimeout(() => {
        scheduledCheckTimers.delete(timer);

        const nextKey = getCurrentLocationKey();
        const locationChanged = nextKey !== lastKnownLocationKey;

        if (!locationChanged && !alwaysNotify) {
            return;
        }

        lastKnownLocationKey = nextKey;

        currentNavigationCallback?.({
            reason,
            locationKey: nextKey,
        });
    }, delayMs);

    scheduledCheckTimers.add(timer);
}

function isConversationNavigationLink(element) {
    if (!(element instanceof HTMLAnchorElement)) {
        return false;
    }

    const href = element.getAttribute("href") || "";

    return (
        element.hasAttribute("data-sidebar-item") ||
        element.getAttribute("data-sidebar-item") === "true" ||
        href.startsWith("/c/") ||
        href.includes("/c/")
    );
}

/**
 * Sidebar/recent-chat clicks can reuse the same URL briefly while React swaps
 * content. We notify once shortly after the click and again after a longer
 * delay so the lifecycle code can wait for a fresh container.
 */
function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const link = target.closest("a");
    if (!isConversationNavigationLink(link)) {
        return;
    }

    scheduleNavigationCheck("conversation-link-click", {
        delayMs: 150,
        alwaysNotify: true,
    });

    scheduleNavigationCheck("conversation-link-click-followup", {
        delayMs: 600,
        alwaysNotify: true,
    });
}

function handleHistoryNavigation(reason) {
    scheduleNavigationCheck(reason);
}

function patchHistoryMethods() {
    if (originalPushState || originalReplaceState) {
        return;
    }

    originalPushState = history.pushState.bind(history);
    originalReplaceState = history.replaceState.bind(history);

    history.pushState = function pushStatePatched(...args) {
        const result = originalPushState(...args);
        handleHistoryNavigation("pushState");
        return result;
    };

    history.replaceState = function replaceStatePatched(...args) {
        const result = originalReplaceState(...args);
        handleHistoryNavigation("replaceState");
        return result;
    };
}

function restoreHistoryMethods() {
    if (originalPushState) {
        history.pushState = originalPushState;
        originalPushState = null;
    }

    if (originalReplaceState) {
        history.replaceState = originalReplaceState;
        originalReplaceState = null;
    }
}

function handlePopState() {
    handleHistoryNavigation("popstate");
}

function handleHashChange() {
    handleHistoryNavigation("hashchange");
}

/**
 * Installs navigation detection for ChatGPT's SPA routing.
 *
 * We combine patched history methods, pop/hash listeners, and captured link
 * clicks because no single signal reliably covers all sidebar and conversation
 * navigation paths.
 */
export function installConversationNavigationWatcher({ onNavigationDetected }) {
    currentNavigationCallback = onNavigationDetected;

    if (navigationWatcherInstalled) {
        return;
    }

    navigationWatcherInstalled = true;
    lastKnownLocationKey = getCurrentLocationKey();

    patchHistoryMethods();

    document.addEventListener("click", handleDocumentClick, true);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("hashchange", handleHashChange);
}

export function resetConversationNavigationWatcherForTests() {
    clearScheduledChecks();

    if (navigationWatcherInstalled) {
        document.removeEventListener("click", handleDocumentClick, true);
        window.removeEventListener("popstate", handlePopState);
        window.removeEventListener("hashchange", handleHashChange);
    }

    restoreHistoryMethods();

    navigationWatcherInstalled = false;
    lastKnownLocationKey = "";
    currentNavigationCallback = null;
}