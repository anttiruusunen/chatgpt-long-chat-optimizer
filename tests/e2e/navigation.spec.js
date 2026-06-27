import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

const PRUNE_OVERLAY_CARD = "#long-chat-optimizer-prune-overlay-card";
const PRUNE_OVERLAY_BACKDROP = "#long-chat-optimizer-prune-overlay";
const PRUNE_OVERLAY_HIDE =
    "#long-chat-optimizer-prune-overlay-card .long-chat-optimizer-prune-hide";

async function expectNoStuckPruneOverlay(page, timeout = 5000) {
    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeHidden({ timeout });
    await expect(page.locator(PRUNE_OVERLAY_BACKDROP)).toBeHidden({ timeout });
}

async function setFixtureToEmptyNewChat(page) {
    await page.evaluate(() => {
        history.replaceState({}, "", "/");

        const conversation = document.querySelector("#conversation");
        if (conversation) {
            conversation.replaceChildren();
        }
    });
}

async function setFixtureToEmptyExistingChat(page, path = "/c/e2e-empty-chat") {
    await page.evaluate((nextPath) => {
        history.replaceState({}, "", nextPath);

        const conversation = document.querySelector("#conversation");
        if (conversation) {
            conversation.replaceChildren();
        }
    }, path);
}

async function clickSyntheticNewChat(page) {
    await page.evaluate(() => {
        const button = document.createElement("button");
        button.setAttribute("aria-label", "New chat");
        button.textContent = "New chat";
        document.body.appendChild(button);

        button.click();

        history.pushState({}, "", "/");

        const conversation = document.querySelector("#conversation");
        if (conversation) {
            conversation.replaceChildren();
        }
    });
}

async function clickSyntheticRecentChat(page, path = "/c/e2e-recent-chat") {
    await page.evaluate((nextPath) => {
        const link = document.createElement("a");
        link.href = nextPath;
        link.textContent = "Recent chat";
        document.body.appendChild(link);

        link.click();

        history.pushState({}, "", nextPath);

        const conversation = document.querySelector("#conversation");
        if (!conversation) {
            return;
        }

        conversation.replaceChildren();

        for (let i = 1; i <= 6; i += 1) {
            const user = document.createElement("section");
            user.setAttribute("data-turn", "user");
            user.setAttribute("data-testid", `conversation-turn-${i * 2 - 1}`);
            user.textContent = `User ${i}`;

            const assistant = document.createElement("section");
            assistant.setAttribute("data-turn", "assistant");
            assistant.setAttribute("data-testid", `conversation-turn-${i * 2}`);
            assistant.textContent = `Assistant ${i}`;

            if (i === 6) {
                assistant.setAttribute("data-scroll-anchor", "true");
            }

            const actions = document.createElement("div");
            actions.setAttribute("aria-label", "Response actions");
            actions.textContent = "Actions";
            assistant.appendChild(actions);

            conversation.appendChild(user);
            conversation.appendChild(assistant);
        }
    }, path);
}

async function clickSyntheticRecentChatOptions(page, path = "/c/e2e-options-chat") {
    await page.evaluate((nextPath) => {
        const link = document.createElement("a");
        link.href = nextPath;
        link.setAttribute("data-sidebar-item", "true");
        link.textContent = "Recent chat";

        const button = document.createElement("button");
        button.setAttribute("aria-label", "Open conversation options");
        button.setAttribute("aria-haspopup", "menu");
        button.textContent = "...";

        link.appendChild(button);
        document.body.appendChild(link);

        button.click();
    }, path);
}

test("reload reinitializes optimizer without restoring old turns", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await page.reload();

    fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.turns()).toHaveCount(2);
});

test("multiple reloads keep the same hard-pruned shape", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    for (let i = 0; i < 3; i += 1) {
        await page.reload();
        fixture = await loadOptimizerFixture(page);
    }

    await fixture.expectPrunedToLatestExchange();
    await expect(fixture.turns()).toHaveCount(2);
});

test("new chat does not leave prune overlay stuck", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await clickSyntheticNewChat(page);

    await expectNoStuckPruneOverlay(page);
    await expect(fixture.turns()).toHaveCount(0);
});

test("opening a recent chat after new chat still prunes and clears overlay", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await clickSyntheticNewChat(page);

    await expectNoStuckPruneOverlay(page);
    await expect(fixture.turns()).toHaveCount(0);

    await clickSyntheticRecentChat(page);

    fixture = {
        ...fixture,
        turns: () => page.locator("section[data-turn]"),
    };

    await expect(fixture.turns()).toHaveCount(2, {
        timeout: 10000,
    });

    await expectNoStuckPruneOverlay(page, 10000);
});

test("direct load to empty new chat does not show or stick prune overlay", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyNewChat(page);
        },
    });

    await expect(fixture.turns()).toHaveCount(0);
    await expectNoStuckPruneOverlay(page);
});

test("storage changes on empty new chat do not show or stick prune overlay", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyNewChat(page);
        },
    });

    await expect(fixture.turns()).toHaveCount(0);
    await expectNoStuckPruneOverlay(page);

    await page.evaluate(async () => {
        await window.__THREAD_OPTIMIZER_E2E_STORAGE__.set({
            historyKeptExchanges: 2,
        });
    });

    await expect(fixture.turns()).toHaveCount(0);
    await expectNoStuckPruneOverlay(page);
});

test("new chat follow-up does not suppress pruning after opening a real recent chat", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page);

    await fixture.expectPrunedToLatestExchange();

    await clickSyntheticNewChat(page);

    await expectNoStuckPruneOverlay(page);
    await expect(fixture.turns()).toHaveCount(0);

    await page.waitForTimeout(700);

    await clickSyntheticRecentChat(page, "/c/e2e-recent-chat-after-followup");

    fixture = {
        ...fixture,
        turns: () => page.locator("section[data-turn]"),
    };

    await expect(fixture.turns()).toHaveCount(2, {
        timeout: 10000,
    });

    await expectNoStuckPruneOverlay(page, 10000);
});

test("empty existing-chat route can hide the prune overlay manually", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyExistingChat(page);
        },
    });

    await expect(fixture.turns()).toHaveCount(0);
    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });

    await page.locator(PRUNE_OVERLAY_HIDE).click();

    await expectNoStuckPruneOverlay(page);

    await page.waitForTimeout(500);

    await expectNoStuckPruneOverlay(page);
});

test("overlay watchdog restores removed overlay while active until user hides it", async ({ page }) => {
    await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyExistingChat(page, "/c/e2e-empty-watchdog");
        },
    });

    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });

    await page.evaluate(() => {
        document
            .getElementById("long-chat-optimizer-prune-overlay")
            ?.remove();
        document
            .getElementById("long-chat-optimizer-prune-overlay-card")
            ?.remove();
    });

    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });
    await expect(page.locator(PRUNE_OVERLAY_BACKDROP)).toBeVisible({
        timeout: 5000,
    });

    await page.locator(PRUNE_OVERLAY_HIDE).click();

    await expectNoStuckPruneOverlay(page);
});

test("manual overlay hide does not suppress overlay after opening another empty chat", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyExistingChat(page, "/c/e2e-empty-chat-hidden");
        },
    });

    await expect(fixture.turns()).toHaveCount(0);

    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });

    await page.locator(PRUNE_OVERLAY_HIDE).click();

    await expectNoStuckPruneOverlay(page);

    await page.waitForTimeout(500);

    await expectNoStuckPruneOverlay(page);

    await setFixtureToEmptyExistingChat(page, "/c/e2e-empty-chat-after-hidden");

    await page.evaluate(() => {
        window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });

    await page.locator(PRUNE_OVERLAY_HIDE).click();

    await expectNoStuckPruneOverlay(page);
});

test("manual overlay hide does not suppress pruning after opening a populated recent chat", async ({ page }) => {
    let fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyExistingChat(page, "/c/e2e-empty-chat-hidden-before-recent");
        },
    });

    await expect(fixture.turns()).toHaveCount(0);

    await expect(page.locator(PRUNE_OVERLAY_CARD)).toBeVisible({
        timeout: 5000,
    });

    await page.locator(PRUNE_OVERLAY_HIDE).click();

    await expectNoStuckPruneOverlay(page);

    await page.waitForTimeout(500);

    await expectNoStuckPruneOverlay(page);

    await clickSyntheticRecentChat(page, "/c/e2e-recent-after-overlay-hidden");

    fixture = {
        ...fixture,
        turns: () => page.locator("section[data-turn]"),
    };

    await expect(fixture.turns()).toHaveCount(2, {
        timeout: 10000,
    });

    await expectNoStuckPruneOverlay(page, 10000);
});

test("recent chat options menu click does not trigger conversation navigation overlay", async ({ page }) => {
    const fixture = await loadOptimizerFixture(page, {
        beforeOptimizerLoad: async (page) => {
            await setFixtureToEmptyNewChat(page);
        },
    });

    const initialUrl = page.url();

    await expect(fixture.turns()).toHaveCount(0);
    await expectNoStuckPruneOverlay(page);

    await clickSyntheticRecentChatOptions(page);

    await page.waitForTimeout(1000);

    expect(page.url()).toBe(initialUrl);
    await expect(fixture.turns()).toHaveCount(0);
    await expectNoStuckPruneOverlay(page);
});