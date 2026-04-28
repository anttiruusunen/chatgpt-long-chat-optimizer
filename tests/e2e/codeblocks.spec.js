import { test, expect } from "@playwright/test";
import path from "node:path";

const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
const fixtureUrl = `file://${fixturePath}`;

test("code blocks: large code block is detached and replaced with placeholder", async ({ page }) => {
    await loadFixtureWithOptimizer(page);

    await expect(
        page.locator('[data-thread-optimizer-code-placeholder="true"]')
    ).toHaveCount(1);

    await expect(page.locator("pre")).toHaveCount(0);
});

test("code blocks: reveal restores detached block", async ({ page }) => {
    await page.goto(fixtureUrl);

    const placeholder = page.locator('[data-thread-optimizer-code-placeholder="true"]');

    await expect(placeholder).toHaveCount(1);

    await placeholder.locator("button").click();

    await expect(page.locator("pre")).toHaveCount(1);

    await expect(
        page.locator(
            '[data-thread-optimizer-code-placeholder="true"]:not([data-thread-optimizer-code-placeholder-hidden="true"])'
        )
    ).toHaveCount(0);
});

test("code blocks: no duplicate placeholders created", async ({ page }) => {
    await page.goto(fixtureUrl);

    await page.waitForFunction(() =>
        document.querySelector('[data-thread-optimizer-code-placeholder="true"]')
    );

    const placeholders = await page.$$(
        '[data-thread-optimizer-code-placeholder="true"]'
    );

    const ids = await Promise.all(
        placeholders.map((placeholder) =>
            placeholder.evaluate((el) =>
                el.getAttribute("data-thread-optimizer-code-placeholder-id")
            )
        )
    );

    expect(ids.length).toBe(new Set(ids).size);
});