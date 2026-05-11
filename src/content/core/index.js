import { state } from "./state.js";
import { getSettings } from "./settings.js";
import {
    getConversationContainer,
    invalidateConversationDomCache,
} from "./dom.js";
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
    ensureQolStyles,
    syncCodeBlockScrollbarStyles,
    syncUserMessageClampStyles,
} from "../ui/qolStyles.js";
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

const NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS = 500;

let pendingNavigationPruneTimer = null;
let navigationPruneGeneration = 0;

const REPLY_SETTLED_PRUNE_DELAY_MS = 3000;

let pendingReplySettledPruneTimer = null;

function clearPendingReplySettledPrune() {
    if (pendingReplySettledPruneTimer) {
        clearTimeout(pendingReplySettledPruneTimer);
        pendingReplySettledPruneTimer = null;
    }
}

function scheduleReplySettledPrune() {
    clearPendingReplySettledPrune();

    pendingReplySettledPruneTimer = setTimeout(() => {
        pendingReplySettledPruneTimer = null;

        if (state.settings.autoPrune && state.featureFlags.pruning) {
            scheduleAutoPrune("reply-settled-idle");
        }
    }, REPLY_SETTLED_PRUNE_DELAY_MS);
}

installDomMutationGuard();

function clearPendingNavigationPrune() {
    if (pendingNavigationPruneTimer) {
        clearTimeout(pendingNavigationPruneTimer);
        pendingNavigationPruneTimer = null;
    }
}

function isLinkNavigationReason(reason) {
    return (
        reason === "conversation-link-click" ||
        reason === "conversation-link-click-followup" ||
        reason === "sidebar-click"
    );
}

/**
 * Link/sidebar navigation can briefly leave the old conversation container in
 * the DOM while ChatGPT renders the new one. Wait for a fresh container before
 * running initial prune so we do not prune the previous thread by mistake.
 */
function waitForFreshContainerAndInitialPrune(previousContainer, options = {}) {
    const generation = ++navigationPruneGeneration;
    const startedAt = performance.now();

    const MAX_WAIT_MS = 2500;
    const POLL_MS = 100;

    clearPendingNavigationPrune();

    function attempt() {
        if (generation !== navigationPruneGeneration) {
            return;
        }

        invalidateConversationDomCache();

        const container = getConversationContainer();

        const previousGone =
            previousContainer instanceof Element && !previousContainer.isConnected;
        const containerChanged =
            container instanceof Element && container !== previousContainer;
        const noPreviousContainer = !(previousContainer instanceof Element);
        const timedOut = performance.now() - startedAt >= MAX_WAIT_MS;

        if (
            container &&
            (noPreviousContainer || previousGone || containerChanged || timedOut)
        ) {
            ensureObserverAttached();

            runInitialPrune(container, {
                useStartupMask: false,
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
                ...options,
            });

            pendingNavigationPruneTimer = null;
            return;
        }

        pendingNavigationPruneTimer = setTimeout(attempt, POLL_MS);
    }

    pendingNavigationPruneTimer = setTimeout(attempt, POLL_MS);
}

/**
 * Clears per-conversation lifecycle state before a new thread is initialized.
 */
function resetConversationLifecycleForNavigation() {
    clearPendingReplySettledPrune();
    clearPendingNavigationPrune();
    invalidateConversationDomCache();
    clearPendingAutoPrune();

    state.didInitialPrune = false;

    debugLog("Index: reset conversation lifecycle state for navigation");
}

function rearmInitialPruneForNavigation(reason) {
    const previousContainer = state.observedContainer || getConversationContainer();

    resetConversationLifecycleForNavigation();

    const hasContainer = ensureObserverAttached();

    debugLog("Index: rearming initial prune after navigation", {
        reason,
        hasContainer,
        isLinkNavigation: isLinkNavigationReason(reason),
    });

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (isLinkNavigationReason(reason)) {
            waitForFreshContainerAndInitialPrune(previousContainer, {
                useStartupMask: false,
            });
            return;
        }

        if (hasContainer) {
            runInitialPrune(getConversationContainer(), {
                useStartupMask: false,
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
            });
        } else {
            waitForContainerAndInitialPrune({
                useStartupMask: false,
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
            });
        }

        return;
    }

    if (!hasContainer) {
        waitForContainerAndInitialPrune();
        return;
    }

    scheduleConversationChromeSync({
        reason: "navigation-rearm-with-container",
        forceCss: true,
        includeStreaming: true,
    });
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

function waitForContainerAndInitialPrune(options = {}) {
    return waitForContainerAndInitialPruneBase({
        attachObserverToContainer,
        runInitialPrune: (container) => runInitialPrune(container, options),
    });
}

const pruneController = createPruneController({
    ensureObserverAttached,
    waitForContainerAndInitialPrune,
    withDomMutationGuard,
});

const {
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

/**
 * Main content-script bootstrap.
 *
 * Order matters:
 * 1. load settings and feature flags
 * 2. install UI/style/bridge integrations
 * 3. install lifecycle listeners
 * 4. attach observers and run the first prune/chrome sync
 */
async function initialize() {
    state.settings = await getSettings();
    state.debugLoggingEnabled = Boolean(state.settings.enableDebugLogging);

    syncFeatureFlagsFromSettings();

    ensureQolStyles();
    syncCodeBlockScrollbarStyles();
    syncUserMessageClampStyles();

    syncStoreReadOptimizationToPageWithRetry();
    syncPruningStateToPageBridge();

    installReplyTimingListeners({
        onReplyStarted: () => {
            clearPendingReplySettledPrune();
            handleReplyStreamingStarted();
        },
        onReplySettled: () => {
            flushDeferredCssVisibilityWindowSync("reply-settled");

            scheduleReplySettledPrune();

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
    } else if (!hasContainer) {
        waitForContainerAndInitialPrune();
    } else {
        scheduleRefreshPostPruneState();
    }

    scheduleConversationChromeSync({
        reason: "initialize",
        forceCss: true,
    });

    ensureReplyCompletionPoll();
}

/**
 * Reacts to popup/settings changes after startup.
 *
 * This mirrors the initialization path, but only refreshes the systems affected
 * by changed settings so toggles stay cheap.
 */
ext.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
        return;
    }

    let historyKeptChanged = false;
    let offscreenFlagChanged = false;
    let storeReadOptimizationFlagChanged = false;
    let userMessageClampChanged = false;

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
        state.settings.enableOffscreenOptimization = Boolean(
            changes.enableOffscreenOptimization.newValue
        );
        offscreenFlagChanged = true;
    }

    if (changes.enableDebugLogging) {
        state.settings.enableDebugLogging = Boolean(
            changes.enableDebugLogging.newValue
        );
        state.debugLoggingEnabled = state.settings.enableDebugLogging;
    }

    if (changes.enableStoreReadOptimization) {
        state.settings.enableStoreReadOptimization = Boolean(
            changes.enableStoreReadOptimization.newValue
        );
        storeReadOptimizationFlagChanged = true;
    }

    if (changes.enableCodeBlockScrollbars) {
        state.settings.enableCodeBlockScrollbars = Boolean(
            changes.enableCodeBlockScrollbars.newValue
        );
    }

    if (changes.enableUserMessageClamp) {
        state.settings.enableUserMessageClamp = Boolean(
            changes.enableUserMessageClamp.newValue
        );
        userMessageClampChanged = true;
    }

    syncFeatureFlagsFromSettings();

    if (changes.enableCodeBlockScrollbars) {
        syncCodeBlockScrollbarStyles();
    }

    if (userMessageClampChanged) {
        syncUserMessageClampStyles();
    }

    syncPruningStateToPageBridge();

    if (storeReadOptimizationFlagChanged || changes.enableDebugLogging) {
        syncStoreReadOptimizationToPageWithRetry();
    }

    debugLog("Index: storage changed", {
        changedKeys: Object.keys(changes),
        settings: state.settings,
        featureFlags: state.featureFlags,
    });

    if (offscreenFlagChanged) {
        setOffscreenOptimizationEnabled(state.featureFlags.offscreenOptimization);
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
            scheduleAutoPrune(
                historyKeptChanged ? "history-kept-changed" : "storage-changed"
            );
        }
    } else {
        clearPendingReplySettledPrune();
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
    scheduleAutoPrune,
    waitForContainerAndInitialPrune,
    refreshObservedSections: scheduleRefreshPostPruneState,
    setOffscreenOptimizationEnabled,
    syncFeatureFlagsFromSettings,
});

initialize();