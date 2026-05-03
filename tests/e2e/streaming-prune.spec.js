import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("startup prune preserves latest streaming assistant", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await fixture.expectLatestAssistantStreaming();
    await fixture.expectPrunedToLatestExchange();
});

test("reload after streaming state keeps latest assistant visible", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await page.reload();

    fixture = await loadOptimizerFixture(page);

    await fixture.expectLatestAssistantVisible();
    await fixture.expectPrunedToLatestExchange();
});

test("preference button marks latest assistant as completed", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();
    await fixture.addPreferenceButtonToLatestAssistant();

    const latest = fixture.latestAssistant();

    await expect(
        latest.locator('[data-testid="paragen-prefer-response-button"]')
    ).toHaveCount(1);

    await fixture.expectLatestAssistantVisible();
});

test("streaming reload keeps latest assistant visible when it contains a code block", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await page.reload();

    fixture = await loadOptimizerFixture(page);

    await fixture.expectLatestAssistantVisible();
    await fixture.expectPrunedToLatestExchange();

    await expect(fixture.codePlaceholder()).toHaveCount(1);
});