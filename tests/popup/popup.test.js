import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../../src/shared/settingsDefaults.js";

const mockRefs = vi.hoisted(() => ({
    storedSettings: null,
    storageSyncGet: vi.fn(),
    storageSyncSet: vi.fn(),
    queryTabs: vi.fn(),
    sendMessageToTab: vi.fn(),
}));

vi.mock("../../src/shared/ext.js", () => ({
    storageSyncGet: mockRefs.storageSyncGet,
    storageSyncSet: mockRefs.storageSyncSet,
    queryTabs: mockRefs.queryTabs,
    sendMessageToTab: mockRefs.sendMessageToTab,
}));

const DEFAULT_POPUP_SETTINGS = {
    ...DEFAULT_SETTINGS,
};

const SAVE_SETTINGS_DEBOUNCE_MS = 400;

const POPUP_FLAG_IDS = [
    "enablePruning",
    "enableOffscreenOptimization",
    "enableDebugLogging",
    "enableStoreReadOptimization",
    "enableCodeBlockScrollbars",
    "enableUserMessageClamp",
];

function createInfoButton(targetId) {
    return `
        <button
            type="button"
            data-info-target="${targetId}"
            aria-expanded="false"
            aria-controls="${targetId}"
        >?</button>
        <div id="${targetId}" hidden></div>
    `;
}

function createPopupDom() {
    document.body.innerHTML = `
        <input id="historyKeptExchanges" type="number" min="1" step="1" />
        ${createInfoButton("historyKeptInfo")}

        <input id="enablePruning" type="checkbox" />
        ${createInfoButton("enablePruningInfo")}

        <input id="enableCodeBlockScrollbars" type="checkbox" />
        ${createInfoButton("enableCodeBlockScrollbarsInfo")}

        <input id="enableUserMessageClamp" type="checkbox" />
        ${createInfoButton("enableUserMessageClampInfo")}

        <input id="enableDebugLogging" type="checkbox" />
        ${createInfoButton("enableDebugLoggingInfo")}

        <div id="debugSection" hidden>
            <input id="enableOffscreenOptimization" type="checkbox" />
            ${createInfoButton("enableOffscreenOptimizationInfo")}

            <input id="enableStoreReadOptimization" type="checkbox" />
            ${createInfoButton("enableStoreReadOptimizationInfo")}

            <div id="debugButtons" hidden>
                <button id="logDebugState" type="button"></button>
                <button id="logDebugBuckets" type="button"></button>
                <button id="logDebugLogical" type="button"></button>
                <button id="logDebugStorePerformance" type="button"></button>
            </div>
        </div>

        <div id="status"></div>
    `;
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function flushDebouncedSave() {
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(SAVE_SETTINGS_DEBOUNCE_MS);
    await flushAsyncWork();
}

async function importPopupWithSettings(settings = {}, { dev = false } = {}) {
    vi.resetModules();
    createPopupDom();

    vi.stubGlobal("__DEV__", Boolean(dev));

    mockRefs.storedSettings = {
        ...DEFAULT_POPUP_SETTINGS,
        ...settings,
    };

    mockRefs.storageSyncGet.mockImplementation(async (defaults = {}) => ({
        ...defaults,
        ...mockRefs.storedSettings,
    }));

    mockRefs.storageSyncSet.mockImplementation(async (nextSettings) => {
        mockRefs.storedSettings = {
            ...mockRefs.storedSettings,
            ...nextSettings,
        };
    });

    mockRefs.queryTabs.mockResolvedValue([{ id: 123 }]);
    mockRefs.sendMessageToTab.mockResolvedValue({ ok: true });

    await import("../../src/popup/popup.js");
    await flushAsyncWork();
}

function dispatchCheckboxChange(id, checked) {
    const checkbox = document.getElementById(id);

    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
}

async function changeCheckbox(id, checked) {
    dispatchCheckboxChange(id, checked);

    await flushDebouncedSave();
}

function dispatchHistoryKeptExchangesInput(value) {
    const input = document.getElementById("historyKeptExchanges");

    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchHistoryKeptExchangesChange(value) {
    const input = document.getElementById("historyKeptExchanges");

    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function changeHistoryKeptExchanges(value) {
    dispatchHistoryKeptExchangesChange(value);

    await flushDebouncedSave();
}

async function clickButton(id) {
    document
        .getElementById(id)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsyncWork();
}

async function clickInfoButton(targetId) {
    document
        .querySelector(`[data-info-target="${targetId}"]`)
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await flushAsyncWork();
}

function getLastSavedSettings() {
    const calls = mockRefs.storageSyncSet.mock.calls;
    return calls[calls.length - 1]?.[0] || null;
}

function getLastRuntimeMessage() {
    const calls = mockRefs.sendMessageToTab.mock.calls;
    return calls[calls.length - 1]?.[1] || null;
}

describe("popup feature flags", () => {
    let warnSpy;
    let errorSpy;

    beforeEach(() => {
        vi.useFakeTimers();

        document.body.innerHTML = "";

        mockRefs.storageSyncGet.mockReset();
        mockRefs.storageSyncSet.mockReset();
        mockRefs.queryTabs.mockReset();
        mockRefs.sendMessageToTab.mockReset();

        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();

        warnSpy.mockRestore();
        errorSpy.mockRestore();

        document.body.innerHTML = "";
    });

    it.each(POPUP_FLAG_IDS)(
        "loads %s as disabled when storage value is false",
        async (flagId) => {
            await importPopupWithSettings({
                [flagId]: false,
            });

            expect(document.getElementById(flagId).checked).toBe(false);
        }
    );

    it.each(POPUP_FLAG_IDS)(
        "loads %s as enabled when storage value is true",
        async (flagId) => {
            await importPopupWithSettings({
                [flagId]: true,
            });

            expect(document.getElementById(flagId).checked).toBe(true);
        }
    );

    it.each(POPUP_FLAG_IDS)(
        "saves and sends %s=false when disabled in the popup",
        async (flagId) => {
            await importPopupWithSettings({
                historyKeptExchanges: 3,
                enableDebugLogging: true,
                [flagId]: true,
            });

            mockRefs.storageSyncSet.mockClear();
            mockRefs.sendMessageToTab.mockClear();

            await changeCheckbox(flagId, false);

            expect(getLastSavedSettings()).toMatchObject({
                historyKeptExchanges: 3,
                autoPrune: true,
                [flagId]: false,
            });

            expect(getLastRuntimeMessage()).toMatchObject({
                action: "settings-updated",
                historyKeptExchanges: 3,
                autoPrune: true,
                [flagId]: false,
            });
        }
    );

    it.each(POPUP_FLAG_IDS)(
        "saves and sends %s=true when enabled in the popup",
        async (flagId) => {
            await importPopupWithSettings({
                historyKeptExchanges: 3,
                enableDebugLogging: true,
                [flagId]: false,
            });

            mockRefs.storageSyncSet.mockClear();
            mockRefs.sendMessageToTab.mockClear();

            await changeCheckbox(flagId, true);

            expect(getLastSavedSettings()).toMatchObject({
                historyKeptExchanges: 3,
                autoPrune: true,
                [flagId]: true,
            });

            expect(getLastRuntimeMessage()).toMatchObject({
                action: "settings-updated",
                historyKeptExchanges: 3,
                autoPrune: true,
                [flagId]: true,
            });
        }
    );

    it("debounces rapid popup setting changes into one save", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
            enablePruning: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchCheckboxChange("enablePruning", false);
        dispatchCheckboxChange("enableCodeBlockScrollbars", false);
        dispatchCheckboxChange("enableUserMessageClamp", false);

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();
        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();

        await flushDebouncedSave();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(mockRefs.sendMessageToTab).toHaveBeenCalledTimes(1);

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 3,
            autoPrune: true,
            enablePruning: false,
            enableCodeBlockScrollbars: false,
            enableUserMessageClamp: false,
        });

        expect(getLastRuntimeMessage()).toMatchObject({
            action: "settings-updated",
            historyKeptExchanges: 3,
            autoPrune: true,
            enablePruning: false,
            enableCodeBlockScrollbars: false,
            enableUserMessageClamp: false,
        });
    });

    it("debounces rapid history input changes and saves only the final value", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("4");
        dispatchHistoryKeptExchangesInput("5");
        dispatchHistoryKeptExchangesInput("6");

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();
        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();

        await flushDebouncedSave();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(mockRefs.sendMessageToTab).toHaveBeenCalledTimes(1);
        expect(document.getElementById("historyKeptExchanges").value).toBe("6");

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 6,
            autoPrune: true,
        });

        expect(getLastRuntimeMessage()).toMatchObject({
            action: "settings-updated",
            historyKeptExchanges: 6,
            autoPrune: true,
        });
    });

    it("debug-only flags are hidden when debug logging is disabled", async () => {
        await importPopupWithSettings({
            enableDebugLogging: false,
        });

        expect(document.getElementById("debugSection").hidden).toBe(true);
    });

    it("debug-only flags are visible when debug logging is enabled", async () => {
        await importPopupWithSettings({
            enableDebugLogging: true,
        });

        expect(document.getElementById("debugSection").hidden).toBe(false);
    });

    it("hides debug action buttons in production even when debug logging is enabled", async () => {
        await importPopupWithSettings({
            enableDebugLogging: true,
        });

        expect(document.getElementById("debugSection").hidden).toBe(false);
        expect(document.getElementById("debugButtons").hidden).toBe(true);
    });

    it("shows debug action buttons in dev builds when debug logging is enabled", async () => {
        await importPopupWithSettings(
            {
                enableDebugLogging: true,
            },
            {
                dev: true,
            }
        );

        expect(document.getElementById("debugSection").hidden).toBe(false);
        expect(document.getElementById("debugButtons").hidden).toBe(false);
    });

    it("does not send debug actions in production even if the button is clicked", async () => {
        await importPopupWithSettings({
            enableDebugLogging: true,
        });

        mockRefs.sendMessageToTab.mockClear();

        await clickButton("logDebugState");

        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();
        expect(document.getElementById("status").textContent).toBe(
            "Debug actions are unavailable in production builds"
        );
    });

    it("sends debug actions in dev builds", async () => {
        await importPopupWithSettings(
            {
                enableDebugLogging: true,
            },
            {
                dev: true,
            }
        );

        mockRefs.sendMessageToTab.mockClear();

        await clickButton("logDebugState");

        expect(mockRefs.sendMessageToTab).toHaveBeenCalledWith(123, {
            action: "debug-log-state",
        });
        expect(document.getElementById("status").textContent).toBe(
            "Logged debug state"
        );
    });

    it("shows popup action errors without calling console.error", async () => {
        await importPopupWithSettings({
            enableDebugLogging: false,
        });

        mockRefs.storageSyncSet.mockRejectedValueOnce(new Error("storage failed"));

        dispatchCheckboxChange("enablePruning", false);
        await flushDebouncedSave();

        expect(document.getElementById("status").textContent).toBe(
            "storage failed"
        );
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs popup action errors only when debug logging is enabled", async () => {
        await importPopupWithSettings({
            enableDebugLogging: true,
        });

        mockRefs.storageSyncSet.mockRejectedValueOnce(new Error("storage failed"));

        dispatchCheckboxChange("enablePruning", false);
        await flushDebouncedSave();

        expect(document.getElementById("status").textContent).toBe(
            "storage failed"
        );
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("toggles info panels from info buttons", async () => {
        await importPopupWithSettings();

        const button = document.querySelector(
            '[data-info-target="enablePruningInfo"]'
        );
        const panel = document.getElementById("enablePruningInfo");

        expect(panel.hidden).toBe(true);
        expect(button.getAttribute("aria-expanded")).toBe("false");

        await clickInfoButton("enablePruningInfo");

        expect(panel.hidden).toBe(false);
        expect(button.getAttribute("aria-expanded")).toBe("true");

        await clickInfoButton("enablePruningInfo");

        expect(panel.hidden).toBe(true);
        expect(button.getAttribute("aria-expanded")).toBe("false");
    });

    it("ignores malformed info buttons safely", async () => {
        await importPopupWithSettings();

        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-info-target", "missing-panel");
        document.body.appendChild(button);

        expect(() => {
            button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }).not.toThrow();

        await flushAsyncWork();
    });

    it("normalizes empty history input to the default and keeps auto-prune enabled", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        await changeHistoryKeptExchanges("");

        expect(document.getElementById("historyKeptExchanges").value).toBe("10");

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 10,
            autoPrune: true,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        expect(getLastRuntimeMessage()).toMatchObject({
            action: "settings-updated",
            historyKeptExchanges: 10,
            autoPrune: true,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });
    });

    it("normalizes invalid history input to the default and keeps auto-prune enabled", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        await changeHistoryKeptExchanges("0");

        expect(document.getElementById("historyKeptExchanges").value).toBe("10");
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 10,
            autoPrune: true,
        });
    });

    it("normalizes decimal history input down to an integer", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        await changeHistoryKeptExchanges("4.9");

        expect(document.getElementById("historyKeptExchanges").value).toBe("4");
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 4,
            autoPrune: true,
        });
    });

    it("loads missing historyKeptExchanges as the default minimum-supported value", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: null,
        });

        expect(document.getElementById("historyKeptExchanges").value).toBe("10");
    });

    it("loads store read optimization as enabled from shared defaults on fresh storage", async () => {
        await importPopupWithSettings();

        expect(document.getElementById("enableStoreReadOptimization").checked).toBe(
            true
        );
    });

    it("passes shared defaults to storage when loading popup settings", async () => {
        await importPopupWithSettings();

        expect(mockRefs.storageSyncGet).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    });

    it("debounces rapid mixed popup changes into one final merged save", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
            enablePruning: true,
            enableDebugLogging: false,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("4");
        dispatchHistoryKeptExchangesInput("8");
        dispatchCheckboxChange("enablePruning", false);
        dispatchCheckboxChange("enableCodeBlockScrollbars", false);
        dispatchCheckboxChange("enableDebugLogging", true);
        dispatchCheckboxChange("enableStoreReadOptimization", false);
        dispatchCheckboxChange("enableStoreReadOptimization", true);

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();
        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();

        await flushDebouncedSave();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(mockRefs.sendMessageToTab).toHaveBeenCalledTimes(1);

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 8,
            autoPrune: true,
            enablePruning: false,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: false,
            enableUserMessageClamp: true,
        });

        expect(getLastRuntimeMessage()).toMatchObject({
            action: "settings-updated",
            historyKeptExchanges: 8,
            autoPrune: true,
            enablePruning: false,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: false,
            enableUserMessageClamp: true,
        });
    });

    it("keeps resetting the debounce window until popup changes settle", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
            enablePruning: true,
            enableCodeBlockScrollbars: true,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchCheckboxChange("enablePruning", false);

        await vi.advanceTimersByTimeAsync(SAVE_SETTINGS_DEBOUNCE_MS - 1);
        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();

        dispatchCheckboxChange("enableCodeBlockScrollbars", false);

        await vi.advanceTimersByTimeAsync(SAVE_SETTINGS_DEBOUNCE_MS - 1);
        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(mockRefs.sendMessageToTab).toHaveBeenCalledTimes(1);

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 3,
            autoPrune: true,
            enablePruning: false,
            enableCodeBlockScrollbars: false,
        });
    });

    it("flushes pending history input save when the popup loses focus", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("7");

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();
        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();

        window.dispatchEvent(new Event("blur"));

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(mockRefs.sendMessageToTab).toHaveBeenCalledTimes(1);
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 7,
            autoPrune: true,
        });
    });

    it("flushes pending history input save on pagehide", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("8");

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();

        window.dispatchEvent(new Event("pagehide"));

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 8,
            autoPrune: true,
        });
    });

    it("flushes pending history input save on beforeunload", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("9");

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();

        window.dispatchEvent(new Event("beforeunload"));

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 9,
            autoPrune: true,
        });
    });

    it("flushes pending history input save when the history field blurs", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("11");

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();

        document
            .getElementById("historyKeptExchanges")
            .dispatchEvent(new FocusEvent("blur", { bubbles: true }));

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: 11,
            autoPrune: true,
        });
    });

    it("normalizes pending invalid history input when the popup closes", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        dispatchHistoryKeptExchangesInput("not-a-number");

        await flushAsyncWork();

        window.dispatchEvent(new Event("blur"));

        await flushAsyncWork();

        expect(document.getElementById("historyKeptExchanges").value).toBe(
            String(DEFAULT_SETTINGS.historyKeptExchanges)
        );
        expect(mockRefs.storageSyncSet).toHaveBeenCalledTimes(1);
        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: DEFAULT_SETTINGS.historyKeptExchanges,
            autoPrune: true,
        });
    });

    it("does not save again on close when there is no pending debounced change", async () => {
        await importPopupWithSettings({
            historyKeptExchanges: 3,
        });

        mockRefs.storageSyncSet.mockClear();
        mockRefs.sendMessageToTab.mockClear();

        window.dispatchEvent(new Event("blur"));

        await flushAsyncWork();

        expect(mockRefs.storageSyncSet).not.toHaveBeenCalled();
        expect(mockRefs.sendMessageToTab).not.toHaveBeenCalled();
    });
});