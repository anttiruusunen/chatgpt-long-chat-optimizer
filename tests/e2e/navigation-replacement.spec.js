import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("replacing conversation DOM reinitializes pruning cleanly", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");
        convo.innerHTML = "";

        for (let i = 0; i < 4; i++) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", "assistant");
            s.textContent = "New convo " + i;
            convo.appendChild(s);
        }

        window.dispatchEvent(new Event("scroll"));
    });

    await expect(page.locator("section[data-turn]")).toHaveCount(2);
});