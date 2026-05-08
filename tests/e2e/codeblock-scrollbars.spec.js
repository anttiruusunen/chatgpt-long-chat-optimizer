import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("code blocks: tall code blocks are clamped with scrollbars", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const codeBlock = page.locator("pre").first();

    await expect(codeBlock).toHaveCount(1);

    const metrics = await codeBlock.evaluate((pre) => ({
        clientHeight: pre.clientHeight,
        scrollHeight: pre.scrollHeight,
        overflowY: getComputedStyle(pre).overflowY,
        maxHeight: getComputedStyle(pre).maxHeight,
    }));

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
    expect(metrics.maxHeight).not.toBe("none");
});

test("code blocks: scrollbar styling survives refresh triggers", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const codeBlock = page.locator("pre").first();

    await expect(codeBlock).toHaveCount(1);

    await fixture.triggerScrollRefresh(3);

    await expect(codeBlock).toHaveCount(1);

    const metrics = await codeBlock.evaluate((pre) => ({
        clientHeight: pre.clientHeight,
        scrollHeight: pre.scrollHeight,
        overflowY: getComputedStyle(pre).overflowY,
    }));

    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
});

test("code blocks: streaming refresh does not remove code blocks", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();
    await fixture.triggerScrollRefresh(3);

    await fixture.expectLatestAssistantVisible();
    await expect(page.locator("pre")).toHaveCount(1);
});