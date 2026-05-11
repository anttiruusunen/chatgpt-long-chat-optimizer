import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("replacing conversation DOM does not break optimizer lifecycle", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");
        convo.innerHTML = "";

        for (let i = 0; i < 4; i += 1) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", i % 2 === 0 ? "user" : "assistant");
            s.setAttribute("data-testid", `conversation-turn-new-${i}`);

            if (i === 3) {
                s.setAttribute("data-scroll-anchor", "true");
            }

            s.textContent = "New convo " + i;
            convo.appendChild(s);
        }

        window.dispatchEvent(new Event("scroll"));
    });

    await expect(page.locator("section[data-turn]")).toHaveCount(4);
    await expect(page.locator('[data-testid="conversation-turn-new-3"]')).toBeVisible();

    const reloadedFixture = await loadOptimizerFixture(page);

    await reloadedFixture.expectPrunedToLatestExchange();
});