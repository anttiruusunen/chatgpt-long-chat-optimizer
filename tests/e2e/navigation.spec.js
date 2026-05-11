import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("reload reinitializes optimizer without restoring old turns", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await page.reload();

    fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.turns()).toHaveCount(2);
});

test("multiple reloads keep the same hard-pruned shape", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    for (let i = 0; i < 3; i += 1) {
        await page.reload();
        fixture = await loadOptimizerFixture(page);
    }

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.turns()).toHaveCount(2);
});