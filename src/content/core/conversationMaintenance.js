import { state } from "./state.js";
import { getConversationSections } from "./dom.js";
import { debugLog } from "./logger.js";
import {
    ensurePlaceholderState,
    removePlaceholder,
} from "../pruning/pruneUi.js";
import {
    ensureTopRestoreSentinelState,
    ensureBottomPruneSentinelState,
} from "../pruning/pruneSentinels.js";
import {
    ensureSectionCssOffscreenMode,
    scheduleOffscreenRefresh,
} from "../offscreen/offscreen.js";
import { syncStreamingSectionState } from "../streaming/streamingSection.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    invalidateSentinelObserversForRootChange,
    refreshTopRestoreSentinelObservation,
    refreshBottomPruneSentinelObservation,
    disconnectSentinelObservers,
} from "../pruning/sentinelObservers.js";
import { syncCssVisibilityWindow } from "../pruning/cssVisibilityWindow.js";
import { scheduleDomWriteBatch } from "./domWriteBatch.js";

let ensureObserverAttachedDependency = null;
let withDomMutationGuardDependency = null;

let isPostPruneRefreshScheduled = false;
let isCssVisibilityWindowSyncDeferred = false;
let isConversationChromeSyncScheduled = false;
let pendingConversationChromeSyncForceCss = false;
let pendingConversationChromeSyncIncludeStreaming = false;
let pendingConversationChromeSyncReasons = new Set();

export function configureConversationMaintenance({
    ensureObserverAttached,
    withDomMutationGuard,
} = {}) {
    ensureObserverAttachedDependency =
        typeof ensureObserverAttached === "function"
            ? ensureObserverAttached
            : null;

    withDomMutationGuardDependency =
        typeof withDomMutationGuard === "function"
            ? withDomMutationGuard
            : null;
}

function getMaintenanceDeps() {
    return {
        ensureObserverAttached: ensureObserverAttachedDependency,
        withDomMutationGuard:
            withDomMutationGuardDependency ?? ((fn) => fn()),
        refreshObservedSections: scheduleRefreshPostPruneState,
    };
}

function requestCssVisibilityWindowSync({ force = false, reason = "unknown" } = {}) {
    if (force || !isReplyStreaming()) {
        isCssVisibilityWindowSyncDeferred = false;
        syncCssVisibilityWindow();

        debugLog("Maintenance: synced CSS visibility window", {
            force,
            reason,
        });
        return;
    }

    isCssVisibilityWindowSyncDeferred = true;

    debugLog("Maintenance: deferred CSS visibility window sync during active reply", {
        reason,
    });
}

export function flushDeferredCssVisibilityWindowSync(reason = "reply-settled") {
    if (isReplyStreaming()) {
        return;
    }

    if (!isCssVisibilityWindowSyncDeferred) {
        return;
    }

    isCssVisibilityWindowSyncDeferred = false;
    syncCssVisibilityWindow();

    debugLog("Maintenance: flushed deferred CSS visibility window sync", {
        reason,
    });
}

function flushPostPruneState() {
    if (isReplyStreaming()) {
        disconnectSentinelObservers();
        scheduleOffscreenRefresh();
        debugLog("Maintenance: flushed minimal streaming-mode refresh");
        return;
    }

    invalidateSentinelObserversForRootChange();
    scheduleOffscreenRefresh();

    const deps = getMaintenanceDeps();

    refreshTopRestoreSentinelObservation(deps);
    refreshBottomPruneSentinelObservation(deps);

    debugLog("Maintenance: flushed batched post-prune refresh");
}

export function scheduleRefreshPostPruneState() {
    if (isPostPruneRefreshScheduled) {
        debugLog("Maintenance: skipped duplicate post-prune refresh schedule");
        return;
    }

    isPostPruneRefreshScheduled = true;

    requestAnimationFrame(() => {
        isPostPruneRefreshScheduled = false;
        flushPostPruneState();
    });

    debugLog("Maintenance: scheduled batched post-prune refresh");
}

function flushConversationChromeSync() {
    isConversationChromeSyncScheduled = false;

    const forceCss = pendingConversationChromeSyncForceCss;
    const includeStreaming = pendingConversationChromeSyncIncludeStreaming;
    const reasons = Array.from(pendingConversationChromeSyncReasons);

    pendingConversationChromeSyncForceCss = false;
    pendingConversationChromeSyncIncludeStreaming = false;
    pendingConversationChromeSyncReasons.clear();

    const visibleSections = getConversationSections();
    const firstVisibleSection = visibleSections[0] ?? null;
    const lastVisibleSection = visibleSections[visibleSections.length - 1] ?? null;

    if (state.hiddenCount > 0 && firstVisibleSection) {
        ensurePlaceholderState(firstVisibleSection);
    } else {
        removePlaceholder();
    }

    ensureTopRestoreSentinelState(firstVisibleSection);
    ensureBottomPruneSentinelState(lastVisibleSection);

    if (includeStreaming && state.featureFlags.streamingSectionHiding) {
        syncStreamingSectionState();
    }

    requestCssVisibilityWindowSync({
        force: forceCss,
        reason: reasons.join(",") || "conversation-chrome-sync",
    });

    ensureSectionCssOffscreenMode();
    scheduleRefreshPostPruneState();

    debugLog("Maintenance: flushed conversation chrome sync batch", {
        reasons,
        visibleSections: visibleSections.length,
        hiddenCount: state.hiddenCount,
        forceCss,
        includeStreaming,
    });
}

export function scheduleConversationChromeSync({
    reason = "unknown",
    forceCss = false,
    includeStreaming = false,
} = {}) {
    pendingConversationChromeSyncReasons.add(reason);
    pendingConversationChromeSyncForceCss =
        pendingConversationChromeSyncForceCss || forceCss;
    pendingConversationChromeSyncIncludeStreaming =
        pendingConversationChromeSyncIncludeStreaming || includeStreaming;

    if (isConversationChromeSyncScheduled) {
        debugLog("Maintenance: coalesced conversation chrome sync request", {
            reason,
            forceCss,
            includeStreaming,
        });
        return;
    }

    isConversationChromeSyncScheduled = true;
    scheduleDomWriteBatch(flushConversationChromeSync);

    debugLog("Maintenance: scheduled conversation chrome sync batch", {
        reason,
        forceCss,
        includeStreaming,
    });
}

export function resetConversationMaintenanceForTests() {
    isPostPruneRefreshScheduled = false;
    isCssVisibilityWindowSyncDeferred = false;
    isConversationChromeSyncScheduled = false;
    pendingConversationChromeSyncForceCss = false;
    pendingConversationChromeSyncIncludeStreaming = false;
    pendingConversationChromeSyncReasons.clear();
    ensureObserverAttachedDependency = null;
    withDomMutationGuardDependency = null;
}