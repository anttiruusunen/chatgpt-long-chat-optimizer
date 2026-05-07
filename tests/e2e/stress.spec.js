import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

test("handles large conversation without breaking", async ({ page }) => {
    await loadOptimizerFixture(page);

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");

        for (let i = 0; i < 100; i++) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", "assistant");
            s.setAttribute("data-testid", `conversation-turn-extra-${i}`);
            s.setAttribute("data-message-id", `extra-msg-${i}`);
            s.textContent = "Extra " + i;
            convo.appendChild(s);
        }

        chrome.runtime.onMessage.__listeners[0](
            { action: "prune-now" },
            {},
            () => {}
        );
    });

    await page.waitForTimeout(300);

    const count = await page.locator("section[data-turn]").count();
    expect(count).toBeLessThan(20);
});