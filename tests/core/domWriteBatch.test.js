import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    setDomWriteBatchExecutor,
    scheduleDomWriteBatch,
    flushDomWriteBatchNow,
    getPendingDomWriteBatchCount,
    isDomWriteBatchScheduled,
    resetDomWriteBatchForTests,
} from "../../src/content/core/domWriteBatch.js";

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

describe("domWriteBatch", () => {
    beforeEach(() => {
        resetDomWriteBatchForTests();
    });

    afterEach(() => {
        resetDomWriteBatchForTests();
    });

    it("queues writes and flushes them in order on a microtask", async () => {
        const calls = [];

        scheduleDomWriteBatch(() => {
            calls.push("first");
        });
        scheduleDomWriteBatch(() => {
            calls.push("second");
        });

        expect(getPendingDomWriteBatchCount()).toBe(2);
        expect(isDomWriteBatchScheduled()).toBe(true);

        await flushMicrotasks();

        expect(calls).toEqual(["first", "second"]);
        expect(getPendingDomWriteBatchCount()).toBe(0);
        expect(isDomWriteBatchScheduled()).toBe(false);
    });

    it("uses the configured executor for the whole flush", async () => {
        const executor = vi.fn((fn) => fn());
        const calls = [];

        setDomWriteBatchExecutor(executor);

        scheduleDomWriteBatch(() => {
            calls.push("one");
        });
        scheduleDomWriteBatch(() => {
            calls.push("two");
        });

        await flushMicrotasks();

        expect(executor).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(["one", "two"]);
    });

    it("supports immediate flushing", () => {
        const calls = [];

        scheduleDomWriteBatch(() => {
            calls.push("now");
        });

        const flushedCount = flushDomWriteBatchNow();

        expect(flushedCount).toBe(1);
        expect(calls).toEqual(["now"]);
        expect(getPendingDomWriteBatchCount()).toBe(0);
    });

    it("schedules a second microtask flush if writes are queued during a flush", async () => {
        const calls = [];

        scheduleDomWriteBatch(() => {
            calls.push("outer");
            scheduleDomWriteBatch(() => {
                calls.push("inner");
            });
        });

        await flushMicrotasks();

        expect(calls).toEqual(["outer", "inner"]);
        expect(getPendingDomWriteBatchCount()).toBe(0);
        expect(isDomWriteBatchScheduled()).toBe(false);
    });

    it("ignores non-function writes", async () => {
        scheduleDomWriteBatch(null);
        scheduleDomWriteBatch(undefined);
        scheduleDomWriteBatch("nope");

        expect(getPendingDomWriteBatchCount()).toBe(0);
        await flushMicrotasks();
        expect(isDomWriteBatchScheduled()).toBe(false);
    });
});