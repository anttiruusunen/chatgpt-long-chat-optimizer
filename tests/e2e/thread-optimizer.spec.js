import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test("control: page fixture works in this spec file", async ({ page }) => {
    await page.goto("about:blank");
    await expect(page).toHaveURL("about:blank");
});

test("control: setContent works in this spec file", async ({ page }) => {
    await page.setContent("<!doctype html><html><body><div id='ok'>OK</div></body></html>");
    await expect(page.locator("#ok")).toHaveText("OK");
});

test("control: fixture html can be read from disk", async () => {
    const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
    const html = fs.readFileSync(fixturePath, "utf8");

    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain("Thread Optimizer Fixture");
});