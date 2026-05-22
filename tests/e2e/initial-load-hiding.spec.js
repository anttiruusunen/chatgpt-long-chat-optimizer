import { test, expect } from "@playwright/test";
import {
    createConversationPayload,
    getInitialLoadHidingState,
    loadInitialLoadHidingFixture,
    postRuntimeInitialLoadHidingSettings,
} from "./helpers/initialLoadHidingDriver.js";

test("initial-load hiding trims conversation JSON before the fixture app receives it", async ({ page }) => {
    const payload = createConversationPayload({
        exchangeCount: 10,
    });

    const { fixtureResult, initialLoadHidingState, originalNodeCount } =
        await loadInitialLoadHidingFixture(page, {
            settings: {
                enablePruning: true,
                historyKeptExchanges: 2,
                enableDebugLogging: false,
            },
            payload,
        });

    expect(fixtureResult.error).toBeNull();
    expect(fixtureResult.receivedNodeCount).toBeLessThan(originalNodeCount);
    expect(fixtureResult.receivedNodeCount).toBe(5);

    expect(initialLoadHidingState).toMatchObject({
        installed: true,
        enabled: true,
        settingsReady: true,
        historyKeptExchanges: 2,
    });

    expect(initialLoadHidingState.stats).toMatchObject({
        intercepted: 1,
        trimmed: 1,
        skipped: 0,
        settingsWaitTimedOut: 0,
        lastReason: "trimmed",
        lastOriginalNodeCount: originalNodeCount,
        lastTrimmedNodeCount: 5,
        lastDeletedNodeCount: originalNodeCount - 5,
    });
});

test("initial-load hiding respects disabled pruning and returns the full JSON", async ({ page }) => {
    const payload = createConversationPayload({
        exchangeCount: 10,
    });

    const { fixtureResult, initialLoadHidingState, originalNodeCount } =
        await loadInitialLoadHidingFixture(page, {
            settings: {
                enablePruning: false,
                historyKeptExchanges: 2,
                enableDebugLogging: false,
            },
            payload,
        });

    expect(fixtureResult.error).toBeNull();
    expect(fixtureResult.receivedNodeCount).toBe(originalNodeCount);

    expect(initialLoadHidingState).toMatchObject({
        installed: true,
        enabled: false,
        settingsReady: true,
        historyKeptExchanges: 2,
    });

    expect(initialLoadHidingState.stats).toMatchObject({
        intercepted: 1,
        trimmed: 0,
        skipped: 1,
        settingsWaitTimedOut: 0,
        lastReason: "initial-load hiding disabled",
        lastOriginalNodeCount: 0,
        lastTrimmedNodeCount: 0,
        lastDeletedNodeCount: 0,
    });
});

test("initial-load hiding uses the popup exchange count during startup", async ({ page }) => {
    const payload = createConversationPayload({
        exchangeCount: 10,
    });

    const { fixtureResult, initialLoadHidingState, originalNodeCount } =
        await loadInitialLoadHidingFixture(page, {
            settings: {
                enablePruning: true,
                historyKeptExchanges: 4,
                enableDebugLogging: true,
            },
            payload,
        });

    expect(fixtureResult.error).toBeNull();
    expect(fixtureResult.receivedNodeCount).toBe(9);

    expect(initialLoadHidingState).toMatchObject({
        installed: true,
        enabled: true,
        settingsReady: true,
        debug: true,
        historyKeptExchanges: 4,
    });

    expect(initialLoadHidingState.stats).toMatchObject({
        intercepted: 1,
        trimmed: 1,
        settingsWaitTimedOut: 0,
        lastReason: "trimmed",
        lastOriginalNodeCount: originalNodeCount,
        lastTrimmedNodeCount: 9,
        lastDeletedNodeCount: originalNodeCount - 9,
    });
});

test("initial-load hiding runtime setting updates still reach the page bridge", async ({ page }) => {
    await loadInitialLoadHidingFixture(page, {
        settings: {
            enablePruning: true,
            historyKeptExchanges: 2,
            enableDebugLogging: false,
        },
    });

    await postRuntimeInitialLoadHidingSettings(page, {
        enabled: true,
        historyKeptExchanges: 6,
        debug: true,
    });

    await expect
        .poll(async () => {
            const state = await getInitialLoadHidingState(page);

            return {
                enabled: state?.enabled,
                historyKeptExchanges: state?.historyKeptExchanges,
                debug: state?.debug,
                settingsReady: state?.settingsReady,
            };
        })
        .toEqual({
            enabled: true,
            historyKeptExchanges: 6,
            debug: true,
            settingsReady: true,
        });
});
