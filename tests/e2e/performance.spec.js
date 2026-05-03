import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";
import { measure } from "./helpers/perf.js";

test("startup prune completes within budget", async ({ page }) => {
    const duration = await measure(page, async () => {
        await window.location.reload();
    });

    // generous upper bound, tune later
    expect(duration).toBeLessThan(200);
});

test("scroll handling stays within frame budget", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const duration = await measure(page, async () => {
        for (let i = 0; i < 10; i++) {
            window.dispatchEvent(new Event("scroll"));
        }
    });

    // 10 scrolls should not exceed ~1 frame each
    expect(duration).toBeLessThan(160);
});

test("streaming mutation burst does not exceed budget", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    const duration = await measure(page, async () => {
        window.__FIXTURE__.setLatestStreaming();

        for (let i = 0; i < 10; i++) {
            window.dispatchEvent(new Event("scroll"));
        }

        window.__FIXTURE__.completeLatestStreaming();
    });

    expect(duration).toBeLessThan(200);
});

test("optimizer reduces DOM size significantly", async ({ page }) => {
    await loadOptimizerFixture(page);

    const counts = await page.evaluate(() => {
        return {
            total: document.querySelectorAll("section").length,
            visible: document.querySelectorAll("section[data-turn]").length,
        };
    });

    expect(counts.visible).toBeLessThan(counts.total);
    expect(counts.visible).toBeLessThanOrEqual(2);
});

test("large conversation remains performant after pruning", async ({ page }) => {
    await loadOptimizerFixture(page);

    await page.evaluate(() => {
        const convo = document.getElementById("conversation");

        for (let i = 0; i < 200; i++) {
            const s = document.createElement("section");
            s.setAttribute("data-turn", "assistant");
            s.textContent = "Load " + i;
            convo.appendChild(s);
        }
    });

    const duration = await measure(page, async () => {
        window.dispatchEvent(new Event("scroll"));
    });

    expect(duration).toBeLessThan(50);
});