import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("startup prunes to latest exchange", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
});

test("repeated refresh triggers do not change the pruned shape", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.triggerScrollRefresh(5);

    await fixture.expectPrunedToLatestExchange();
});

test("clicking the remaining chat does not restore old turns", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await fixture.latestAssistant().click({ force: true });

    await expect(fixture.turns()).toHaveCount(2);
});

test("pruning disabled keeps all fixture turns mounted", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enablePruning: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);
});

test("auto-prune disabled keeps all fixture turns mounted on startup", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);
});

test("prune-now runtime message prunes immediately", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);

    await page.evaluate(() => {
        chrome.runtime.onMessage.__listeners[0](
            { action: "prune-now" },
            {},
            () => {}
        );
    });

    await fixture.expectPrunedToLatestExchange();
});