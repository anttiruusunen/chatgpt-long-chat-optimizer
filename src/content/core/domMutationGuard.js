import { state } from "./state.js";
import { setDomWriteBatchExecutor } from "./domWriteBatch.js";
import { invalidateConversationDomCache } from "./dom.js";

export function withDomMutationGuard(fn) {
    state.isApplyingDomChanges = true;
    invalidateConversationDomCache();

    try {
        return fn();
    } finally {
        invalidateConversationDomCache();

        queueMicrotask(() => {
            state.isApplyingDomChanges = false;
            invalidateConversationDomCache();
        });
    }
}

export function installDomMutationGuard() {
    setDomWriteBatchExecutor(withDomMutationGuard);
}