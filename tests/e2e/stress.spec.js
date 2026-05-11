import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("handles repeated refresh pressure without breaking", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();
    await fixture.triggerScrollRefresh(20);
    await fixture.completeLatestStreaming();
    await fixture.triggerScrollRefresh(20);

    await fixture.expectPrunedToLatestExchange();
    await fixture.expectLatestAssistantComplete();

    const count = await page.locator("section[data-turn]").count();
    expect(count).toBeLessThan(20);
});