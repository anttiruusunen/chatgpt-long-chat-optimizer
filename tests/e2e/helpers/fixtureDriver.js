import { expect } from "@playwright/test";
import { loadFixtureWithOptimizer } from "./loadFixtureWithOptimizer.js";

const E2E_BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef";

async function installReactPruneBridgeMock(page) {
    await page.evaluate((token) => {
        window.THREAD_OPTIMIZER_BRIDGE_TOKEN =
            window.THREAD_OPTIMIZER_BRIDGE_TOKEN || token;

        if (window.__threadOptimizerE2EReactPruneMockInstalled) {
            return;
        }

        window.__threadOptimizerE2EReactPruneMockInstalled = true;

        const originalPostMessage = window.postMessage.bind(window);

        function removeByMessageIds(messageIds) {
            let removedCount = 0;

            for (const messageId of messageIds) {
                const section = Array.from(
                    document.querySelectorAll("section[data-message-id]")
                ).find(
                    (candidate) =>
                        candidate.getAttribute("data-message-id") === messageId
                );

                if (section?.isConnected) {
                    section.remove();
                    removedCount += 1;
                }
            }

            return removedCount;
        }

        function removeOldestFallback(messageIds) {
            const requestedCount = Array.isArray(messageIds)
                ? messageIds.length
                : 0;

            if (requestedCount <= 0) {
                return 0;
            }

            const sections = Array.from(
                document.querySelectorAll("section[data-turn]")
            );

            const keepCount = 2;
            const removableCount = Math.max(0, sections.length - keepCount);
            const removeCount = Math.min(requestedCount, removableCount);

            for (let i = 0; i < removeCount; i += 1) {
                sections[i]?.remove();
            }

            return removeCount;
        }

        window.postMessage = function patchedPostMessage(
            message,
            targetOrigin,
            transfer
        ) {
            if (
                message?.source === "thread-optimizer" &&
                message?.token === window.THREAD_OPTIMIZER_BRIDGE_TOKEN &&
                message?.type === "thread-optimizer:prune-react-message-ids"
            ) {
                const messageIds = Array.isArray(message.messageIds)
                    ? message.messageIds
                    : [];

                const removedCount = removeByMessageIds(messageIds);

                if (removedCount === 0) {
                    removeOldestFallback(messageIds);
                }

                return;
            }

            return originalPostMessage(message, targetOrigin, transfer);
        };
    }, E2E_BRIDGE_TOKEN);
}

export async function loadOptimizerFixture(page, options = {}) {
    await loadFixtureWithOptimizer(page, options);
    await installReactPruneBridgeMock(page);

    return {
        turns: () => page.locator("section[data-turn]"),
        users: () => page.locator('section[data-turn="user"]'),
        assistants: () => page.locator('section[data-turn="assistant"]'),
        latestAssistant: () => page.locator('section[data-turn="assistant"]').last(),

        prunePlaceholder: () =>
            page.locator('[data-thread-optimizer-placeholder="true"]'),

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

                if (!latest) {
                    return;
                }

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