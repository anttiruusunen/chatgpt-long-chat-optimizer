import { state } from "./state.js";
import { getConversationSections } from "./dom.js";
import { debugLog } from "./logger.js";
import {
    ensureSectionCssOffscreenMode,
    scheduleOffscreenRefresh,
} from "../offscreen/offscreen.js";
import { isReplyStreaming } from "../streaming/replyTiming.js";
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
let pendingPostPruneRefreshTimer = null;

/**
 * Injects lifecycle dependencies from the top-level controller.
 *
 * This module owns scheduling/coalescing, while index.js owns the concrete
 * observer and DOM mutation guard implementations.
 */
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

function isOffscreenRefreshEnabled() {
    return Boolean(state.featureFlags.offscreenOptimization);
}

function getMaintenanceDeps() {
    return {
        ensureObserverAttached: ensureObserverAttachedDependency,
        withDomMutationGuard:
            withDomMutationGuardDependency ?? ((fn) => fn()),
        refreshObservedSections: scheduleRefreshPostPruneState,
    };
}

/**
 * Coalesces all conversation-maintenance work into the shared UI pipeline.
 *
 * Pruning, CSS visibility syncs, and offscreen refreshes can all be requested
 * by different subsystems in the same tick. Running them as one batch avoids
 * unnecessary DOM churn.
 */
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

/**
 * CSS visibility changes are deferred during streaming unless forced.
 *
 * The active assistant message can still be changing shape while ChatGPT is
 * streaming. Deferring non-forced syncs avoids hiding or reclassifying the
 * live turn mid-response.
 */
function requestCssVisibilityWindowSync({
    force = false,
    reason = "unknown",
} = {}) {
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
    if (isReplyStreaming() || !isCssVisibilityWindowSyncDeferred) {
        return;
    }

    isCssVisibilityWindowSyncDeferred = false;
    syncCssVisibilityWindow();

    debugLog("Maintenance: flushed deferred CSS visibility window sync", {
        reason,
    });
}

/**
 * Refreshes secondary rendering state after visible sections change.
 */
function flushPostPruneState() {
    if (!isOffscreenRefreshEnabled()) {
        debugLog("Maintenance: skipped offscreen refresh because feature is disabled");
        return;
    }

    scheduleOffscreenRefresh();

    debugLog("Maintenance: flushed post-prune offscreen refresh");
}

function collectConversationChromeSnapshot() {
    const visibleSections = getConversationSections();

    return {
        visibleSections,
        visibleSectionCount: visibleSections.length,
    };
}

/**
 * Applies rendering helpers around the current visible conversation window.
 *
 * This no longer manages hidden-count placeholders, restore sentinels, prune
 * sentinels, or DOM-side soft pruning. Store-native pruning owns history now.
 */
function applyConversationChromeSnapshot(
    snapshot,
    {
        forceCss = false,
        includeStreaming = false,
        reasons = [],
    } = {}
) {
    requestCssVisibilityWindowSync({
        force: forceCss,
        reason: reasons.join(",") || "conversation-chrome-sync",
    });

    if (isOffscreenRefreshEnabled()) {
        ensureSectionCssOffscreenMode();
    }

    debugLog("Maintenance: flushed conversation chrome sync batch", {
        reasons,
        visibleSections: snapshot.visibleSectionCount,
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

/**
 * Runs the coalesced maintenance batch.
 */
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

export function scheduleRefreshPostPruneState({
    delayMs = 0,
    reason = "post-prune-refresh",
} = {}) {
    if (delayMs > 0) {
        if (pendingPostPruneRefreshTimer) {
            clearTimeout(pendingPostPruneRefreshTimer);
        }

        pendingPostPruneRefreshTimer = setTimeout(() => {
            pendingPostPruneRefreshTimer = null;
            scheduleRefreshPostPruneState({ reason });
        }, delayMs);

        debugLog("Maintenance: delayed post-prune refresh", {
            reason,
            delayMs,
        });

        return;
    }

    if (pendingPostPruneRefreshTimer) {
        clearTimeout(pendingPostPruneRefreshTimer);
        pendingPostPruneRefreshTimer = null;
    }

    if (pendingPostPruneRefresh && isConversationMaintenanceScheduled) {
        debugLog("Maintenance: skipped duplicate post-prune refresh schedule");
        return;
    }

    pendingPostPruneRefresh = true;
    scheduleConversationMaintenance(reason);

    debugLog("Maintenance: scheduled post-prune refresh", {
        reason,
    });
}

/**
 * Schedules updates for the UI around the visible conversation window.
 *
 * `forceCss` is used after events like startup/navigation/reply-settled where
 * the CSS visibility window must be corrected immediately.
 */
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
    if (pendingPostPruneRefreshTimer) {
        clearTimeout(pendingPostPruneRefreshTimer);
        pendingPostPruneRefreshTimer = null;
    }

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