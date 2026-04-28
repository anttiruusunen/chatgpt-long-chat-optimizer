import { test, expect } from "@playwright/test";
import path from "node:path";

const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
const fixtureUrl = `file://${fixturePath}`;

test("fixture loads conversation turns", async ({ page }) => {
    await page.goto(fixtureUrl);

    await expect(page.locator("section[data-turn='user']")).toHaveCount(6);
    await expect(page.locator("section[data-turn='assistant']")).toHaveCount(6);
    await expect(page.locator("section[data-scroll-anchor='true']")).toHaveCount(1);
});

test("fixture can toggle latest assistant between complete and streaming", async ({ page }) => {
    await page.goto(fixtureUrl);

    const latestAssistant = page.locator("section[data-turn='assistant']").last();

    await expect(latestAssistant.locator("[aria-label='Response actions']")).toHaveCount(1);

    await page.evaluate(() => window.__FIXTURE__.setLatestStreaming());
    await expect(latestAssistant.locator("[aria-label='Response actions']")).toHaveCount(0);

    await page.evaluate(() => window.__FIXTURE__.completeLatestStreaming());
    await expect(latestAssistant.locator("[aria-label='Response actions']")).toHaveCount(1);
});

test("fixture exposes a large code block on latest assistant", async ({ page }) => {
    await page.goto(fixtureUrl);

    const latestAssistant = page.locator("section[data-turn='assistant']").last();

    await expect(latestAssistant.locator("pre")).toHaveCount(1);
    await expect(latestAssistant.locator("pre")).toContainText("const x = 1;");
});

test("scroll container can scroll through the conversation", async ({ page }) => {
    await page.goto(fixtureUrl);

    const scrollWrap = page.locator("#scroll-wrap");
    const initialScrollTop = await scrollWrap.evaluate((el) => el.scrollTop);

    await scrollWrap.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
    });

    const bottomScrollTop = await scrollWrap.evaluate((el) => el.scrollTop);
    expect(bottomScrollTop).toBeGreaterThan(initialScrollTop);
});