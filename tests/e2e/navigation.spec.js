import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("reload reinitializes optimizer without duplicate prune placeholders", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.prunePlaceholder()).toHaveCount(1);

    await page.reload();

    fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.prunePlaceholder()).toHaveCount(1);
});

test("multiple reloads do not duplicate placeholders", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    for (let i = 0; i < 3; i++) {
        await page.reload();
        fixture = await loadOptimizerFixture(page);
    }

    await expect(fixture.prunePlaceholder()).toHaveCount(1);
});