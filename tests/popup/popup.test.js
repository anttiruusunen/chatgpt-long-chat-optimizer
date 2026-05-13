import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
    historyKeptExchanges: 10,
    enablePruning: true,
    enableOffscreenOptimization: true,
    enableDebugLogging: false,
    enableStoreReadOptimization: false,
    enableCodeBlockScrollbars: true,
    enableUserMessageClamp: true,
};

const POPUP_FLAG_IDS = [
    "enablePruning",
    "enableOffscreenOptimization",
    "enableDebugLogging",
    "enableStoreReadOptimization",
    "enableCodeBlockScrollbars",
    "enableUserMessageClamp",
];

function createPopupDom() {
    document.body.innerHTML = `
        <input id="historyKeptExchanges" type="number" min="1" step="1" />

        <input id="enablePruning" type="checkbox" />
        <input id="enableCodeBlockScrollbars" type="checkbox" />
        <input id="enableUserMessageClamp" type="checkbox" />
        <input id="enableDebugLogging" type="checkbox" />

        <div id="debugSection" hidden>
            <input id="enableOffscreenOptimization" type="checkbox" />
            <input id="enableStoreReadOptimization" type="checkbox" />

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

async function importPopupWithSettings(settings = {}, { dev = false } = {}) {
    vi.resetModules();
    createPopupDom();

    if (dev) {
        vi.stubGlobal("__DEV__", true);
    } else {
        vi.stubGlobal("__DEV__", false);
    }

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

async function changeCheckbox(id, checked) {
    const checkbox = document.getElementById(id);

    checkbox.checked = checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    await flushAsyncWork();
}

async function changeHistoryKeptExchanges(value) {
    const input = document.getElementById("historyKeptExchanges");

    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await flushAsyncWork();
}

async function clickButton(id) {
    document
        .getElementById(id)
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

        await changeCheckbox("enablePruning", false);

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

        await changeCheckbox("enablePruning", false);

        expect(document.getElementById("status").textContent).toBe(
            "storage failed"
        );
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
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
});