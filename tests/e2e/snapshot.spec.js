import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("DOM structure remains stable after hard pruning", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    const html = await page.content();

    expect(html).toContain('section data-turn="user"');
    expect(html).toContain('section data-turn="assistant"');
    expect(html).not.toContain("data-thread-optimizer-placeholder");
    expect(html).not.toContain("data-thread-optimizer-top-restore-sentinel");
    expect(html).not.toContain("data-thread-optimizer-bottom-prune-sentinel");
});