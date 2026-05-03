import { expect } from "@playwright/test";
import { loadFixtureWithOptimizer } from "./loadFixtureWithOptimizer.js";

export async function loadOptimizerFixture(page, options = {}) {
    await loadFixtureWithOptimizer(page, options);
    return createFixtureDriver(page);
}

export function createFixtureDriver(page) {
    const selectors = {
        turns: 'section[data-turn]',
        users: 'section[data-turn="user"]',
        assistants: 'section[data-turn="assistant"]',
        latestAssistant: 'section[data-turn="assistant"] >> nth=-1',
        prunePlaceholder: '[data-thread-optimizer-placeholder="true"]',
        codePlaceholder: '[data-thread-optimizer-code-placeholder="true"]',
        liveAssistant:
            'section[data-turn="assistant"][data-thread-optimizer-offscreen-live="true"]',
        responseActions: '[aria-label="Response actions"]',
        scrollWrap: "#scroll-wrap",
    };

    return {
        page,
        selectors,

        turns: () => page.locator(selectors.turns),
        assistants: () => page.locator(selectors.assistants),
        latestAssistant: () => page.locator('section[data-turn="assistant"]').last(),
        prunePlaceholder: () => page.locator(selectors.prunePlaceholder),
        codePlaceholder: () => page.locator(selectors.codePlaceholder),
        liveAssistant: () => page.locator(selectors.liveAssistant),
        scrollWrap: () => page.locator(selectors.scrollWrap),

        async setLatestStreaming() {
            await page.evaluate(() => window.__FIXTURE__.setLatestStreaming());
        },

        async completeLatestStreaming() {
            await page.evaluate(() => window.__FIXTURE__.completeLatestStreaming());
        },

        async triggerScrollRefresh(times = 1) {
            await page.evaluate((count) => {
                for (let i = 0; i < count; i += 1) {
                    window.dispatchEvent(new Event("scroll"));
                }
            }, times);
        },

        async addPreferenceButtonToLatestAssistant() {
            await page.evaluate(() => {
                const assistants = [
                    ...document.querySelectorAll('section[data-turn="assistant"]'),
                ];
                const latest = assistants[assistants.length - 1];

                const button = document.createElement("button");
                button.setAttribute("data-testid", "paragen-prefer-response-button");
                button.textContent = "Choose this response";

                latest.appendChild(button);
            });
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
            await expect(latest.locator(selectors.responseActions)).toHaveCount(0);
        },

        async expectLatestAssistantComplete() {
            const latest = this.latestAssistant();
            await expect(latest).toBeVisible();
            await expect(latest.locator(selectors.responseActions)).toHaveCount(1);
        },
    };
}