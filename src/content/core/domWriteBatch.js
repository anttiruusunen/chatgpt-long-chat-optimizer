let domWriteExecutor = (fn) => fn();
let pendingDomWrites = [];
let isDomWriteFlushScheduled = false;
let isDomWriteFlushing = false;

function flushDomWriteBatch() {
    if (pendingDomWrites.length === 0) {
        isDomWriteFlushScheduled = false;
        return 0;
    }

    const writes = pendingDomWrites;
    pendingDomWrites = [];
    isDomWriteFlushScheduled = false;
    isDomWriteFlushing = true;

    try {
        domWriteExecutor(() => {
            for (let i = 0; i < writes.length; i += 1) {
                writes[i]();
            }
        });
    } finally {
        isDomWriteFlushing = false;
    }

    if (pendingDomWrites.length > 0 && !isDomWriteFlushScheduled) {
        isDomWriteFlushScheduled = true;
        queueMicrotask(flushDomWriteBatch);
    }

    return writes.length;
}

export function setDomWriteBatchExecutor(executor) {
    domWriteExecutor = typeof executor === "function"
        ? executor
        : ((fn) => fn());
}

export function scheduleDomWriteBatch(writeFn) {
    if (typeof writeFn !== "function") {
        return;
    }

    pendingDomWrites.push(writeFn);

    if (isDomWriteFlushScheduled || isDomWriteFlushing) {
        return;
    }

    isDomWriteFlushScheduled = true;
    queueMicrotask(flushDomWriteBatch);
}

export function flushDomWriteBatchNow() {
    return flushDomWriteBatch();
}

export function getPendingDomWriteBatchCount() {
    return pendingDomWrites.length;
}

export function isDomWriteBatchScheduled() {
    return isDomWriteFlushScheduled;
}

export function resetDomWriteBatchForTests() {
    pendingDomWrites = [];
    isDomWriteFlushScheduled = false;
    isDomWriteFlushing = false;
    domWriteExecutor = (fn) => fn();
}