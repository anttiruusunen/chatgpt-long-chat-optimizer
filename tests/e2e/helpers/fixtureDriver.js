import { expect } from "@playwright/test";
import { loadFixtureWithOptimizer } from "./loadFixtureWithOptimizer.js";

const E2E_BRIDGE_TOKEN = "0123456789abcdef0123456789abcdef";

async function installStorePruneBridgeMock(page) {
    await page.evaluate((token) => {
        window.THREAD_OPTIMIZER_BRIDGE_TOKEN =
            window.THREAD_OPTIMIZER_BRIDGE_TOKEN || token;

        window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ =
            window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ || [];

        if (window.__threadOptimizerE2EStorePruneMockInstalled) {
            return;
        }

        window.__threadOptimizerE2EStorePruneMockInstalled = true;

        window.__threadOptimizerChatStoreBridge = {
            __installed: true,
            __version: "e2e-store-prune-mock",
            __knownPruningEnabled: true,
            __knownHistoryKeptExchanges: 1,
            __knownPrunedTurnCount: 0,

            hasStore() {
                return true;
            },

            setKnownPruningState({
                enabled,
                prunedTurnCount,
                historyKeptExchanges,
            } = {}) {
                this.__knownPruningEnabled = Boolean(enabled);

                if (Number.isFinite(Number(prunedTurnCount))) {
                    this.__knownPrunedTurnCount = Math.max(
                        0,
                        Number(prunedTurnCount)
                    );
                }

                if (Number.isFinite(Number(historyKeptExchanges))) {
                    this.__knownHistoryKeptExchanges = Math.max(
                        1,
                        Math.floor(Number(historyKeptExchanges))
                    );
                }

                return {
                    ok: true,
                    enabled: this.__knownPruningEnabled,
                    prunedTurnCount: this.__knownPrunedTurnCount,
                    historyKeptExchanges: this.__knownHistoryKeptExchanges,
                };
            },

            pruneStoreHistory({
                historyKeptExchanges = this.__knownHistoryKeptExchanges || 1,
                reason = "e2e-store-prune",
            } = {}) {
                const keepExchanges = Math.max(
                    1,
                    Math.floor(Number(historyKeptExchanges) || 1)
                );

                const keepSections = keepExchanges * 2;
                const sections = Array.from(
                    document.querySelectorAll("section[data-turn]")
                );

                const removable = sections.slice(
                    0,
                    Math.max(0, sections.length - keepSections)
                );

                for (const section of removable) {
                    section.remove();
                }

                this.__knownPrunedTurnCount += removable.length;

                return {
                    ok: true,
                    reason,
                    historyKeptExchanges: keepExchanges,
                    requestedDeleteCount: removable.length,
                    deletedCount: removable.length,
                    failedCount: 0,
                    deleted: removable.map((section) => ({
                        text: section.textContent || "",
                    })),
                    failed: [],
                };
            },

            getPerformanceSnapshot() {
                return {
                    e2eMock: true,
                    remainingTurns: document.querySelectorAll(
                        "section[data-turn]"
                    ).length,
                };
            },
        };

        const originalPostMessage = window.postMessage.bind(window);

        window.postMessage = function patchedPostMessage(
            message,
            targetOrigin,
            transfer
        ) {
            if (
                message?.source === "thread-optimizer" &&
                message?.token === window.THREAD_OPTIMIZER_BRIDGE_TOKEN
            ) {
                window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ =
                    window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ || [];

                window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__.push(message);

                if (message.type === "thread-optimizer:set-pruning-state") {
                    window.__threadOptimizerChatStoreBridge.setKnownPruningState({
                        enabled: message.enabled,
                        prunedTurnCount: message.prunedTurnCount,
                        historyKeptExchanges: message.historyKeptExchanges,
                    });
                    return;
                }

                if (message.type === "thread-optimizer:prune-store-history") {
                    window.__threadOptimizerChatStoreBridge.pruneStoreHistory({
                        historyKeptExchanges: message.historyKeptExchanges,
                        reason: message.reason,
                    });
                    return;
                }

                if (message.type === "thread-optimizer:log-store-performance") {
                    console.log(
                        "[Long Chat Optimizer E2E bridge mock] store performance",
                        window.__threadOptimizerChatStoreBridge.getPerformanceSnapshot()
                    );
                    return;
                }

                if (
                    message.type ===
                        "thread-optimizer:set-store-read-optimization" ||
                    message.type === "thread-optimizer:visible-messages-ready"
                ) {
                    return;
                }
            }

            return originalPostMessage(message, targetOrigin, transfer);
        };
    }, E2E_BRIDGE_TOKEN);
}

export async function loadOptimizerFixture(page, options = {}) {
    const {
        settings = {},
        beforeOptimizerLoad,
        ...restOptions
    } = options;

    await loadFixtureWithOptimizer(page, {
        ...restOptions,
        settings: {
            historyKeptExchanges: 1,
            ...settings,
        },
        beforeOptimizerLoad: async (page) => {
            await beforeOptimizerLoad?.(page);
            await installStorePruneBridgeMock(page);
        },
    });

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