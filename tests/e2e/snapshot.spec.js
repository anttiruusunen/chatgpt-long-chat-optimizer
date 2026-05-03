import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("DOM structure remains stable", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const html = await page.content();

    expect(html).toContain("data-thread-optimizer-placeholder");
});