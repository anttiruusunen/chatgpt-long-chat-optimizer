import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("handles large conversation without breaking", async ({ page }) => {
    await loadOptimizerFixture(page);

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");

        for (let i = 0; i < 100; i++) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", "assistant");
            s.textContent = "Extra " + i;
            convo.appendChild(s);
        }

        window.dispatchEvent(new Event("scroll"));
    });

    await page.waitForTimeout(300);

    const count = await page.locator("section[data-turn]").count();
    expect(count).toBeLessThan(20);
});