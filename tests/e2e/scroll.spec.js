import { test, expect } from "@playwright/test";
import path from "node:path";

const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
const fixtureUrl = `file://${fixturePath}`;

test("scroll: does not jump or lose position when scrolling up", async ({ page }) => {
    await page.goto(fixtureUrl);

    const scrollWrap = page.locator("#scroll-wrap");

    await scrollWrap.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });

    await scrollWrap.evaluate((el) => {
        el.scrollTop = 0;
    });

    await page.waitForTimeout(200);

    const topVisible = await page.evaluate(() => {
        const first = document.querySelector("section");
        return first?.textContent;
    });

    expect(topVisible).toContain("User 1");
});

test("scroll anchor: keeps the same section in view after optimization", async ({ page }) => {
    await page.goto(fixtureUrl);

    const scrollWrap = page.locator("#scroll-wrap");
    const targetSelector = '[data-testid="conversation-turn-7"]';
    const target = page.locator(targetSelector);

    await expect(target).toBeVisible();

    await scrollWrap.evaluate((el, selector) => {
        const target = document.querySelector(selector);
        el.scrollTop = target.offsetTop - 20;
    }, targetSelector);

    await page.waitForTimeout(50);

    const before = await target.boundingBox();

    await page.evaluate(() => {
        window.__FIXTURE__.setLatestStreaming();
        window.dispatchEvent(new Event("scroll"));
    });

    await page.waitForTimeout(200);

    const after = await target.boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    const deltaY = Math.abs(before.y - after.y);
    expect(deltaY).toBeLessThan(5);
});

test("scroll anchor: target section remains in DOM and visible", async ({ page }) => {
    await page.goto(fixtureUrl);

    const targetSelector = '[data-testid="conversation-turn-7"]';
    const target = page.locator(targetSelector);

    await expect(target).toBeVisible();

    await target.scrollIntoViewIfNeeded();

    await page.evaluate(() => {
        for (let i = 0; i < 5; i += 1) {
            window.dispatchEvent(new Event("scroll"));
        }
    });

    await page.waitForTimeout(200);

    await expect(page.locator(targetSelector)).toHaveCount(1);
    await expect(page.locator(targetSelector)).toBeVisible();
});