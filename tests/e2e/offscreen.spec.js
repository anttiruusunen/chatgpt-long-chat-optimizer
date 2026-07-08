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

async function setStorage(page, values) {
    await page.evaluate((nextValues) => {
        return window.__THREAD_OPTIMIZER_E2E_STORAGE__.set(nextValues);
    }, values);

    await page.waitForTimeout(100);
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

test("offscreen: disabled startup does not enable browser-native section mode", async ({ page }) => {
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

test("offscreen: enabled startup applies browser-native section optimization", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(12);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);

    for (const section of snapshot) {
        expect(section.optimized).toBe("true");
        expect(Number(section.height)).toBeGreaterThan(0);
        expect(section.intrinsicSize).toMatch(/^\d+px$/);
        expect(section.hasLegacyLive).toBe(false);
    }
});

test("offscreen: newly added conversation sections are optimized incrementally", async ({
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
    await expect(sectionOptLocator(page)).toHaveCount(12);

    const before = await getSectionOptimizationSnapshot(page);

    expect(before).toHaveLength(12);
    expect(before.every((section) => section.optimized === "true")).toBe(true);

    await appendIncrementalExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);
    await expect(sectionOptLocator(page)).toHaveCount(14);

    const after = await getSectionOptimizationSnapshot(page);

    expect(after).toHaveLength(14);
    expect(after.every((section) => section.optimized === "true")).toBe(true);
    expect(after.every((section) => !section.hasLegacyLive)).toBe(true);

    expect(after.slice(0, before.length).map((section) => section.height)).toEqual(
        before.map((section) => section.height)
    );

    for (const section of after.slice(-2)) {
        expect(Number(section.height)).toBeGreaterThan(0);
        expect(section.intrinsicSize).toMatch(/^\d+px$/);
    }
});

test("offscreen: runtime disable removes browser-native section markers", async ({ page }) => {
    await loadOptimizerFixture(page, {
        settings: {
            autoPrune: false,
            enableOffscreenOptimization: true,
        },
    });

    await expect(page.locator(`html[${ROOT_ATTR}="true"]`)).toHaveCount(1);
    await expect(sectionOptLocator(page)).toHaveCount(12);

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

test("offscreen: runtime enable reapplies browser-native section markers", async ({ page }) => {
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
    await expect(sectionOptLocator(page)).toHaveCount(12);

    const snapshot = await getSectionOptimizationSnapshot(page);

    expect(snapshot).toHaveLength(12);
    expect(snapshot.every((section) => section.optimized === "true")).toBe(true);
    expect(snapshot.every((section) => !section.hasLegacyLive)).toBe(true);
});

test("offscreen: newly added sections are optimized when pruning is also enabled", async ({
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
    await expect(sectionOptLocator(page)).toHaveCount(12);

    const before = await getSectionOptimizationSnapshot(page);

    expect(before).toHaveLength(12);
    expect(before.every((section) => section.optimized === "true")).toBe(true);

    await appendIncrementalExchange(page);

    await expect(page.locator("section[data-turn]")).toHaveCount(14);
    await expect(sectionOptLocator(page)).toHaveCount(14);

    const after = await getSectionOptimizationSnapshot(page);

    expect(after).toHaveLength(14);
    expect(after.every((section) => section.optimized === "true")).toBe(true);
    expect(after.every((section) => !section.hasLegacyLive)).toBe(true);

    expect(after.slice(0, before.length).map((section) => section.height)).toEqual(
        before.map((section) => section.height)
    );

    for (const section of after.slice(-2)) {
        expect(Number(section.height)).toBeGreaterThan(0);
        expect(section.intrinsicSize).toMatch(/^\d+px$/);
    }
});