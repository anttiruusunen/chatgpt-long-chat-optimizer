import { state } from "./state.js";
import { getSettings } from "./settings.js";
import {
    getConversationContainer,
    invalidateConversationDomCache,
} from "./dom.js";
import {
    removePlaceholder,
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
import { installConversationNavigationWatcher } from "./navigation.js";
import {
    configureConversationMaintenance,
    flushDeferredCssVisibilityWindowSync,
    scheduleConversationChromeSync,
    scheduleRefreshPostPruneState,
} from "./conversationMaintenance.js";
import {
    installDomMutationGuard,
    withDomMutationGuard,
} from "./domMutationGuard.js";
import { syncFeatureFlagsFromSettings } from "./featureFlags.js";
import {
    syncPruningStateToPageBridge,
    syncStoreReadOptimizationToPageWithRetry,
} from "./pageBridgeSync.js";
import { createPruneController } from "../pruning/pruneController.js";

installDomMutationGuard();

function resetConversationLifecycleForNavigation() {
    invalidateConversationDomCache();
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
    scheduleAutoPrune: (...args) => scheduleAutoPrune(...args),
    getDidInitialPrune: () => state.didInitialPrune,
    bootstrapInitialPrune: (...args) =>
        bootstrapInitialPruneFromObservedMutation(...args),
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

const pruneController = createPruneController({
    ensureObserverAttached,
    waitForContainerAndInitialPrune,
    withDomMutationGuard,
});

const {
    applySoftPrunedLimitToCurrentState,
    restoreAllSections,
    pruneOldSections,
    runInitialPrune,
    bootstrapInitialPruneFromObservedMutation,
    clearPendingAutoPrune,
    scheduleAutoPrune,
} = pruneController;

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
    syncPruningStateToPageBridge();

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
    syncPruningStateToPageBridge();

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