import path from "node:path";
import { test, expect } from "@playwright/test";

const popupPath = path.resolve("src/popup/popup.html");
const popupUrl = `file://${popupPath}`;

async function loadPopup(page, { settings = {} } = {}) {
    await page.addInitScript((initialSettings) => {
        const storageState = {
            ...initialSettings,
        };

        const storageSetCalls = [];
        const tabMessages = [];

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
                        callback?.({
                            ok: true,
                        });
                    });
                },
            },
        };

        globalThis.__POPUP_E2E__ = {
            getStorage: cloneStorageState,
            getStorageSetCalls: () => [...storageSetCalls],
            getTabMessages: () => [...tabMessages],
        };
    }, settings);

    await page.goto(popupUrl);
    await expect(page.locator("#historyKeptExchanges")).toBeVisible();
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
    expect(storageSetCalls.length).toBeLessThanOrEqual(2);
    expect(tabMessages.length).toBe(storageSetCalls.length);

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