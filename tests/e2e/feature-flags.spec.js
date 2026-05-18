import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

const OFFSCREEN_ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const OFFSCREEN_SECTION_ATTR = "data-thread-optimizer-offscreen-opt";
const STORE_READ_OPTIMIZATION_MESSAGE =
    "thread-optimizer:set-store-read-optimization";

async function setStorage(page, values) {
    await page.evaluate((nextValues) => {
        return window.__THREAD_OPTIMIZER_E2E_STORAGE__.set(nextValues);
    }, values);

    await page.waitForTimeout(100);
}

async function installBridgeMessageRecorder(page) {
    await page.evaluate(() => {
        window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ = [];
    });
}

async function clearBridgeMessages(page) {
    await page.evaluate(() => {
        window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ = [];
    });
}

async function getBridgeMessages(page, type) {
    return await page.evaluate((messageType) => {
        return (window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ || []).filter(
            (message) => message.type === messageType
        );
    }, type);
}

async function getLastBridgeMessage(page, type) {
    const messages = await getBridgeMessages(page, type);
    return messages[messages.length - 1] || null;
}

async function waitForStoreReadOptimizationMessage(page, expected) {
    await page.waitForFunction(
        ({ type, enabled, debug }) =>
            (window.__THREAD_OPTIMIZER_E2E_BRIDGE_MESSAGES__ || []).some(
                (message) =>
                    message.type === type &&
                    message.enabled === enabled &&
                    (debug === undefined || message.debug === debug)
            ),
        {
            type: STORE_READ_OPTIMIZATION_MESSAGE,
            ...expected,
        },
        {
            timeout: 10000,
        }
    );
}

test("feature flags: offscreen optimization disabled/enabled controls native offscreen markers", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: false,
        },
    });

    await expect(page.locator(`html[${OFFSCREEN_ROOT_ATTR}="true"]`)).toHaveCount(0);
    await expect(
        page.locator(`section[${OFFSCREEN_SECTION_ATTR}="true"]`)
    ).toHaveCount(0);

    await setStorage(page, {
        enableOffscreenOptimization: true,
    });

    await expect(page.locator(`html[${OFFSCREEN_ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(
        page.locator(`section[${OFFSCREEN_SECTION_ATTR}="true"]`)
    ).toHaveCount(12);

    await setStorage(page, {
        enableOffscreenOptimization: false,
    });

    await expect(page.locator(`html[${OFFSCREEN_ROOT_ATTR}="true"]`)).toHaveCount(0);
    await expect(
        page.locator(`section[${OFFSCREEN_SECTION_ATTR}="true"]`)
    ).toHaveCount(0);
});

test("feature flags: code block scrollbar styles are installed and removed by setting", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableCodeBlockScrollbars: false,
        },
    });

    await expect(page.locator("#thread-optimizer-code-scrollbars-style")).toHaveCount(0);

    await setStorage(page, {
        enableCodeBlockScrollbars: true,
    });

    await expect(page.locator("#thread-optimizer-code-scrollbars-style")).toHaveCount(1);

    await setStorage(page, {
        enableCodeBlockScrollbars: false,
    });

    await expect(page.locator("#thread-optimizer-code-scrollbars-style")).toHaveCount(0);
});

test("feature flags: user message clamp styles are installed and removed by setting", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableUserMessageClamp: false,
        },
    });

    await expect(page.locator("#thread-optimizer-user-message-clamp-style")).toHaveCount(0);

    await setStorage(page, {
        enableUserMessageClamp: true,
    });

    await expect(page.locator("#thread-optimizer-user-message-clamp-style")).toHaveCount(1);

    await setStorage(page, {
        enableUserMessageClamp: false,
    });

    await expect(page.locator("#thread-optimizer-user-message-clamp-style")).toHaveCount(0);
});

test("feature flags: pruning disabled keeps fixture turns mounted", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enablePruning: false,
            autoPrune: true,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);
});

test("feature flags: auto-prune disabled keeps fixture turns mounted until prune-now", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enablePruning: true,
            autoPrune: false,
        },
    });

    await expect(fixture.turns()).toHaveCount(12);

    await page.evaluate(() => {
        chrome.runtime.onMessage.__listeners[0](
            { action: "prune-now" },
            {},
            () => {}
        );
    });

    await fixture.expectPrunedToLatestExchange();
});

test("feature flags: store-read optimization disabled state reaches the page bridge", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            enableStoreReadOptimization: false,
            enableDebugLogging: true,
        },
        beforeOptimizerLoad: installBridgeMessageRecorder,
    });

    await waitForStoreReadOptimizationMessage(page, {
        enabled: false,
        debug: true,
    });

    const lastMessage = await getLastBridgeMessage(
        page,
        STORE_READ_OPTIMIZATION_MESSAGE
    );

    expect(lastMessage).toMatchObject({
        type: STORE_READ_OPTIMIZATION_MESSAGE,
        enabled: false,
        debug: true,
    });
});

test("feature flags: store-read optimization enabled state reaches the page bridge after initial prune", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enableStoreReadOptimization: true,
            enableDebugLogging: false,
        },
        beforeOptimizerLoad: installBridgeMessageRecorder,
    });

    await waitForStoreReadOptimizationMessage(page, {
        enabled: false,
        debug: false,
    });

    await fixture.expectPrunedToLatestExchange();

    await waitForStoreReadOptimizationMessage(page, {
        enabled: true,
        debug: false,
    });

    const lastMessage = await getLastBridgeMessage(
        page,
        STORE_READ_OPTIMIZATION_MESSAGE
    );

    expect(lastMessage).toMatchObject({
        type: STORE_READ_OPTIMIZATION_MESSAGE,
        enabled: true,
        debug: false,
    });
});

test("feature flags: store-read optimization runtime toggle posts disabled state", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            enableStoreReadOptimization: true,
            enableDebugLogging: false,
        },
        beforeOptimizerLoad: installBridgeMessageRecorder,
    });

    await fixture.expectPrunedToLatestExchange();

    await waitForStoreReadOptimizationMessage(page, {
        enabled: true,
        debug: false,
    });

    await clearBridgeMessages(page);

    await setStorage(page, {
        enableStoreReadOptimization: false,
    });

    await waitForStoreReadOptimizationMessage(page, {
        enabled: false,
    });

    const lastMessage = await getLastBridgeMessage(
        page,
        STORE_READ_OPTIMIZATION_MESSAGE
    );

    expect(lastMessage).toMatchObject({
        type: STORE_READ_OPTIMIZATION_MESSAGE,
        enabled: false,
    });
});