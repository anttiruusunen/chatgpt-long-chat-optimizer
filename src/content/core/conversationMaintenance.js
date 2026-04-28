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
import { isReplyStreaming } from "../streaming/replyTiming.js";
import {
    invalidateSentinelObserversForRootChange,
    refreshTopRestoreSentinelObservation,
    refreshBottomPruneSentinelObservation,
    disconnectSentinelObservers,
} from "../pruning/sentinelObservers.js";
import { syncCssVisibilityWindow } from "../pruning/cssVisibilityWindow.js";
import {
    registerUiPipelineTask,
    scheduleUiPipelineTask,
} from "./uiPipelineScheduler.js";

const CONVERSATION_MAINTENANCE_TASK = "conversation-maintenance";

let ensureObserverAttachedDependency = null;
let withDomMutationGuardDependency = null;

let isConversationMaintenanceScheduled = false;
let isCssVisibilityWindowSyncDeferred = false;

let pendingConversationChromeSync = false;
let pendingPostPruneRefresh = false;

let pendingConversationChromeSyncForceCss = false;
let pendingConversationChromeSyncIncludeStreaming = false;
let pendingConversationChromeSyncReasons = new Set();
let pendingMaintenanceReasons = new Set();

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

function scheduleConversationMaintenance(reason = "unknown") {
    pendingMaintenanceReasons.add(reason);

    if (isConversationMaintenanceScheduled) {
        debugLog("Maintenance: coalesced maintenance request", {
            reason,
        });
        return;
    }

    isConversationMaintenanceScheduled = true;
    scheduleUiPipelineTask(CONVERSATION_MAINTENANCE_TASK, reason);

    debugLog("Maintenance: scheduled maintenance batch", {
        reason,
    });
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

    scheduleOffscreenRefresh();

    if (typeof IntersectionObserver !== "function") {
        debugLog("Maintenance: skipped sentinel observer refresh because IntersectionObserver is unavailable");
        return;
    }

    invalidateSentinelObserversForRootChange();

    const deps = getMaintenanceDeps();

    refreshTopRestoreSentinelObservation(deps);
    refreshBottomPruneSentinelObservation(deps);

    debugLog("Maintenance: flushed batched post-prune refresh");
}

function collectConversationChromeSnapshot() {
    const visibleSections = getConversationSections();

    return {
        visibleSections,
        firstVisibleSection: visibleSections[0] ?? null,
        lastVisibleSection: visibleSections[visibleSections.length - 1] ?? null,
        visibleSectionCount: visibleSections.length,
        hiddenCount: state.hiddenCount,
    };
}

function applyConversationChromeSnapshot(
    snapshot,
    {
        forceCss = false,
        includeStreaming = false,
        reasons = [],
    } = {}
) {
    const {
        firstVisibleSection,
        lastVisibleSection,
        visibleSectionCount,
        hiddenCount,
    } = snapshot;

    if (hiddenCount > 0 && firstVisibleSection) {
        ensurePlaceholderState(firstVisibleSection);
    } else {
        removePlaceholder();
    }

    ensureTopRestoreSentinelState(firstVisibleSection);
    ensureBottomPruneSentinelState(lastVisibleSection);

    requestCssVisibilityWindowSync({
        force: forceCss,
        reason: reasons.join(",") || "conversation-chrome-sync",
    });

    ensureSectionCssOffscreenMode();

    debugLog("Maintenance: flushed conversation chrome sync batch", {
        reasons,
        visibleSections: visibleSectionCount,
        hiddenCount,
        forceCss,
        includeStreaming,
    });
}

function flushConversationChromeSync() {
    const forceCss = pendingConversationChromeSyncForceCss;
    const includeStreaming = pendingConversationChromeSyncIncludeStreaming;
    const reasons = Array.from(pendingConversationChromeSyncReasons);

    pendingConversationChromeSyncForceCss = false;
    pendingConversationChromeSyncIncludeStreaming = false;
    pendingConversationChromeSyncReasons.clear();

    const snapshot = collectConversationChromeSnapshot();

    applyConversationChromeSnapshot(snapshot, {
        forceCss,
        includeStreaming,
        reasons,
    });
}

function flushConversationMaintenance() {
    isConversationMaintenanceScheduled = false;

    const shouldFlushChromeSync = pendingConversationChromeSync;
    const shouldFlushPostPruneRefresh =
        pendingPostPruneRefresh || pendingConversationChromeSync;
    const reasons = Array.from(pendingMaintenanceReasons);

    pendingConversationChromeSync = false;
    pendingPostPruneRefresh = false;
    pendingMaintenanceReasons.clear();

    if (shouldFlushChromeSync) {
        flushConversationChromeSync();
    }

    if (shouldFlushPostPruneRefresh) {
        flushPostPruneState();
    }

    debugLog("Maintenance: flushed coalesced maintenance batch", {
        reasons,
        flushedChromeSync: shouldFlushChromeSync,
        flushedPostPruneRefresh: shouldFlushPostPruneRefresh,
    });
}

export function scheduleRefreshPostPruneState() {
    if (pendingPostPruneRefresh && isConversationMaintenanceScheduled) {
        debugLog("Maintenance: skipped duplicate post-prune refresh schedule");
        return;
    }

    pendingPostPruneRefresh = true;
    scheduleConversationMaintenance("post-prune-refresh");

    debugLog("Maintenance: scheduled post-prune refresh");
}

export function scheduleConversationChromeSync({
    reason = "unknown",
    forceCss = false,
    includeStreaming = false,
} = {}) {
    pendingConversationChromeSync = true;
    pendingConversationChromeSyncReasons.add(reason);
    pendingConversationChromeSyncForceCss =
        pendingConversationChromeSyncForceCss || forceCss;
    pendingConversationChromeSyncIncludeStreaming =
        pendingConversationChromeSyncIncludeStreaming || includeStreaming;

    scheduleConversationMaintenance(`conversation-chrome-sync:${reason}`);

    debugLog("Maintenance: scheduled conversation chrome sync", {
        reason,
        forceCss,
        includeStreaming,
    });
}

registerUiPipelineTask(CONVERSATION_MAINTENANCE_TASK, () => {
    flushConversationMaintenance();
});

export function resetConversationMaintenanceForTests() {
    isConversationMaintenanceScheduled = false;
    isCssVisibilityWindowSyncDeferred = false;
    pendingConversationChromeSync = false;
    pendingPostPruneRefresh = false;
    pendingConversationChromeSyncForceCss = false;
    pendingConversationChromeSyncIncludeStreaming = false;
    pendingConversationChromeSyncReasons.clear();
    pendingMaintenanceReasons.clear();
    ensureObserverAttachedDependency = null;
    withDomMutationGuardDependency = null;
}