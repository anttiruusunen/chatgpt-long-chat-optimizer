import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("offscreen: fixture keeps latest assistant available after hard pruning", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await expect(fixture.assistants()).toHaveCount(1);
    await fixture.expectPrunedToLatestExchange();
});

test("offscreen: only latest assistant is marked live", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await expect(fixture.liveAssistant()).toHaveCount(1);
});

test("offscreen: latest assistant can enter streaming shape without breaking DOM", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await fixture.expectLatestAssistantStreaming();
});

test("offscreen: multiple refresh triggers coalesce without breaking DOM", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.triggerScrollRefresh(5);

    await fixture.expectPrunedToLatestExchange();
});

test("offscreen: completing streaming restores normal assistant shape", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();
    await fixture.completeLatestStreaming();

    await fixture.expectLatestAssistantComplete();
});