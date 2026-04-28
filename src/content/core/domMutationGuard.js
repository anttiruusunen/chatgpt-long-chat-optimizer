import { state } from "./state.js";
import { setDomWriteBatchExecutor } from "./domWriteBatch.js";

export function withDomMutationGuard(fn) {
    state.isApplyingDomChanges = true;
    try {
        return fn();
    } finally {
        queueMicrotask(() => {
            state.isApplyingDomChanges = false;
        });
    }
}

export function installDomMutationGuard() {
    setDomWriteBatchExecutor(withDomMutationGuard);
}