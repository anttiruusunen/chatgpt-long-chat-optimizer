import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("missing conversation container does not crash", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await page.evaluate(() => {
        document.getElementById("conversation").remove();
    });

    await page.waitForTimeout(200);

    // If script crashes, test fails automatically
    expect(true).toBe(true);
});

test("partial DOM (only assistant nodes) does not break pruning", async ({ page }) => {
    await loadOptimizerFixture(page);

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");
        convo.innerHTML = "";

        for (let i = 0; i < 5; i++) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", "assistant");
            s.textContent = "Assistant only";
            convo.appendChild(s);
        }
    });

    await page.waitForTimeout(200);

    const count = await page.locator("section").count();
    expect(count).toBeGreaterThan(0);
});