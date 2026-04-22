let navigationWatcherInstalled = false;
let lastKnownLocationKey = "";
let scheduledCheckTimer = null;
let originalPushState = null;
let originalReplaceState = null;
let currentNavigationCallback = null;

function getCurrentLocationKey() {
    return `${location.pathname}${location.search}${location.hash}`;
}

function clearScheduledCheck() {
    if (scheduledCheckTimer) {
        clearTimeout(scheduledCheckTimer);
        scheduledCheckTimer = null;
    }
}

function scheduleNavigationCheck(reason, { delayMs = 0, alwaysNotify = false } = {}) {
    if (scheduledCheckTimer) {
        return;
    }

    scheduledCheckTimer = setTimeout(() => {
        scheduledCheckTimer = null;

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
}

function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const sidebarLink = target.closest('a[data-sidebar-item="true"]');
    if (!sidebarLink) return;

    scheduleNavigationCheck("sidebar-click", {
        delayMs: 150,
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