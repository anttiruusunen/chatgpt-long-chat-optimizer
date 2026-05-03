import { expect } from "@playwright/test";
import { loadFixtureWithOptimizer } from "./loadFixtureWithOptimizer.js";

export async function loadOptimizerFixture(page, options = {}) {
    await loadFixtureWithOptimizer(page, options);

    return {
        turns: () => page.locator("section[data-turn]"),
        users: () => page.locator('section[data-turn="user"]'),
        assistants: () => page.locator('section[data-turn="assistant"]'),
        latestAssistant: () => page.locator('section[data-turn="assistant"]').last(),

        prunePlaceholder: () =>
            page.locator('[data-thread-optimizer-placeholder="true"]'),

        codePlaceholder: () =>
            page.locator('[data-thread-optimizer-code-placeholder="true"]'),

        liveAssistant: () =>
            page.locator(
                'section[data-turn="assistant"][data-thread-optimizer-offscreen-live="true"]'
            ),

        async setLatestStreaming() {
            await page.evaluate(() => {
                window.__FIXTURE__.setLatestStreaming();
            });
        },

        async completeLatestStreaming() {
            await page.evaluate(() => {
                window.__FIXTURE__.completeLatestStreaming();
            });
        },

        async addPreferenceButtonToLatestAssistant() {
            await page.evaluate(() => {
                const assistants = [
                    ...document.querySelectorAll('section[data-turn="assistant"]'),
                ];
                const latest = assistants[assistants.length - 1];

                const button = document.createElement("button");
                button.setAttribute(
                    "data-testid",
                    "paragen-prefer-response-button"
                );
                button.textContent = "Prefer response";

                latest.appendChild(button);
            });
        },

        async triggerScrollRefresh(count = 1) {
            await page.evaluate((times) => {
                for (let i = 0; i < times; i += 1) {
                    window.dispatchEvent(new Event("scroll"));
                }
            }, count);
        },

        async expectPrunedToLatestExchange() {
            await expect(this.turns()).toHaveCount(2);
            await expect(this.prunePlaceholder()).toBeVisible();
        },

        async expectLatestAssistantVisible() {
            await expect(this.latestAssistant()).toBeVisible();
        },

        async expectLatestAssistantStreaming() {
            const latest = this.latestAssistant();
            await expect(latest).toBeVisible();
            await expect(latest.locator('[aria-label="Response actions"]')).toHaveCount(0);
        },

        async expectLatestAssistantComplete() {
            const latest = this.latestAssistant();
            await expect(latest).toBeVisible();
            await expect(latest.locator('[aria-label="Response actions"]')).toHaveCount(1);
        },
    };
}