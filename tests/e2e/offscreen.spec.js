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