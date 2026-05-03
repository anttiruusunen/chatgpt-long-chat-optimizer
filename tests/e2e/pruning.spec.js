import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("startup prunes to latest exchange and shows placeholder", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
});

test("repeated refresh triggers do not create duplicate prune placeholders", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.triggerScrollRefresh(5);

    await expect(fixture.prunePlaceholder()).toHaveCount(1);
    await fixture.expectPrunedToLatestExchange();
});

test("prune placeholder remains stable after click", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await fixture.prunePlaceholder().click();

    await expect(fixture.turns()).toHaveCount(2);
    await expect(fixture.prunePlaceholder()).toBeVisible();
});

test("restore-all runtime message restores recoverable sections", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await page.evaluate(() => {
        chrome.runtime.onMessage.__listeners[0](
            { action: "restore-all" },
            {},
            () => {}
        );
    });

    await expect(fixture.turns()).toHaveCount(12);
    await expect(fixture.prunePlaceholder()).toHaveCount(1);
    await expect(fixture.prunePlaceholder()).toBeHidden();
});

test("pruning disabled keeps all fixture turns mounted", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enablePruning: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);
    await expect(fixture.prunePlaceholder()).toHaveCount(0);
});

test("auto-prune disabled keeps all fixture turns mounted on startup", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);
    await expect(fixture.prunePlaceholder()).toHaveCount(0);
});

test("prune-now runtime message prunes immediately", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await page.evaluate(() => {
        chrome.runtime.onMessage.__listeners[0](
            { action: "prune-now" },
            {},
            () => {}
        );
    });

    await fixture.expectPrunedToLatestExchange();
});

test("enabling pruning after startup triggers prune", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enablePruning: false,
            autoPrune: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);

    const response = await page.evaluate(() => {
        let responseValue = null;

        chrome.runtime.onMessage.__listeners[0](
            {
                action: "settings-updated",
                enablePruning: true,
                autoPrune: true,
                historyKeptExchanges: 1,
                enableOffscreenOptimization: true,
                enableLargeCodeBlockOptimization: true,
                enableDebugLogging: false,
                enableStoreReadOptimization: false,
                enableCodeBlockScrollbars: true,
                enableUserMessageClamp: true,
                enableCodeBlockCollapse: true,
            },
            {},
            (value) => {
                responseValue = value;
            }
        );

        return responseValue;
    });

    expect(response).toEqual({ ok: true });

    await fixture.expectPrunedToLatestExchange();
});