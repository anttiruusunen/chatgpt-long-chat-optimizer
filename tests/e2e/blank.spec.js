import { test, expect } from "@playwright/test";

test("blank page works 1", async ({ page }) => {
    await page.goto("about:blank");
    await expect(page).toHaveURL("about:blank");
});

// test("blank page works 2", async ({ page }) => {
//     await page.goto("about:blank");
//     await expect(page).toHaveURL("about:blank");
// });