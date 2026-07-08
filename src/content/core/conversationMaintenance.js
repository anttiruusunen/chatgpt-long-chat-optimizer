import { state } from "./state.js";
import { getConversationSections } from "./dom.js";
import { debugLog } from "./logger.js";
import { ensureSectionCssOffscreenMode } from "../offscreen/offscreen.js";
import {
    registerUiPipelineTask,
    scheduleUiPipelineTask,
} from "./uiPipelineScheduler.js";

const CONVERSATION_MAINTENANCE_TASK = "conversation-maintenance";

let ensureObserverAttachedDependency = null;
let withDomMutationGuardDependency = null;

let isConversationMaintenanceScheduled = false;

let pendingConversationChromeSync = false;
let pendingPostPruneRefresh = false;

let pendingConversationChromeSyncForceCss = false;
let pendingConversationChromeSyncIncludeStreaming = false;
let pendingConversationChromeSyncReasons = new Set();

let pendingMaintenanceReasons = new Set();
let pendingPostPruneRefreshTimer = null;

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

function flushPostPruneState() {
    if (!isOffscreenRefreshEnabled()) {
        debugLog("Maintenance: skipped offscreen refresh because feature is disabled");
        return;
    }

    ensureSectionCssOffscreenMode("post-prune-refresh");

    debugLog("Maintenance: flushed post-prune offscreen root sync");
}

function collectConversationChromeSnapshot() {
    const visibleSections = getConversationSections();

    return {
        visibleSections,
        visibleSectionCount: visibleSections.length,
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
    if (isOffscreenRefreshEnabled()) {
        ensureSectionCssOffscreenMode("conversation-chrome-sync");
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

function flushConversationMaintenance() {
    isConversationMaintenanceScheduled = false;

    const shouldFlushChromeSync = pendingConversationChromeSync;
    const shouldFlushPostPruneRefresh = pendingPostPruneRefresh;
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

    pendingConversationChromeSync = false;
    pendingPostPruneRefresh = false;

    pendingConversationChromeSyncForceCss = false;
    pendingConversationChromeSyncIncludeStreaming = false;
    pendingConversationChromeSyncReasons.clear();

    pendingMaintenanceReasons.clear();

    ensureObserverAttachedDependency = null;
    withDomMutationGuardDependency = null;
}
