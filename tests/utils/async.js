import { vi } from "vitest";

export async function flushAsyncWork({ maxPasses = 10 } = {}) {
    for (let i = 0; i < maxPasses; i += 1) {
        await Promise.resolve();

        if (vi.getTimerCount() > 0) {
            vi.runOnlyPendingTimers();
        }

        await Promise.resolve();
    }
}