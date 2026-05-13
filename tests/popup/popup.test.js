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
        <input id="historyKeptExchanges" />
        <button id="clearHistoryKeptExchanges" type="button"></button>

        <input id="enablePruning" type="checkbox" />
        <input id="enableCodeBlockScrollbars" type="checkbox" />
        <input id="enableUserMessageClamp" type="checkbox" />
        <input id="enableDebugLogging" type="checkbox" />

        <div id="debugSection" hidden>
            <input id="enableOffscreenOptimization" type="checkbox" />
            <input id="enableStoreReadOptimization" type="checkbox" />
            <button id="logDebugState" type="button"></button>
            <button id="logDebugBuckets" type="button"></button>
            <button id="logDebugLogical" type="button"></button>
            <button id="logDebugStorePerformance" type="button"></button>
        </div>

        <div id="status"></div>
    `;
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function importPopupWithSettings(settings = {}) {
    vi.resetModules();
    createPopupDom();

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

function getLastSavedSettings() {
    const calls = mockRefs.storageSyncSet.mock.calls;
    return calls[calls.length - 1]?.[0] || null;
}

function getLastRuntimeMessage() {
    const calls = mockRefs.sendMessageToTab.mock.calls;
    return calls[calls.length - 1]?.[1] || null;
}

describe("popup feature flags", () => {
    beforeEach(() => {
        vi.useFakeTimers();

        document.body.innerHTML = "";

        mockRefs.storageSyncGet.mockReset();
        mockRefs.storageSyncSet.mockReset();
        mockRefs.queryTabs.mockReset();
        mockRefs.sendMessageToTab.mockReset();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
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

    it("empty history input disables auto-prune while preserving feature flag values", async () => {
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

        document.getElementById("historyKeptExchanges").value = "";
        document
            .getElementById("historyKeptExchanges")
            .dispatchEvent(new Event("change", { bubbles: true }));

        await flushAsyncWork();

        expect(getLastSavedSettings()).toMatchObject({
            historyKeptExchanges: null,
            autoPrune: false,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        expect(getLastRuntimeMessage()).toMatchObject({
            action: "settings-updated",
            historyKeptExchanges: null,
            autoPrune: false,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: true,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });
    });
});