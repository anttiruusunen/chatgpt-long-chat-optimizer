import { state } from "../core/state.js";
import { getConversationContainer, isConversationSection } from "../core/dom.js";
import { debugLog } from "../core/logger.js";

function nodeIsOrContainsConversationSection(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    if (isConversationSection(node)) {
        return true;
    }

    return Boolean(
        Array.from(node.querySelectorAll("section")).find((section) =>
            isConversationSection(section)
        )
    );
}

function nodeLooksLikeTurnMount(node) {
    if (!(node instanceof Element)) {
        return false;
    }

    if (node.hasAttribute("data-turn-id-container")) {
        return true;
    }

    return nodeIsOrContainsConversationSection(node);
}

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
        if (mutation.type !== "childList") continue;

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

export function handleObservedMutations(
    mutations,
    {
        scheduleAutoPrune,
        getDidInitialPrune,
        bootstrapInitialPrune,
    }
) {
    if (state.isApplyingDomChanges) return;

    const container = state.observedContainer;
    let shouldConsiderPrune = false;

    for (const mutation of mutations) {
        if (mutationNeedsPrune(mutation, container)) {
            shouldConsiderPrune = true;
            break;
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

    if (!getDidInitialPrune()) {
        bootstrapInitialPrune?.();
        return;
    }

    scheduleAutoPrune();
}

export function disconnectObserver() {
    if (state.observer) {
        state.observer.disconnect();
    }
    state.observedContainer = null;
}

export function attachObserverToContainer(container, deps) {
    if (!container) return;

    if (!state.observer) {
        state.observer = new MutationObserver((mutations) =>
            handleObservedMutations(mutations, deps)
        );
    }

    if (state.observedContainer === container) {
        return;
    }

    disconnectObserver();

    state.observer.observe(container, {
        childList: true,
        subtree: false,
    });

    state.observedContainer = container;
    debugLog("[Thread Optimizer] Auto-prune observer attached to conversation container");
}

export function ensureObserverAttached(deps) {
    const container = getConversationContainer();
    if (!container) return false;

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

function tryAttachAndRun({ attachObserverToContainer, runInitialPrune }) {
    const container = getConversationContainer();
    if (!container) {
        return false;
    }

    clearInitWaiters();
    attachObserverToContainer(container);
    runInitialPrune(container);

    debugLog("Observers: found conversation container during deferred initialization");
    return true;
}

export function waitForContainerAndInitialPrune(
    { attachObserverToContainer, runInitialPrune }
) {
    if (tryAttachAndRun({ attachObserverToContainer, runInitialPrune })) {
        return;
    }

    if (!state.initObserver) {
        state.initObserver = new MutationObserver(() => {
            tryAttachAndRun({ attachObserverToContainer, runInitialPrune });
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

            if (tryAttachAndRun({ attachObserverToContainer, runInitialPrune })) {
                return;
            }

            if (pollAttempts >= MAX_POLL_ATTEMPTS) {
                clearInitWaiters();
                debugLog("Observers: stopped init polling without finding conversation container");
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