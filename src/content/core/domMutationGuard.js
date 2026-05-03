import { state } from "./state.js";
import { setDomWriteBatchExecutor } from "./domWriteBatch.js";
import { invalidateConversationDomCache } from "./dom.js";

/**
 * Wraps DOM mutations so the system can:
 * - suppress observer feedback loops
 * - invalidate cached DOM lookups safely
 *
 * The cache is invalidated:
 * 1. before mutations (prevent stale reads)
 * 2. after mutations (ensure fresh state)
 * 3. after microtask (cover async observer reactions)
 */
export function withDomMutationGuard(fn) {
    state.isApplyingDomChanges = true;

    // Prevent reads from using stale cached DOM before mutation
    invalidateConversationDomCache();

    try {
        return fn();
    } finally {
        // Ensure post-mutation reads are fresh
        invalidateConversationDomCache();

        // Release guard after observers/microtasks settle
        queueMicrotask(() => {
            state.isApplyingDomChanges = false;
            invalidateConversationDomCache();
        });
    }
}

/**
 * Installs the mutation guard into the DOM write batching layer.
 *
 * All batched DOM writes will be executed inside the guard,
 * ensuring consistent cache invalidation + observer safety.
 */
export function installDomMutationGuard() {
    setDomWriteBatchExecutor(withDomMutationGuard);
}