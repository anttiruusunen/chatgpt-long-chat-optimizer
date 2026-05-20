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
    resetVisibleMessagesReadyNotification,
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
let pendingDeferredInitialPrune = false;
let lastCompletedFreshNavigationLocationKey = null;

installDomMutationGuard();

function clearPendingNavigationPrune() {
    if (pendingNavigationPruneTimer) {
        clearTimeout(pendingNavigationPruneTimer);
        pendingNavigationPruneTimer = null;
    }
}

function containerHasConversationTurns(container) {
    if (!(container instanceof Element)) {
        return false;
    }

    return Boolean(
        container.querySelector(
            'section[data-turn], section[data-testid^="conversation-turn-"], [data-turn-id-container]'
        )
    );
}

function normalizeLocationPath(locationKey = null) {
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

function isNewChatNavigationReason(reason) {
    return reason === "new-chat-click" || reason === "new-chat-click-followup";
}

function isImmediateNewChatNavigationReason(reason) {
    return reason === "new-chat-click";
}

function isNewChatLocationKey(locationKey = null) {
    const path = normalizeLocationPath(locationKey);
    return path === "/" || path.startsWith("/?");
}

function isLinkNavigationReason(reason) {
    return (
        reason === "conversation-link-click" ||
        reason === "conversation-link-click-followup" ||
        reason === "sidebar-click" ||
        isNewChatNavigationReason(reason)
    );
}

function hasExplicitLocationKey(locationKey) {
    return typeof locationKey === "string" && locationKey.trim().length > 0;
}

function isEmptyChatNavigation(reason, locationKey = null) {
    return (
        isImmediateNewChatNavigationReason(reason) ||
        (hasExplicitLocationKey(locationKey) && isNewChatLocationKey(locationKey))
    );
}

function shouldRequireConversationTurnsForInitialPrune(locationKey = null) {
    return !isNewChatLocationKey(locationKey);
}

function shouldShowInitialPrunePendingOverlay() {
    return (
        state.settings.autoPrune &&
        state.featureFlags.pruning &&
        !state.didInitialPrune
    );
}

function syncStoreReadOptimizationForLifecycle() {
    syncStoreReadOptimizationToPageWithRetry();
}

function markStoreReadOptimizationReadyForPage(reason) {
    if (state.storeReadOptimizationReadyForPage) {
        return;
    }

    state.storeReadOptimizationReadyForPage = true;

    debugLog("Index: page store-read optimization ready", {
        reason,
    });

    syncStoreReadOptimizationForLifecycle();
}

function disableStoreReadOptimizationForPage(reason) {
    if (!state.storeReadOptimizationReadyForPage) {
        return;
    }

    state.storeReadOptimizationReadyForPage = false;

    debugLog("Index: page store-read optimization gated off", {
        reason,
    });

    syncStoreReadOptimizationForLifecycle();
}

function markEmptyChatReadyForPage(reason) {
    pendingDeferredInitialPrune = false;
    state.didInitialPrune = true;

    markStoreReadOptimizationReadyForPage(reason);

    debugLog("Index: empty chat lifecycle ready", {
        reason,
    });
}

function trackInitialPruneResult(result) {
    pendingDeferredInitialPrune = Boolean(result?.deferred);

    return result;
}

function runInitialPruneWithDeferredTracking(container, options = {}) {
    return runInitialPrune(container, {
        ...options,

        onPruneResult: (result) => {
            trackInitialPruneResult(result);
            options.onPruneResult?.(result);
        },

        onPruneFinished: (payload = {}) => {
            const result = payload.result;

            options.onPruneFinished?.(payload);

            if (result?.deferred) {
                return;
            }

            if (result?.posted && result?.requestId && !result?.completed) {
                return;
            }

            markStoreReadOptimizationReadyForPage(
                payload.reason || "initial-prune-finished"
            );
        },
    });
}

function runInitialPruneWhenReady(container, options = {}) {
    if (!containerHasConversationTurns(container)) {
        return false;
    }

    attachObserverToContainer(container);

    runInitialPruneWithDeferredTracking(container, {
        postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
        ...options,
    });

    return true;
}

function retryIncompleteInitialPruneAfterReplySettled() {
    if (!state.settings.autoPrune || !state.featureFlags.pruning) {
        return false;
    }

    if (state.didInitialPrune) {
        pendingDeferredInitialPrune = false;
        return false;
    }

    const container = getConversationContainer();
    const hasContainer = container instanceof Element;
    const hasTurns = containerHasConversationTurns(container);

    debugLog("Index: retrying incomplete initial prune after reply settled", {
        pendingDeferredInitialPrune,
        didInitialPrune: state.didInitialPrune,
        hasContainer,
        hasTurns,
    });

    pendingDeferredInitialPrune = false;

    if (hasContainer && hasTurns) {
        runInitialPruneWithDeferredTracking(container, {
            reason: "reply-settled-after-incomplete-initial-prune",
            postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
        });
    } else {
        waitForContainerAndInitialPrune({
            reason: "reply-settled-after-incomplete-initial-prune",
            postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
            requireConversationTurns: true,
        });
    }

    return true;
}

/**
 * Link/sidebar navigation can briefly leave the old conversation container in
 * the DOM, or mount a new empty container before real turns appear.
 *
 * Wait for a fresh container with actual conversation turns before running
 * initial prune. New/empty chat destinations are excluded because they may
 * legitimately never have turns.
 */
function waitForFreshContainerAndInitialPrune(previousContainer, options = {}) {
    const {
        navigationLocationKey = null,
        locationKey = navigationLocationKey,
        reason = "navigation",
        ...initialPruneOptions
    } = options;

    const generation = ++navigationPruneGeneration;
    const startedAt = performance.now();

    const MAX_WAIT_MS = 2500;
    const POLL_MS = 100;

    clearPendingNavigationPrune();

    if (
        shouldShowInitialPrunePendingOverlay() &&
        !isEmptyChatNavigation(reason, locationKey)
    ) {
        showInitialPrunePendingOverlay({
            reason: `${reason}:waiting-for-fresh-container`,
        });
    }

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
        const hasTurns = containerHasConversationTurns(container);
        const hasFreshContainer =
            container instanceof Element &&
            (noPreviousContainer || previousGone || containerChanged || timedOut);

        debugLog("Index: fresh-container prune poll", {
            reason,
            generation,
            activeGeneration: navigationPruneGeneration,
            hasContainer: container instanceof Element,
            hasTurns,
            previousGone,
            containerChanged,
            noPreviousContainer,
            timedOut,
            elapsedMs: Math.round(performance.now() - startedAt),
        });

        if (hasFreshContainer && hasTurns) {
            runInitialPruneWhenReady(container, {
                ...initialPruneOptions,
                reason,
            });

            lastCompletedFreshNavigationLocationKey = locationKey;
            pendingNavigationPruneTimer = null;
            return;
        }

        if (timedOut) {
            if (container instanceof Element) {
                attachObserverToContainer(container);
            }

            waitForContainerAndInitialPrune({
                ...initialPruneOptions,
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
                requireConversationTurns:
                    shouldRequireConversationTurnsForInitialPrune(locationKey),
                locationKey,
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
    clearPendingNavigationPrune();
    invalidateConversationDomCache();
    resetVisibleMessagesReadyNotification();
    clearPendingAutoPrune();

    pendingDeferredInitialPrune = false;
    disableStoreReadOptimizationForPage("navigation-reset");
    state.didInitialPrune = false;

    debugLog("Index: reset conversation lifecycle state for navigation");
}

function shouldSkipDuplicateLinkNavigationRearm(reason, locationKey) {
    if (!isLinkNavigationReason(reason)) {
        return false;
    }

    if (!state.didInitialPrune) {
        return false;
    }

    if (isEmptyChatNavigation(reason, locationKey)) {
        return false;
    }

    if (!locationKey) {
        return false;
    }

    if (locationKey !== lastCompletedFreshNavigationLocationKey) {
        return false;
    }

    return (
        state.observedContainer instanceof Element &&
        state.observedContainer.isConnected
    );
}

function rearmInitialPruneForNavigation(reason, locationKey = null) {
    debugLog("Index: navigation rearm requested", {
        reason,
        locationKey,
        hadObservedContainer: state.observedContainer instanceof Element,
        observedContainerConnected: state.observedContainer?.isConnected ?? null,
        currentContainer: getConversationContainer() instanceof Element,
        didInitialPrune: state.didInitialPrune,
    });

    if (shouldSkipDuplicateLinkNavigationRearm(reason, locationKey)) {
        debugLog("Index: skipped duplicate navigation rearm", {
            reason,
            locationKey,
        });

        return;
    }

    const previousContainer = state.observedContainer || getConversationContainer();

    resetConversationLifecycleForNavigation();

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (isEmptyChatNavigation(reason, locationKey)) {
            lastCompletedFreshNavigationLocationKey = null;

            debugLog("Index: completed empty chat navigation without initial prune", {
                reason,
                locationKey,
            });

            waitForContainerAndInitialPrune({
                locationKey,
                requireConversationTurns: false,
            });

            markEmptyChatReadyForPage("empty-chat-navigation");
            return;
        }

        if (isLinkNavigationReason(reason)) {
            debugLog("Index: rearming initial prune after navigation", {
                reason,
                locationKey,
                hasContainer: false,
                isLinkNavigation: true,
            });

            waitForFreshContainerAndInitialPrune(previousContainer, {
                reason,
                locationKey,
            });
            return;
        }
    }

    const hasContainer = ensureObserverAttached();
    const container = hasContainer ? getConversationContainer() : null;
    const hasTurns = containerHasConversationTurns(container);

    debugLog("Index: rearming initial prune after navigation", {
        reason,
        locationKey,
        hasContainer,
        hasTurns,
        isLinkNavigation: isLinkNavigationReason(reason),
    });

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (hasContainer && hasTurns) {
            runInitialPruneWithDeferredTracking(container, {
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
            });
        } else {
            waitForContainerAndInitialPrune({
                postPruneRefreshDelayMs: NAVIGATION_POST_PRUNE_REFRESH_DELAY_MS,
                requireConversationTurns:
                    shouldRequireConversationTurnsForInitialPrune(locationKey),
                locationKey,
            });
        }

        return;
    }

    if (!hasContainer) {
        waitForContainerAndInitialPrune({
            locationKey,
        });
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
    const {
        requireConversationTurns = false,
        locationKey = null,
        ...initialPruneOptions
    } = options;

    if (
        requireConversationTurns &&
        shouldShowInitialPrunePendingOverlay() &&
        !isNewChatLocationKey(locationKey)
    ) {
        showInitialPrunePendingOverlay({
            reason: initialPruneOptions.reason || "waiting-for-initial-prune",
        });
    }

    return waitForContainerAndInitialPruneBase({
        attachObserverToContainer,
        runInitialPrune: (container) =>
            runInitialPruneWithDeferredTracking(container, initialPruneOptions),
        requireConversationTurns,
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
    showInitialPrunePendingOverlay,
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
        onBeforeReplyStarted: () => {
            if (
                state.settings.autoPrune &&
                state.featureFlags.pruning &&
                state.didInitialPrune
            ) {
                pruneOldSections(state.settings.historyKeptExchanges, {
                    reason: "before-send",
                    showOverlay: false,
                    guardComposerCaret: false,
                });
            }
        },
        onReplyStarted: () => {
            handleReplyStreamingStarted();
        },
        onReplySettled: () => {
            retryIncompleteInitialPruneAfterReplySettled();

            scheduleConversationChromeSync({
                reason: "reply-settled",
                forceCss: true,
                includeStreaming: true,
            });
        },
    });

    installConversationNavigationWatcher({
        onNavigationDetected: ({ reason, locationKey }) => {
            rearmInitialPruneForNavigation(reason, locationKey);
        },
    });

    const hasContainer = ensureObserverAttached();
    const container = hasContainer ? getConversationContainer() : null;
    const hasTurns = containerHasConversationTurns(container);
    const initialLocationKey = normalizeLocationPath();

    debugLog("Index: initialize", {
        settings: state.settings,
        featureFlags: state.featureFlags,
        hasContainer,
        hasTurns,
        locationKey: initialLocationKey,
    });

    if (state.settings.autoPrune && state.featureFlags.pruning) {
        if (hasContainer && hasTurns) {
            runInitialPruneWithDeferredTracking(container);
        } else {
            const requireConversationTurns =
                shouldRequireConversationTurnsForInitialPrune(initialLocationKey);

            waitForContainerAndInitialPrune({
                requireConversationTurns,
                locationKey: initialLocationKey,
            });

            if (!requireConversationTurns) {
                markEmptyChatReadyForPage("empty-chat-initialize");
            }
        }
    } else if (!hasContainer) {
        waitForContainerAndInitialPrune({
            locationKey: initialLocationKey,
        });
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
            const locationKey = normalizeLocationPath();

            if (container && containerHasConversationTurns(container)) {
                runInitialPruneWithDeferredTracking(container);
            } else {
                const requireConversationTurns =
                    shouldRequireConversationTurnsForInitialPrune(locationKey);

                waitForContainerAndInitialPrune({
                    requireConversationTurns,
                    locationKey,
                });

                if (!requireConversationTurns) {
                    markEmptyChatReadyForPage("empty-chat-storage-changed");
                }
            }
        } else {
            scheduleAutoPrune(
                historyKeptChanged ? "history-kept-changed" : "storage-changed"
            );
        }
    } else {
        pendingDeferredInitialPrune = false;
        disableStoreReadOptimizationForPage("pruning-disabled");
        clearPendingAutoPrune();
        scheduleRefreshPostPruneState();
    }

    scheduleConversationChromeSync({
        reason: "storage-changed",
        forceCss: offscreenFlagChanged || historyKeptChanged,
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