import { state } from "../core/state.js";
import {
    getConversationContainer,
    isConversationSection,
    invalidateConversationDomCache,
} from "../core/dom.js";
import { notifyVisibleMessagesReadyForStoreBridge } from "../bridge/chatStoreBridgeClient.js";
import { debugLog } from "../core/logger.js";
import {
    optimizeAddedConversationNodes,
    refreshObservedSections as refreshOffscreenObservedSections,
} from "../offscreen/offscreen.js";

let visibleMessagesReadyPostedForContainer = null;

export function containerHasConversationTurns(container) {
    if (!(container instanceof Element)) {
        return false;
    }

    if (
        container.querySelector(
            'section[data-turn], section[data-testid^="conversation-turn-"], [data-turn-id-container]'
        )
    ) {
        return true;
    }

    for (const section of container.querySelectorAll("section")) {
        if (isConversationSection(section)) {
            return true;
        }
    }

    return false;
}

function maybeNotifyVisibleMessagesReady(container, reason = "unknown") {
    if (!container || visibleMessagesReadyPostedForContainer === container) {
        return;
    }

    const hasVisibleMessage = Boolean(
        container.querySelector(
            "[data-message-id], [data-message-author-role][data-message-id]"
        )
    );

    if (!hasVisibleMessage) {
        return;
    }

    visibleMessagesReadyPostedForContainer = container;

    notifyVisibleMessagesReadyForStoreBridge();

    debugLog("Observers: notified page bridge that visible messages are ready", {
        reason,
    });
}

function nodeIsOrContainsConversationSection(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    if (isConversationSection(node)) {
        return true;
    }

    for (const section of node.querySelectorAll("section")) {
        if (isConversationSection(section)) {
            return true;
        }
    }

    return false;
}

function nodeLooksLikeTurnMount(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    return (
        node.hasAttribute("data-turn-id-container") ||
        nodeIsOrContainsConversationSection(node)
    );
}

/**
 * Returns true only for direct child-list mutations on the observed
 * conversation container that add/remove conversation turn mounts.
 *
 * We observe the container with subtree:false, so this intentionally ignores
 * internal streaming edits inside the latest assistant message.
 */
export function mutationNeedsPrune(mutation, container) {
    if (mutation.type !== "childList") return false;
    if (!(container instanceof Element)) return false;
    if (mutation.target !== container) return false;

    for (const node of mutation.addedNodes) {
        if (nodeLooksLikeTurnMount(node)) {
            return true;
        }
    }

    for (const node of mutation.removedNodes) {
        if (nodeLooksLikeTurnMount(node)) {
            return true;
        }
    }

    return false;
}

function summarizeMutations(mutations, container) {
    let childListCount = 0;
    let addedNodeCount = 0;
    let removedNodeCount = 0;
    let directTurnAdds = 0;
    let directTurnRemovals = 0;
    let pruneRelevantMutations = 0;

    for (const mutation of mutations) {
        if (mutation.type !== "childList") {
            continue;
        }

        childListCount += 1;
        addedNodeCount += mutation.addedNodes.length;
        removedNodeCount += mutation.removedNodes.length;

        if (mutation.target === container) {
            for (const node of mutation.addedNodes) {
                if (nodeLooksLikeTurnMount(node)) {
                    directTurnAdds += 1;
                }
            }

            for (const node of mutation.removedNodes) {
                if (nodeLooksLikeTurnMount(node)) {
                    directTurnRemovals += 1;
                }
            }
        }

        if (mutationNeedsPrune(mutation, container)) {
            pruneRelevantMutations += 1;
        }
    }

    return {
        mutationCount: mutations.length,
        childListCount,
        addedNodeCount,
        removedNodeCount,
        directTurnAdds,
        directTurnRemovals,
        pruneRelevantMutations,
    };
}

/**
 * Main MutationObserver handler.
 *
 * Mutations caused by our own DOM writes are ignored via state.isApplyingDomChanges.
 * External ChatGPT mutations that add/remove turns either bootstrap the first
 * prune or schedule the normal auto-prune pass.
 */
export function handleObservedMutations(
    mutations,
    {
        scheduleAutoPrune,
        getDidInitialPrune,
        bootstrapInitialPrune,
    }
) {
    if (state.isApplyingDomChanges) {
        return;
    }

    const container = state.observedContainer;
    let shouldConsiderPrune = false;

    maybeNotifyVisibleMessagesReady(container, "mutation-batch");

    const shouldOptimizeAddedSections =
        state.featureFlags.offscreenOptimization === true;

    const shouldRunPruningObserverWork =
        state.featureFlags.pruning === true && state.settings.autoPrune === true;

    for (const mutation of mutations) {
        if (
            shouldOptimizeAddedSections &&
            mutation.type === "childList" &&
            mutation.target === container &&
            mutation.addedNodes?.length > 0
        ) {
            optimizeAddedConversationNodes(
                mutation.addedNodes,
                "observer-mutation-batch"
            );
        }

        if (
            shouldRunPruningObserverWork &&
            mutationNeedsPrune(mutation, container)
        ) {
            shouldConsiderPrune = true;
        }
    }

    if (state.debugLoggingEnabled) {
        const summary = summarizeMutations(mutations, container);

        debugLog("Observers: mutation batch", {
            ...summary,
            didInitialPrune: getDidInitialPrune(),
            shouldConsiderPrune,
        });

        if (shouldConsiderPrune) {
            debugLog("Observers: pruning-relevant mutation batch detected", {
                directTurnAdds: summary.directTurnAdds,
                directTurnRemovals: summary.directTurnRemovals,
                pruneRelevantMutations: summary.pruneRelevantMutations,
            });
        }
    }

    if (!shouldConsiderPrune) {
        return;
    }

    invalidateConversationDomCache();

    if (!getDidInitialPrune()) {
        bootstrapInitialPrune?.();
        return;
    }

    scheduleAutoPrune();
}

export function resetVisibleMessagesReadyNotification() {
    visibleMessagesReadyPostedForContainer = null;
}

export function disconnectObserver() {
    if (state.observer) {
        state.observer.disconnect();
    }

    state.observedContainer = null;
}

export function attachObserverToContainer(container, deps) {
    if (!container) {
        return;
    }

    if (!state.observer) {
        state.observer = new MutationObserver((mutations) =>
            handleObservedMutations(mutations, deps)
        );
    }

    if (state.observedContainer === container) {
        maybeNotifyVisibleMessagesReady(container, "observer-already-attached");
        return;
    }

    disconnectObserver();

    state.observer.observe(container, {
        childList: true,
        subtree: false,
    });

    state.observedContainer = container;
    visibleMessagesReadyPostedForContainer = null;

    maybeNotifyVisibleMessagesReady(container, "observer-attached");
    refreshOffscreenObservedSections();

    debugLog(
        "[Long Chat Optimizer] Auto-prune observer attached to conversation container"
    );
}

export function ensureObserverAttached(deps) {
    const container = getConversationContainer();
    if (!container) {
        return false;
    }

    attachObserverToContainer(container, deps);
    return true;
}

function clearInitWaiters() {
    if (state.initObserver) {
        state.initObserver.disconnect();
        state.initObserver = null;
    }

    if (state.initPollTimer) {
        clearInterval(state.initPollTimer);
        state.initPollTimer = null;
    }
}

function tryAttachAndRun({
    attachObserverToContainer,
    runInitialPrune,
    requireConversationTurns = false,
}) {
    const container = getConversationContainer();
    if (!container) {
        return false;
    }

    if (requireConversationTurns && !containerHasConversationTurns(container)) {
        debugLog(
            "Observers: found conversation container but waiting for conversation turns"
        );

        return false;
    }

    clearInitWaiters();
    attachObserverToContainer(container);
    runInitialPrune(container);

    debugLog("Observers: found conversation container during deferred initialization");

    return true;
}

/**
 * Waits for ChatGPT's conversation container to exist, then attaches the
 * observer and runs initial prune.
 *
 * When requireConversationTurns is true, an empty New Chat container does not
 * consume the initial-prune lifecycle. The first real turn mount will trigger
 * the deferred bootstrap instead.
 */
export function waitForContainerAndInitialPrune({
    attachObserverToContainer,
    runInitialPrune,
    requireConversationTurns = false,
}) {
    if (
        tryAttachAndRun({
            attachObserverToContainer,
            runInitialPrune,
            requireConversationTurns,
        })
    ) {
        return;
    }

    if (!state.initObserver) {
        state.initObserver = new MutationObserver(() => {
            tryAttachAndRun({
                attachObserverToContainer,
                runInitialPrune,
                requireConversationTurns,
            });
        });

        state.initObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });

        debugLog("Observers: installed init mutation observer");
    }

    if (!state.initPollTimer) {
        let pollAttempts = 0;
        const MAX_POLL_ATTEMPTS = 200;

        state.initPollTimer = setInterval(() => {
            pollAttempts += 1;

            if (
                tryAttachAndRun({
                    attachObserverToContainer,
                    runInitialPrune,
                    requireConversationTurns,
                })
            ) {
                return;
            }

            if (pollAttempts >= MAX_POLL_ATTEMPTS) {
                clearInitWaiters();

                debugLog(
                    "Observers: stopped init polling without finding ready conversation container"
                );
            }
        }, 250);

        debugLog("Observers: installed init polling fallback");
    }
}

export function createObserverDeps({
    scheduleAutoPrune,
    getDidInitialPrune,
    bootstrapInitialPrune,
}) {
    return {
        scheduleAutoPrune,
        getDidInitialPrune,
        bootstrapInitialPrune,
    };
}
