let navigationWatcherInstalled = false;
let lastKnownLocationKey = "";
let scheduledCheckTimers = new Set();

let originalPushState = null;
let originalReplaceState = null;

let currentNavigationCallback = null;

let pendingConversationLinkClickUntil = 0;

const CONVERSATION_LINK_HISTORY_SUPPRESSION_MS = 1000;

export function getCurrentLocationKey() {
    return `${location.pathname}${location.search}${location.hash}`;
}

export function getPathnameFromLocationKey(locationKey = null) {
    const fallbackPath =
        typeof window !== "undefined" && window.location
            ? `${window.location.pathname || "/"}${window.location.search || ""}${window.location.hash || ""}`
            : "/";

    const rawLocationKey =
        typeof locationKey === "string" && locationKey.trim()
            ? locationKey.trim()
            : fallbackPath;

    try {
        const url = new URL(rawLocationKey, window.location.origin);
        return url.pathname || "/";
    } catch {
        return String(rawLocationKey || "/").split(/[?#]/)[0] || "/";
    }
}

export function normalizeChatGptLocationPath(locationKey = null) {
    const fallbackPath =
        typeof window !== "undefined" && window.location
            ? `${window.location.pathname || "/"}${window.location.search || ""}`
            : "/";

    const rawLocationKey =
        typeof locationKey === "string" && locationKey.trim()
            ? locationKey.trim()
            : fallbackPath;

    try {
        const url = new URL(rawLocationKey, window.location.origin);
        return `${url.pathname || "/"}${url.search || ""}`;
    } catch {
        return rawLocationKey;
    }
}

export function isNewChatRouteLocation(locationKey = null) {
    const pathname = getPathnameFromLocationKey(locationKey);
    return pathname === "/";
}

export function isExistingConversationRouteLocation(locationKey = null) {
    const pathname = getPathnameFromLocationKey(locationKey);

    return (
        /^\/c\/[^/]+/.test(pathname) ||
        /^\/g\/[^/]+\/c\/[^/]+/.test(pathname)
    );
}

export function isChatRouteLocation(locationKey = null) {
    const pathname = getPathnameFromLocationKey(locationKey);

    return (
        isNewChatRouteLocation(locationKey) ||
        isExistingConversationRouteLocation(locationKey) ||
        isE2EChatFixtureRoute(pathname)
    );
}

function clearScheduledChecks() {
    for (const timer of scheduledCheckTimers) {
        clearTimeout(timer);
    }

    scheduledCheckTimers.clear();
}

function markConversationLinkClickPending() {
    pendingConversationLinkClickUntil =
        performance.now() + CONVERSATION_LINK_HISTORY_SUPPRESSION_MS;
}

function hasPendingConversationLinkClick() {
    return performance.now() <= pendingConversationLinkClickUntil;
}

function clearPendingConversationLinkClick() {
    pendingConversationLinkClickUntil = 0;
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
        clearLinkClickPending = false,
    } = {}
) {
    const timer = setTimeout(() => {
        scheduledCheckTimers.delete(timer);

        if (clearLinkClickPending) {
            clearPendingConversationLinkClick();
        }

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

function normalizeTriggerText(value) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isNewChatNavigationTrigger(element) {
    if (!(element instanceof Element)) {
        return false;
    }

    const trigger = element.closest("a, button, [role='button']");
    if (!(trigger instanceof Element)) {
        return false;
    }

    const label = normalizeTriggerText(
        [
            trigger.getAttribute("aria-label"),
            trigger.getAttribute("title"),
            trigger.getAttribute("data-testid"),
            trigger.textContent,
        ]
            .filter(Boolean)
            .join(" ")
    );

    return (
        label === "new chat" ||
        label.includes("new chat") ||
        label.includes("new-chat")
    );
}

/**
 * Sidebar/recent-chat/new-chat clicks can update history before React has
 * mounted the next conversation. The click path is therefore the authoritative
 * signal for these navigations: it notifies after short delays, while immediate
 * pushState/replaceState events from the same click are suppressed.
 */
function handleDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
        return;
    }

    const link = target.closest("a");

    if (isConversationNavigationLink(link)) {
        markConversationLinkClickPending();

        scheduleNavigationCheck("conversation-link-click", {
            delayMs: 150,
            alwaysNotify: true,
        });

        scheduleNavigationCheck("conversation-link-click-followup", {
            delayMs: 600,
            alwaysNotify: true,
            clearLinkClickPending: true,
        });

        return;
    }

    if (isNewChatNavigationTrigger(target)) {
        markConversationLinkClickPending();

        scheduleNavigationCheck("new-chat-click", {
            delayMs: 150,
            alwaysNotify: true,
        });

        scheduleNavigationCheck("new-chat-click-followup", {
            delayMs: 600,
            alwaysNotify: true,
            clearLinkClickPending: true,
        });
    }
}

function handleHistoryNavigation(reason) {
    if (
        (reason === "pushState" || reason === "replaceState") &&
        hasPendingConversationLinkClick()
    ) {
        return;
    }

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

function isE2EChatFixtureRoute(pathname) {
    return /\/tests\/e2e\/fixtures\/chat\.html$/.test(pathname);
}

/**
 * Installs navigation detection for ChatGPT's SPA routing.
 *
 * We combine patched history methods, pop/hash listeners, and captured clicks
 * because no single signal reliably covers all sidebar, Recents, New Chat, and
 * conversation navigation paths.
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
    clearPendingConversationLinkClick();

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