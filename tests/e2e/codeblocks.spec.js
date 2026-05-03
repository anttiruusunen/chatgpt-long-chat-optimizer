import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("code blocks: large code block is detached and replaced with placeholder", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await expect(fixture.codePlaceholder()).toHaveCount(1);
    await expect(page.locator("pre")).toHaveCount(0);
});

test("code blocks: reveal restores detached block", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const placeholder = fixture.codePlaceholder();

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
    const fixture = await loadOptimizerFixture(page);

    await expect(fixture.codePlaceholder()).toHaveCount(1);

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

test("code blocks: reveal is idempotent after refresh triggers", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const placeholder = fixture.codePlaceholder();

    await expect(placeholder).toHaveCount(1);

    await placeholder.locator("button").click();

    await expect(page.locator("pre")).toHaveCount(1);

    await fixture.triggerScrollRefresh(3);

    await expect(page.locator("pre")).toHaveCount(1);
    await expect(page.locator("pre")).toHaveCount(1);
    await expect(fixture.codePlaceholder()).toHaveCount(0);
});

test("codeblock + streaming does not break DOM", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.setLatestStreaming();

    await fixture.triggerScrollRefresh(3);

    await fixture.expectLatestAssistantVisible();
    await expect(page.locator("pre")).toHaveCount(0);
});