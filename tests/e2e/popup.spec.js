import path from "node:path";
import { test, expect } from "@playwright/test";

const popupPath = path.resolve("src/popup/popup.html");
const popupUrl = `file://${popupPath}`;

async function loadPopup(
    page,
    {
        settings = {},
        pruneStatus = {
            currentPageHistoryWasReduced: false,
            currentPageHasPrunedTurns: false,
            currentPagePrunedTurnCount: 0,
        },
        reloadDelayMs = 0,
    } = {}
) {
    await page.addInitScript(
    ({ initialSettings, initialPruneStatus, initialReloadDelayMs }) => {
        const storageState = {
            ...initialSettings,
        };

        const storageSetCalls = [];
        const tabMessages = [];
        const reloadCalls = [];

        function cloneStorageState() {
            return {
                ...storageState,
            };
        }

        function selectStorageValues(keys) {
            if (keys == null) {
                return cloneStorageState();
            }

            if (typeof keys === "string") {
                return {
                    [keys]: storageState[keys],
                };
            }

            if (Array.isArray(keys)) {
                const result = {};

                for (const key of keys) {
                    result[key] = storageState[key];
                }

                return result;
            }

            if (typeof keys === "object") {
                return {
                    ...keys,
                    ...storageState,
                };
            }

            return cloneStorageState();
        }

        globalThis.chrome = {
            runtime: {
                lastError: null,
                getURL: (resourcePath) => resourcePath,
            },
            storage: {
                sync: {
                    get: (keys, callback) => {
                        callback?.(selectStorageValues(keys));
                    },
                    set: (values, callback) => {
                        storageSetCalls.push({
                            ...values,
                        });

                        Object.assign(storageState, values);

                        queueMicrotask(() => {
                            callback?.();
                        });
                    },
                },
            },
            tabs: {
                query: (_queryInfo, callback) => {
                    callback?.([
                        {
                            id: 123,
                        },
                    ]);
                },
                sendMessage: (tabId, message, callback) => {
                    tabMessages.push({
                        tabId,
                        message,
                    });

                    queueMicrotask(() => {
                        if (message?.action === "get-prune-status") {
                            const currentPageHistoryWasReduced = Boolean(
                                initialPruneStatus.currentPageHistoryWasReduced ||
                                    initialPruneStatus.currentPageHasPrunedTurns
                            );

                            callback?.({
                                ok: true,
                                currentPageHistoryWasReduced,
                                currentPageHasPrunedTurns:
                                    currentPageHistoryWasReduced,
                                currentPagePrunedTurnCount: Math.max(
                                    0,
                                    Math.floor(
                                        Number(
                                            initialPruneStatus.currentPagePrunedTurnCount
                                        ) || 0
                                    )
                                ),
                            });
                            return;
                        }

                        callback?.({
                            ok: true,
                        });
                    });
                },
                reload: (tabId, callback) => {
                    reloadCalls.push({
                        tabId,
                    });

                    if (initialReloadDelayMs > 0) {
                        setTimeout(() => {
                            callback?.();
                        }, initialReloadDelayMs);
                        return;
                    }

                    queueMicrotask(() => {
                        callback?.();
                    });
                },
            },
        };

        globalThis.__POPUP_E2E__ = {
            getStorage: cloneStorageState,
            getStorageSetCalls: () => [...storageSetCalls],
            getTabMessages: () => [...tabMessages],
            getReloadCalls: () => [...reloadCalls],
            clearCalls: () => {
                storageSetCalls.length = 0;
                tabMessages.length = 0;
                reloadCalls.length = 0;
            },
        };
    },
    {
        initialSettings: settings,
        initialPruneStatus: pruneStatus,
        initialReloadDelayMs: reloadDelayMs,
    }
    );

    await page.goto(popupUrl);
    await expect(page.locator("#historyKeptExchanges")).toBeVisible();

    await expect
        .poll(
            async () => {
                const tabMessages = await page.evaluate(() =>
                    globalThis.__POPUP_E2E__.getTabMessages()
                );

                return tabMessages.some(
                    ({ message }) => message?.action === "get-prune-status"
                );
            },
            {
                timeout: 3000,
            }
        )
        .toBe(true);

    await page.evaluate(() => {
        globalThis.__POPUP_E2E__.clearCalls();
    });
}

async function waitForAnySave(page) {
    await expect
        .poll(
            async () => {
                const storageSetCalls = await page.evaluate(() =>
                    globalThis.__POPUP_E2E__.getStorageSetCalls()
                );

                return storageSetCalls.length;
            },
            {
                timeout: 3000,
            }
        )
        .toBeGreaterThan(0);
}

async function waitForReloadCall(page, expectedCount = 1) {
    await expect
        .poll(
            async () => {
                const reloadCalls = await page.evaluate(() =>
                    globalThis.__POPUP_E2E__.getReloadCalls()
                );

                return reloadCalls.length;
            },
            {
                timeout: 3000,
            }
        )
        .toBe(expectedCount);
}

async function waitForStorageValue(page, key, expected) {
    await expect
        .poll(
            async () => {
                const storage = await page.evaluate(() =>
                    globalThis.__POPUP_E2E__.getStorage()
                );

                return storage[key];
            },
            {
                timeout: 3000,
            }
        )
        .toBe(expected);
}

async function waitForStorageMatch(page, expectedPartial) {
    await expect
        .poll(
            async () => {
                const storage = await page.evaluate(() =>
                    globalThis.__POPUP_E2E__.getStorage()
                );

                for (const [key, value] of Object.entries(expectedPartial)) {
                    if (storage[key] !== value) {
                        return false;
                    }
                }

                return true;
            },
            {
                timeout: 3000,
            }
        )
        .toBe(true);
}

test("store read optimization is enabled by default on a fresh popup load", async ({
    page,
}) => {
    await loadPopup(page);

    await page.locator("#enableDebugLogging").setChecked(true);
    await waitForAnySave(page);

    await expect(page.locator("#debugSection")).toBeVisible();
    await expect(page.locator("#enableStoreReadOptimization")).toBeChecked();

    const storage = await page.evaluate(() => globalThis.__POPUP_E2E__.getStorage());

    expect(storage.enableStoreReadOptimization).toBe(true);
});

test("rapid popup changes persist the final settings", async ({ page }) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 3,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: false,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        },
    });

    await page.locator("#historyKeptExchanges").fill("4");
    await page.locator("#historyKeptExchanges").fill("8");
    await page.locator("#enablePruning").setChecked(false);
    await page.locator("#enableCodeBlockScrollbars").setChecked(false);
    await page.locator("#enableUserMessageClamp").setChecked(false);
    await page.locator("#enableDebugLogging").setChecked(true);

    await waitForStorageMatch(page, {
        historyKeptExchanges: 8,
        autoPrune: true,
        enablePruning: false,
        enableDebugLogging: true,
        enableStoreReadOptimization: true,
        enableCodeBlockScrollbars: false,
        enableUserMessageClamp: false,
    });

    const storageSetCalls = await page.evaluate(() =>
        globalThis.__POPUP_E2E__.getStorageSetCalls()
    );

    const tabMessages = await page.evaluate(() =>
        globalThis.__POPUP_E2E__.getTabMessages()
    );

    const storage = await page.evaluate(() => globalThis.__POPUP_E2E__.getStorage());
    const lastTabMessage = tabMessages.at(-1);

    expect(storageSetCalls.length).toBeGreaterThanOrEqual(1);
    expect(tabMessages.length).toBeGreaterThanOrEqual(1);

    expect(storage).toMatchObject({
        historyKeptExchanges: 8,
        autoPrune: true,
        enablePruning: false,
        enableDebugLogging: true,
        enableStoreReadOptimization: true,
        enableCodeBlockScrollbars: false,
        enableUserMessageClamp: false,
    });

    expect(lastTabMessage).toMatchObject({
        tabId: 123,
        message: {
            action: "settings-updated",
            historyKeptExchanges: 8,
            autoPrune: true,
            enablePruning: false,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: false,
            enableUserMessageClamp: false,
        },
    });
});

test("rapid history edits persist only the final normalized value", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 3,
        },
    });

    await page.locator("#historyKeptExchanges").fill("2");
    await page.locator("#historyKeptExchanges").fill("7");
    await page.locator("#historyKeptExchanges").fill("4.9");

    await waitForStorageValue(page, "historyKeptExchanges", 4);

    const storageSetCalls = await page.evaluate(() =>
        globalThis.__POPUP_E2E__.getStorageSetCalls()
    );

    const storage = await page.evaluate(() => globalThis.__POPUP_E2E__.getStorage());

    expect(storageSetCalls).toHaveLength(1);
    expect(storage.historyKeptExchanges).toBe(4);
    await expect(page.locator("#historyKeptExchanges")).toHaveValue("4");
});

test("reload notice appears after increasing kept exchanges on an already-pruned page", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 1,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 8,
        },
    });

    await expect(page.locator("#historyReloadNotice")).toBeHidden();

    await page.locator("#historyKeptExchanges").fill("3");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();
    await expect(page.getByText("Reload required")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload chat" })).toBeVisible();

    await waitForStorageValue(page, "historyKeptExchanges", 3);

    await expect(page.locator("#historyReloadNotice")).toBeVisible();
});

test("reload notice hides again when kept exchanges are lowered back to the loaded value", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 1,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 8,
        },
    });

    await page.locator("#historyKeptExchanges").fill("3");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();

    await page.locator("#historyKeptExchanges").fill("1");

    await expect(page.locator("#historyReloadNotice")).toBeHidden();
});

test("reload button saves pending settings before reloading the active tab", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 1,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 8,
        },
    });

    await page.locator("#historyKeptExchanges").fill("3");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();

    await page.getByRole("button", { name: "Reload chat" }).click();

    await waitForStorageValue(page, "historyKeptExchanges", 3);
    await waitForReloadCall(page, 1);

    const reloadCalls = await page.evaluate(() =>
        globalThis.__POPUP_E2E__.getReloadCalls()
    );

    expect(reloadCalls).toEqual([
        {
            tabId: 123,
        },
    ]);

    const tabMessages = await page.evaluate(() =>
        globalThis.__POPUP_E2E__.getTabMessages()
    );

    expect(
        tabMessages.some(
            ({ tabId, message }) =>
                tabId === 123 &&
                message?.action === "settings-updated" &&
                message?.historyKeptExchanges === 3 &&
                message?.enablePruning === true
        )
    ).toBe(true);
});

test("reload notice appears when history was reduced even without a prune count", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 5,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHistoryWasReduced: true,
            currentPageHasPrunedTurns: false,
            currentPagePrunedTurnCount: 0,
        },
    });

    await expect(page.locator("#historyReloadNotice")).toBeHidden();

    await page.locator("#historyKeptExchanges").fill("6");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();
    await expect(page.getByText("Reload required")).toBeVisible();
});

test("reload notice appears when increasing kept exchanges after initial-load history reduction", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 5,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHistoryWasReduced: true,
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 12,
        },
    });

    await expect(page.locator("#historyReloadNotice")).toBeHidden();

    await page.locator("#historyKeptExchanges").fill("6");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();
    await expect(page.getByText("Reload required")).toBeVisible();
});

test("reload notice stays hidden on a fresh unreduced chat when kept exchanges increase", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 5,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHistoryWasReduced: false,
            currentPageHasPrunedTurns: false,
            currentPagePrunedTurnCount: 0,
        },
    });

    await page.locator("#historyKeptExchanges").fill("6");

    await expect(page.locator("#historyReloadNotice")).toBeHidden();
});

test("reload button disables while reloading and hides the notice after reload starts", async ({
    page,
}) => {
    await loadPopup(page, {
        settings: {
            historyKeptExchanges: 1,
            enablePruning: true,
        },
        pruneStatus: {
            currentPageHistoryWasReduced: true,
            currentPageHasPrunedTurns: true,
            currentPagePrunedTurnCount: 8,
        },
        reloadDelayMs: 100,
    });

    const reloadButton = page.getByRole("button", { name: "Reload chat" });

    await page.locator("#historyKeptExchanges").fill("3");

    await expect(page.locator("#historyReloadNotice")).toBeVisible();
    await expect(reloadButton).toBeEnabled();

    await reloadButton.click();

    await expect(reloadButton).toBeDisabled();

    await waitForReloadCall(page, 1);

    await expect(page.locator("#historyReloadNotice")).toBeHidden();
    await expect(page.locator("#status")).toHaveText("Reloading chat");
});