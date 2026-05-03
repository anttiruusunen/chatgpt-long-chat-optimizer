import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("rapid scroll + streaming + reload does not break DOM", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await page.evaluate(() => {
        for (let i = 0; i < 10; i++) {
            window.dispatchEvent(new Event("scroll"));
        }
    });

    await page.reload();
    fixture = await loadOptimizerFixture(page);

    await fixture.expectLatestAssistantVisible();
    await fixture.expectPrunedToLatestExchange();
});