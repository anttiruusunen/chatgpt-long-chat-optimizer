let navigationWatcherInstalled = false;
let lastKnownLocationKey = "";
let scheduledCheckTimers = new Set();
let originalPushState = null;
let originalReplaceState = null;
let currentNavigationCallback = null;

function getCurrentLocationKey() {
    return `${location.pathname}${location.search}${location.hash}`;
}

function clearScheduledCheck() {
    for (const timer of scheduledCheckTimers) {
        clearTimeout(timer);
    }

    scheduledCheckTimers.clear();
}

function scheduleNavigationCheck(reason, { delayMs = 0, alwaysNotify = false } = {}) {
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

function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const link = target.closest("a");
    if (!isConversationNavigationLink(link)) return;

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
    scheduleNavigationCheck(reason, {
        delayMs: 0,
        alwaysNotify: false,
    });
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
    clearScheduledCheck();

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