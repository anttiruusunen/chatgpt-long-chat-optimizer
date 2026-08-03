import { test, expect } from "@playwright/test";
import { loadOptimizerFixture } from "./helpers/fixtureDriver.js";

const ROOT_ATTR = "data-thread-optimizer-sections-offscreen";
const SECTION_ATTR = "data-thread-optimizer-offscreen-opt";
const HEIGHT_ATTR = "data-thread-optimizer-height";
const INTRINSIC_SIZE_VAR = "--thread-optimizer-section-intrinsic-size";
const LEGACY_LIVE_ATTR = "data-thread-optimizer-offscreen-live";

function sectionOptLocator(page) {
    return page.locator(`section[${SECTION_ATTR}="true"]`);
}

async function getSectionOptimizationSnapshot(page) {
    return await page.evaluate(
        ({ sectionAttr, heightAttr, intrinsicSizeVar, legacyLiveAttr }) =>
            Array.from(document.querySelectorAll("section[data-turn]")).map(
                (section) => ({
                    id: section.getAttribute("data-testid"),
                    turn: section.getAttribute("data-turn"),
                    anchor: section.getAttribute("data-scroll-anchor"),
                    optimized: section.getAttribute(sectionAttr),
                    height: section.getAttribute(heightAttr),
                    intrinsicSize: section.style.getPropertyValue(intrinsicSizeVar),
                    hasLegacyLive: section.hasAttribute(legacyLiveAttr),
                    contentVisibility: getComputedStyle(section).contentVisibility,
                    containIntrinsicSize:
                        getComputedStyle(section).containIntrinsicSize,
                })
            ),
        {
            sectionAttr: SECTION_ATTR,
            heightAttr: HEIGHT_ATTR,
            intrinsicSizeVar: INTRINSIC_SIZE_VAR,
            legacyLiveAttr: LEGACY_LIVE_ATTR,
        }
    );
}

function expectNewestExchangeProtected(snapshot) {
    expect(snapshot.length).toBeGreaterThanOrEqual(2);

    const olderSections = snapshot.slice(0, -2);
    const newestExchange = snapshot.slice(-2);

    for (const section of olderSections) {
        expect(section.optimized).toBe("true");
        expect(Number(section.height)).toBeGreaterThan(0);
        expect(section.intrinsicSize).toMatch(/^\d+px$/);
        expect(section.hasLegacyLive).toBe(false);
    }

    expect(newestExchange[0].turn).toBe("user");
    expect(newestExchange[1].turn).toBe("assistant");

    for (const section of newestExchange) {
        expect(section.optimized).toBeNull();
        expect(section.intrinsicSize).toBe("");
        expect(section.hasLegacyLive).toBe(false);
    }
}

async function setStorage(page, values) {
    await page.evaluate((nextValues) => {
        return window.__THREAD_OPTIMIZER_E2E_STORAGE__.set(nextValues);
    }, values);

    await page.waitForTimeout(100);
}

async function startReplyAndAppendStreamingExchange(page) {
    await page.evaluate(() => {
        const state = window.__threadOptimizerState;
        const conversation = state?.observedContainer;

        if (!(conversation instanceof Element)) {
            throw new Error("Missing observed conversation container");
        }

        for (const section of document.querySelectorAll(
            'section[data-scroll-anchor="true"]'
        )) {
            section.removeAttribute("data-scroll-anchor");
        }

        /*
         * Start the real reply-timing lifecycle through the installed
         * document click listener.
         *
         * replyTiming recognizes a composer submit button by aria-label.
         */
        const sendButton = document.createElement("button");
        sendButton.id = "composer-submit-button";
        sendButton.setAttribute("aria-label", "Send message");
        sendButton.textContent = "Send";
        document.body.appendChild(sendButton);

        sendButton.click();
        sendButton.setAttribute("aria-label", "Stop answering");
        sendButton.textContent = "Stop";

        /*
         * Mount the new exchange synchronously before the reply completion
         * poll gets a chance to inspect the previously completed assistant.
         */
        const nextIndex =
            document.querySelectorAll("section[data-turn]").length + 1;

        const user = document.createElement("section");
        user.setAttribute("data-turn", "user");
        user.setAttribute("data-testid", `conversation-turn-${nextIndex}`);
        user.textContent = "New streaming user message";

        const assistant = document.createElement("section");
        assistant.setAttribute("data-turn", "assistant");
        assistant.setAttribute(
            "data-testid",
            `conversation-turn-${nextIndex + 1}`
        );
        assistant.setAttribute("data-scroll-anchor", "true");
        assistant.textContent = "New streaming assistant message";

        /*
         * Deliberately do NOT add Response actions yet.
         * Their absence represents the streaming reply.
         */
        conversation.appendChild(user);
        conversation.appendChild(assistant);
    });

    await page.waitForFunction(() => {
        return window.__threadOptimizerState?.replyTiming?.pending === true;
    });
}

async function appendIncrementalExchange(page) {
    await page.evaluate(() => {
        const state = window.__threadOptimizerState;
        const conversation = state?.observedContainer;

        if (!(conversation instanceof Element)) {
            throw new Error("Missing observed conversation container");
        }

        for (const section of document.querySelectorAll(
            'section[data-scroll-anchor="true"]'
        )) {
            section.removeAttribute("data-scroll-anchor");
        }

        const nextIndex =
            document.querySelectorAll("section[data-turn]").length + 1;

        const user = document.createElement("section");
        user.setAttribute("data-turn", "user");
        user.setAttribute("data-testid", `conversation-turn-${nextIndex}`);
        user.textContent = "New incremental user message";

        const assistant = document.createElement("section");
        assistant.setAttribute("data-turn", "assistant");
        assistant.setAttribute(
            "data-testid",
            `conversation-turn-${nextIndex + 1}`
        );
        assistant.setAttribute("data-scroll-anchor", "true");
        assistant.textContent = "New incremental assistant message";

        const actions = document.createElement("div");
        actions.setAttribute("aria-label", "Response actions");
        actions.textContent = "Actions";
        assistant.appendChild(actions);

        conversation.appendChild(user);
        conversation.appendChild(assistant);
    });
}

test("offscreen: disabled startup does not enable browser-native section mode", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: false,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(0);
    await expect(sectionOptLocator(page)).toHaveCount(0);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);
    expect(snapshot.every((section) => section.optimized === null)).toBe(true);
    expect(snapshot.every((section) => !section.hasLegacyLive)).toBe(true);
});

test("offscreen: enabled startup optimizes older sections but protects newest exchange", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);
    expectNewestExchangeProtected(snapshot);
});

test("offscreen: newly added exchange stays protected during incremental optimization", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enablePruning: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const before = await getSectionOptimizationSnapshot(page);

    expect(before).toHaveLength(12);
    expectNewestExchangeProtected(before);

    const optimizedBeforeIds = before
        .filter((section) => section.optimized === "true")
        .map((section) => section.id);

    const previouslyProtectedIds = before
        .slice(-2)
        .map((section) => section.id);

    await appendIncrementalExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);

    // Incremental optimization only examines the added exchange.
    // The previous newest exchange remains untouched until a later
    // reconciliation/full-sync pass.
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const after = await getSectionOptimizationSnapshot(page);

    expect(after).toHaveLength(14);

    const optimizedAfterIds = after
        .filter((section) => section.optimized === "true")
        .map((section) => section.id);

    expect(optimizedAfterIds).toEqual(optimizedBeforeIds);

    for (const id of previouslyProtectedIds) {
        const section = after.find((entry) => entry.id === id);

        expect(section).toBeTruthy();
        expect(section.optimized).toBeNull();
    }

    const newestExchange = after.slice(-2);

    expect(newestExchange).toEqual([
        expect.objectContaining({
            turn: "user",
            optimized: null,
        }),
        expect.objectContaining({
            turn: "assistant",
            anchor: "true",
            optimized: null,
        }),
    ]);

    expect(
        newestExchange.every((section) => section.intrinsicSize === "")
    ).toBe(true);

    expect(after.every((section) => !section.hasLegacyLive)).toBe(true);
});

test("offscreen: runtime disable removes browser-native section markers", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    await setStorage(page, {
        enableOffscreenOptimization: false,
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(0);
    await expect(sectionOptLocator(page)).toHaveCount(0);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);

    for (const section of snapshot) {
        expect(section.optimized).toBeNull();
        expect(section.intrinsicSize).toBe("");
        expect(section.hasLegacyLive).toBe(false);
    }
});

test("offscreen: runtime enable optimizes older sections and keeps newest exchange protected", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: false,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(0);
    await expect(sectionOptLocator(page)).toHaveCount(0);

    await setStorage(page, {
        enableOffscreenOptimization: true,
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);
    expectNewestExchangeProtected(snapshot);
});

test("offscreen: newly added exchange stays protected during incremental optimization when pruning is enabled", async ({
    page,
}) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: true,
            enablePruning: true,
            historyKeptExchanges: 20,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const before = await getSectionOptimizationSnapshot(page);

    expect(before).toHaveLength(12);
    expectNewestExchangeProtected(before);

    const optimizedBeforeIds = before
        .filter((section) => section.optimized === "true")
        .map((section) => section.id);

    const previouslyProtectedIds = before
        .slice(-2)
        .map((section) => section.id);

    await appendIncrementalExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);

    // Pruning being enabled must not cause the newly mounted exchange
    // to receive offscreen optimization.
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const after = await getSectionOptimizationSnapshot(page);

    expect(after).toHaveLength(14);

    const optimizedAfterIds = after
        .filter((section) => section.optimized === "true")
        .map((section) => section.id);

    expect(optimizedAfterIds).toEqual(optimizedBeforeIds);

    for (const id of previouslyProtectedIds) {
        const section = after.find((entry) => entry.id === id);

        expect(section).toBeTruthy();
        expect(section.optimized).toBeNull();
    }

    const newestExchange = after.slice(-2);

    expect(newestExchange[0]).toEqual(
        expect.objectContaining({
            turn: "user",
            optimized: null,
        })
    );

    expect(newestExchange[1]).toEqual(
        expect.objectContaining({
            turn: "assistant",
            anchor: "true",
            optimized: null,
        })
    );

    expect(after.every((section) => !section.hasLegacyLive)).toBe(true);
});

test("offscreen: reply settlement optimizes the previous exchange while keeping the newest exchange protected", async ({
    page,
}) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enablePruning: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator("section[data-turn]")).toHaveCount(12);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const before = await getSectionOptimizationSnapshot(page);

    expect(before).toHaveLength(12);
    expectNewestExchangeProtected(before);

    const previouslyProtectedIds = before
        .slice(-2)
        .map((section) => section.id);

    await startReplyAndAppendStreamingExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);

    /*
     * Incremental processing must leave both the previous protected
     * exchange and the new streaming exchange untouched.
     */
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const duringStreaming = await getSectionOptimizationSnapshot(page);

    expect(duringStreaming).toHaveLength(14);

    for (const id of previouslyProtectedIds) {
        const section = duringStreaming.find((entry) => entry.id === id);

        expect(section).toBeTruthy();
        expect(section.optimized).toBeNull();
    }

    const streamingExchange = duringStreaming.slice(-2);

    expect(streamingExchange[0]).toEqual(
        expect.objectContaining({
            turn: "user",
            optimized: null,
        })
    );

    expect(streamingExchange[1]).toEqual(
        expect.objectContaining({
            turn: "assistant",
            anchor: "true",
            optimized: null,
        })
    );

    expect(
        await page.evaluate(() => {
            return window.__threadOptimizerState?.replyTiming?.pending;
        })
    ).toBe(true);

    /*
     * Add the real settled signal. replyTiming's completion poll should
     * detect this and run the production onReplySettled callback.
     */
    await fixture.completeLatestStreaming();
    await page.locator("#composer-submit-button").evaluate((button) => {
        button.setAttribute("aria-label", "Send message");
        button.textContent = "Send";
    });
    await fixture.expectLatestAssistantComplete();

    await page.waitForFunction(() => {
        return window.__threadOptimizerState?.replyTiming?.pending === false;
    });

    /*
     * onReplySettled calls optimizeUnoptimizedConversationSections().
     * The previous exchange is now old enough to optimize, while the
     * current newest exchange remains protected.
     */
    await expect(sectionOptLocator(page)).toHaveCount(12);

    const afterSettlement = await getSectionOptimizationSnapshot(page);

    expect(afterSettlement).toHaveLength(14);

    for (const id of previouslyProtectedIds) {
        const section = afterSettlement.find((entry) => entry.id === id);

        expect(section).toBeTruthy();
        expect(section.optimized).toBe("true");
        expect(Number(section.height)).toBeGreaterThan(0);
        expect(section.intrinsicSize).toMatch(/^\d+px$/);
    }

    const newestExchange = afterSettlement.slice(-2);

    expect(newestExchange[0]).toEqual(
        expect.objectContaining({
            turn: "user",
            optimized: null,
        })
    );

    expect(newestExchange[1]).toEqual(
        expect.objectContaining({
            turn: "assistant",
            anchor: "true",
            optimized: null,
        })
    );

    expect(
        newestExchange.every((section) => section.intrinsicSize === "")
    ).toBe(true);

    expect(
        afterSettlement.every((section) => !section.hasLegacyLive)
    ).toBe(true);
});

test("offscreen: reply settlement and delayed auto-prune never optimize or remove the newest exchange", async ({
    page,
}) => {
    const fixture = await loadOptimizerFixture(page, {
        settings: {
            autoPrune: true,
            enablePruning: true,

            /*
             * Keep enough history that this test observes the lifecycle
             * without intentionally removing any of the fixture exchanges.
             */
            historyKeptExchanges: 20,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator("section[data-turn]")).toHaveCount(12);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const before = await getSectionOptimizationSnapshot(page);

    const previouslyProtectedIds = before
        .slice(-2)
        .map((section) => section.id);

    await startReplyAndAppendStreamingExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);
    await expect(sectionOptLocator(page)).toHaveCount(10);

    const latestUser = page.locator('section[data-turn="user"]').last();
    const latestAssistant = page.locator(
        'section[data-turn="assistant"]'
    ).last();

    const latestUserId = await latestUser.getAttribute("data-testid");
    const latestAssistantId =
        await latestAssistant.getAttribute("data-testid");

    expect(latestUserId).toBeTruthy();
    expect(latestAssistantId).toBeTruthy();

    await fixture.expectLatestAssistantStreaming();

    await fixture.completeLatestStreaming();
    await page.locator("#composer-submit-button").evaluate((button) => {
        button.setAttribute("aria-label", "Send message");
        button.textContent = "Send";
    });
    await fixture.expectLatestAssistantComplete();

    /*
     * First wait for the actual reply-settled lifecycle.
     */
    await page.waitForFunction(() => {
        return window.__threadOptimizerState?.replyTiming?.pending === false;
    });

    /*
     * Reconciliation happens immediately at reply settlement.
     */
    await expect(sectionOptLocator(page)).toHaveCount(12);

    let snapshot = await getSectionOptimizationSnapshot(page);

    for (const id of previouslyProtectedIds) {
        const section = snapshot.find((entry) => entry.id === id);

        expect(section).toBeTruthy();
        expect(section.optimized).toBe("true");
    }

    let newestExchange = snapshot.slice(-2);

    expect(newestExchange[0]).toEqual(
        expect.objectContaining({
            id: latestUserId,
            turn: "user",
            optimized: null,
        })
    );

    expect(newestExchange[1]).toEqual(
        expect.objectContaining({
            id: latestAssistantId,
            turn: "assistant",
            anchor: "true",
            optimized: null,
        })
    );

    /*
     * The production reply-settled auto-prune now has a 1 second grace
     * period. Wait beyond it so this also exercises the delayed prune.
     */
    await page.waitForTimeout(1250);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);

    await expect(
        page.locator(
            `section[data-testid="${latestUserId}"]`
        )
    ).toBeVisible();

    await expect(
        page.locator(
            `section[data-testid="${latestAssistantId}"]`
        )
    ).toBeVisible();

    await expect(
        page.locator(
            `section[data-testid="${latestUserId}"][${SECTION_ATTR}="true"]`
        )
    ).toHaveCount(0);

    await expect(
        page.locator(
            `section[data-testid="${latestAssistantId}"][${SECTION_ATTR}="true"]`
        )
    ).toHaveCount(0);

    snapshot = await getSectionOptimizationSnapshot(page);
    newestExchange = snapshot.slice(-2);

    expect(newestExchange[0].id).toBe(latestUserId);
    expect(newestExchange[0].optimized).toBeNull();

    expect(newestExchange[1].id).toBe(latestAssistantId);
    expect(newestExchange[1].optimized).toBeNull();

    expect(
        newestExchange.every((section) => section.intrinsicSize === "")
    ).toBe(true);
});