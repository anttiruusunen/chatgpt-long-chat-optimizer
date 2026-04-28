import { state } from "./state.js";
import { getSettings } from "./settings.js";
import {
    getConversationContainer,
} from "./dom.js";
import {
    pruneOldSections as pruneOldSectionsBase,
    restoreAllSections as restoreAllSectionsBase,
    runInitialPrune as runInitialPruneBase,
    enforceSoftPrunedLimit,
} from "../pruning/prune.js";
import {
    removePlaceholder,
    installStartupPruneMask,
    removeStartupPruneMask,
} from "../pruning/pruneUi.js";
import {
    handleReplyStreamingStarted,
    setOffscreenOptimizationEnabled,
} from "../offscreen/offscreen.js";
import {
    attachObserverToContainer as attachObserverToContainerBase,
    ensureObserverAttached as ensureObserverAttachedBase,
    waitForContainerAndInitialPrune as waitForContainerAndInitialPruneBase,
    createObserverDeps,
} from "../observers/observers.js";
import { registerRuntimeMessageHandlers } from "./messages.js";
import { debugLog } from "./logger.js";
import { ext } from "../../shared/ext.js";
import {
    installReplyTimingListeners,
    ensureReplyCompletionPoll,
} from "../streaming/replyTiming.js";
import {
    disconnectSentinelObservers,
} from "../pruning/sentinelObservers.js";
import { ensureQolStyles } from "../ui/qolStyles.js";
import {
    clearCssVisibilityWindow,
} from "../pruning/cssVisibilityWindow.js";
import { installConversationNavigationWatcher } from "./navigation.js";
import {
    setDomWriteBatchExecutor,
} from "./domWriteBatch.js";
import {
    configureConversationMaintenance,
    flushDeferredCssVisibilityWindowSync,
    scheduleConversationChromeSync,
    scheduleRefreshPostPruneState,
} from "./conversationMaintenance.js";

let isBootstrapInitialPruneScheduled = false;

function withDomMutationGuard(fn) {
    state.isApplyingDomChanges = true;
    try {
        return fn();
    } finally {
        queueMicrotask(() => {
            state.isApplyingDomChanges = false;
        });
    }
}

setDomWriteBatchExecutor(withDomMutationGuard);

function syncFeatureFlagsFromSettings() {
    state.featureFlags.pruning = Boolean(state.settings.enablePruning);
    state.featureFlags.offscreenOptimization = Boolean(state.settings.enableOffscreenOptimization);
    state.featureFlags.largeCodeBlockOptimization = Boolean(state.settings.enableLargeCodeBlockOptimization);
    state.featureFlags.storeReadOptimization = Boolean(state.settings.enableStoreReadOptimization);
}

function applySoftPrunedLimitToCurrentState() {
    withDomMutationGuard(() => {
        enforceSoftPrunedLimit();

        debugLog("Index: applied soft-pruned limit counts", {
            totalHiddenCount: state.hiddenCount,
            softPrunedSections: state.softPrunedSections.length,
            hardEvictedCount: state.hardEvictedCount,
            historyKeptExchanges: state.settings.historyKeptExchanges,
        });
    });

    scheduleConversationChromeSync({
        reason: "apply-soft-pruned-limit",
        includeStreaming: true,
    });
}

function restoreAllSections() {
    clearCssVisibilityWindow();

    const result = restoreAllSectionsBase({
        ensureObserverAttached,
        withDomMutationGuard,
        refreshObservedSections: scheduleRefreshPostPruneState,
    });

    scheduleConversationChromeSync({
        reason: "restore-all-sections",
        includeStreaming: true,
    });

    return result;
}

function pruneOldSections(historyKeptExchanges = state.settings.historyKeptExchanges, options = {}) {
    clearCssVisibilityWindow();

    const result = pruneOldSectionsBase(historyKeptExchanges, options, {
        ensureObserverAttached,
        withDomMutationGuard,
        refreshObservedSections: scheduleRefreshPostPruneState,
    });

    scheduleConversationChromeSync({
        reason: "prune-old-sections",
        includeStreaming: true,
    });

    return result;
}

function getStartupMaskVisibleSectionsLimit() {
    const safeExchanges = Math.max(1, Number(state.settings.historyKeptExchanges) || 1);
    return safeExchanges * 2;
}

function runInitialPrune(container) {
    return runInitialPruneBase(container, {
        pruneOldSections,
        refreshObservedSections: scheduleRefreshPostPruneState,
        installStartupPruneMask: () => {
            installStartupPruneMask(container, getStartupMaskVisibleSectionsLimit());
        },
        removeStartupPruneMask,
    });
}

function bootstrapInitialPruneFromObservedMutation() {
    if (isBootstrapInitialPruneScheduled) {
        return;
    }

    if (!state.featureFlags.pruning || !state.settings.autoPrune || state.didInitialPrune) {
        return;
    }

    isBootstrapInitialPruneScheduled = true;

    requestAnimationFrame(() => {
        isBootstrapInitialPruneScheduled = false;

        if (!state.featureFlags.pruning || !state.settings.autoPrune || state.didInitialPrune) {
            return;
        }

        const container = getConversationContainer();
        if (!container) {
            waitForContainerAndInitialPrune();
            return;
        }

        debugLog("Index: bootstrapping initial prune from observed mutation");
        runInitialPrune(container);
    });
}

function clearPendingAutoPrune() {
    if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
    }

    clearCssVisibilityWindow();
    state.isAutoPruneScheduled = false;
}

function scheduleAutoPrune() {
    if (!state.featureFlags.pruning) return;
    if (!state.settings.autoPrune) return;
    if (!state.didInitialPrune) return;
    if (state.isApplyingDomChanges) return;

    if (state.isAutoPruneScheduled) {
        debugLog("Index: skipped duplicate auto-prune schedule");
        return;
    }

    state.isAutoPruneScheduled = true;
    scheduleConversationChromeSync({
        reason: "schedule-auto-prune",
    });

    state.debounceTimer = setTimeout(() => {
        try {
            if (!state.featureFlags.pruning || !state.settings.autoPrune) {
                debugLog("Index: skipped auto-prune because feature is disabled");
                return;
            }

            if (state.isApplyingDomChanges) {
                debugLog("Index: skipped auto-prune because DOM guard is active");
                return;
            }

            pruneOldSections(state.settings.historyKeptExchanges, { showPlaceholder: true });
        } finally {
            state.isAutoPruneScheduled = false;
            state.debounceTimer = null;
            scheduleConversationChromeSync({
                reason: "auto-prune-finally",
            });
        }
    }, 300);

    debugLog("Index: scheduled auto-prune", {
        historyKeptExchanges: state.settings.historyKeptExchanges,
    });
}

function resetConversationLifecycleForNavigation() {
    clearPendingAutoPrune();

    removePlaceholder();
    state.placeholder = null;

    state.softPrunedSections = [];
    state.hiddenCount = 0;
    state.totalHiddenCount = 0;
    state.hardEvictedCount = 0;
    state.didInitialPrune = false;

    if (state.topRestoreSentinel?.isConnected) {
        state.topRestoreSentinel.remove();
    }
    if (state.bottomPruneSentinel?.isConnected) {
        state.bottomPruneSentinel.remove();
    }

    state.topRestoreSentinel = null;
    state.bottomPruneSentinel = null;
    state.isTopRestoreScheduled = false;
    state.isBottomPruneScheduled = false;
    state.isTopRestoreArmed = true;
    state.isBottomPruneArmed = true;

    disconnectSentinelObservers();
    debugLog("Index: reset conversation lifecycle state for navigation");
}

function rearmInitialPruneForNavigation(reason) {
    resetConversationLifecycleForNavigation();

    const hasContainer = ensureObserverAttached();

    debugLog("Index: rearming initial prune after navigation", {
        reason,
        hasContainer,
    });

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (hasContainer) {
            runInitialPrune(getConversationContainer());
        } else {
            waitForContainerAndInitialPrune();
        }
        return;
    }

    if (!hasContainer) {
        waitForContainerAndInitialPrune();
    } else {
        scheduleConversationChromeSync({
            reason: "navigation-rearm-with-container",
            forceCss: true,
            includeStreaming: true,
        });
    }
}

const observerDeps = createObserverDeps({
    scheduleAutoPrune,
    getDidInitialPrune: () => state.didInitialPrune,
    bootstrapInitialPrune: bootstrapInitialPruneFromObservedMutation,
});

function attachObserverToContainer(container) {
    return attachObserverToContainerBase(container, observerDeps);
}

function ensureObserverAttached() {
    return ensureObserverAttachedBase(observerDeps);
}

function waitForContainerAndInitialPrune() {
    return waitForContainerAndInitialPruneBase({
        attachObserverToContainer,
        runInitialPrune,
    });
}

configureConversationMaintenance({
    ensureObserverAttached,
    withDomMutationGuard,
});

async function initialize() {
    state.settings = await getSettings();
    state.debugLoggingEnabled = Boolean(state.settings.enableDebugLogging);
    syncFeatureFlagsFromSettings();
    ensureQolStyles();
    syncStoreReadOptimizationToPageWithRetry();

    installReplyTimingListeners({
        onReplyStarted: () => {
            handleReplyStreamingStarted();
        },
        onReplySettled: () => {
            flushDeferredCssVisibilityWindowSync("reply-settled");
            scheduleConversationChromeSync({
                reason: "reply-settled",
                forceCss: true,
                includeStreaming: true,
            });
        },
    });

    installConversationNavigationWatcher({
        onNavigationDetected: ({ reason }) => {
            rearmInitialPruneForNavigation(reason);
        },
    });

    const hasContainer = ensureObserverAttached();

    debugLog("Index: initialize", {
        settings: state.settings,
        featureFlags: state.featureFlags,
        hasContainer,
    });

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (hasContainer) {
            runInitialPrune(getConversationContainer());
        } else {
            waitForContainerAndInitialPrune();
        }
    } else {
        if (!hasContainer) {
            waitForContainerAndInitialPrune();
        } else {
            scheduleRefreshPostPruneState();
        }
    }

    scheduleConversationChromeSync({
        reason: "initialize",
        forceCss: true,
    });
    ensureReplyCompletionPoll();
}

ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;

    let historyKeptChanged = false;
    let offscreenFlagChanged = false;
    let largeCodeBlockFlagChanged = false;
    let storeReadOptimizationFlagChanged = false;

    if (changes.historyKeptExchanges) {
        state.settings.historyKeptExchanges = changes.historyKeptExchanges.newValue;
        historyKeptChanged = true;
    }

    if (changes.autoPrune) {
        state.settings.autoPrune = Boolean(changes.autoPrune.newValue);
    }

    if (changes.enablePruning) {
        state.settings.enablePruning = Boolean(changes.enablePruning.newValue);
    }

    if (changes.enableOffscreenOptimization) {
        state.settings.enableOffscreenOptimization = Boolean(changes.enableOffscreenOptimization.newValue);
        offscreenFlagChanged = true;
    }

    if (changes.enableLargeCodeBlockOptimization) {
        state.settings.enableLargeCodeBlockOptimization = Boolean(changes.enableLargeCodeBlockOptimization.newValue);
        largeCodeBlockFlagChanged = true;
    }

    if (changes.enableDebugLogging) {
        state.settings.enableDebugLogging = Boolean(changes.enableDebugLogging.newValue);
        state.debugLoggingEnabled = state.settings.enableDebugLogging;
    }

    if (changes.enableStoreReadOptimization) {
        state.settings.enableStoreReadOptimization = Boolean(changes.enableStoreReadOptimization.newValue);
        storeReadOptimizationFlagChanged = true;
    }

    syncFeatureFlagsFromSettings();

    if (storeReadOptimizationFlagChanged || changes.enableDebugLogging) {
        syncStoreReadOptimizationToPageWithRetry();
    }

    debugLog("Index: storage changed", {
        changedKeys: Object.keys(changes),
        settings: state.settings,
        featureFlags: state.featureFlags,
    });

    if (historyKeptChanged) {
        applySoftPrunedLimitToCurrentState();
    }

    if (offscreenFlagChanged) {
        setOffscreenOptimizationEnabled(state.featureFlags.offscreenOptimization);
    } else if (
        largeCodeBlockFlagChanged &&
        state.featureFlags.offscreenOptimization
    ) {
        scheduleRefreshPostPruneState();
    }

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (!state.didInitialPrune) {
            const container = getConversationContainer();
            if (container) {
                runInitialPrune(container);
            } else {
                waitForContainerAndInitialPrune();
            }
        } else {
            scheduleAutoPrune();
        }
    } else {
        clearPendingAutoPrune();
        scheduleRefreshPostPruneState();
    }

    scheduleConversationChromeSync({
        reason: "storage-changed",
        includeStreaming: true,
    });
});

function syncStoreReadOptimizationToPageWithRetry(retries = 10) {
    if (typeof window === "undefined") {
        return;
    }

    const bridge = window.__threadOptimizerChatStoreBridge;

    if (bridge?.__installed) {
        window.postMessage(
            {
                source: "thread-optimizer",
                type: "thread-optimizer:set-store-read-optimization",
                enabled: state.featureFlags.storeReadOptimization,
                debug: state.debugLoggingEnabled,
            },
            window.location.origin
        );
        return;
    }

    if (retries > 0) {
        setTimeout(() => {
            syncStoreReadOptimizationToPageWithRetry(retries - 1);
        }, 200);
    }
}

registerRuntimeMessageHandlers({
    pruneOldSections,
    restoreAllSections,
    scheduleAutoPrune,
    waitForContainerAndInitialPrune,
    refreshObservedSections: scheduleRefreshPostPruneState,
    applySoftPrunedLimitToCurrentState,
    setOffscreenOptimizationEnabled,
    syncFeatureFlagsFromSettings,
});

initialize();