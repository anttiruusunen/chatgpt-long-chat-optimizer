import { test, expect } from "@playwright/test";
import { loadFixtureWithOptimizer } from "./helpers/loadFixtureWithOptimizer.js";

test("offscreen: fixture keeps assistant sections available", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await expect(page.locator('section[data-turn="assistant"]')).toHaveCount(1);
    await expect(page.locator('[data-thread-optimizer-placeholder="true"]')).toBeVisible();
});

test("offscreen: only latest assistant is marked live", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await expect(
        page.locator(
            'section[data-turn="assistant"][data-thread-optimizer-offscreen-live="true"]'
        )
    ).toHaveCount(1);
});

test("offscreen: latest assistant can enter streaming shape without breaking DOM", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await page.evaluate(() => {
        window.__FIXTURE__.setLatestStreaming();
    });

    const latestAssistant = page.locator('section[data-turn="assistant"]').last();

    await expect(latestAssistant).toBeVisible();
    await expect(latestAssistant.locator('[aria-label="Response actions"]')).toHaveCount(0);
});

test("offscreen: multiple refresh triggers coalesce without breaking DOM", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await page.evaluate(() => {
        for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new Event("scroll"));
        }
    });

    await page.waitForTimeout(200);

    await expect(page.locator("section[data-turn]")).toHaveCount(2);
    await expect(page.locator('[data-thread-optimizer-placeholder="true"]')).toBeVisible();
});

test("offscreen: completing streaming restores normal assistant shape", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await page.evaluate(() => {
        window.__FIXTURE__.setLatestStreaming();
        window.__FIXTURE__.completeLatestStreaming();
    });

    const latestAssistant = page.locator('section[data-turn="assistant"]').last();

    await expect(latestAssistant.locator('[aria-label="Response actions"]')).toHaveCount(1);
});