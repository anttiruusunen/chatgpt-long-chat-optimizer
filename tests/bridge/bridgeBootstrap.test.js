import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockRefs = vi.hoisted(() => ({
    storageSyncGet: vi.fn(),
}));

vi.mock("../../src/shared/ext.js", () => ({
    storageSyncGet: mockRefs.storageSyncGet,
}));

async function importFreshBootstrap() {
    vi.resetModules();

    return import("../../src/content/bridge/bridgeBootstrap.js");
}

function getSettingsAttribute() {
    return document.documentElement.getAttribute(
        "data-thread-optimizer-initial-load-hiding-settings"
    );
}

function parseSettingsAttribute() {
    const raw = getSettingsAttribute();

    return raw ? JSON.parse(raw) : null;
}

describe("bridgeBootstrap", () => {
    const originalChrome = globalThis.chrome;
    const originalBrowser = globalThis.browser;

    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        document.documentElement.removeAttribute(
            "data-thread-optimizer-initial-load-hiding-settings"
        );

        window.THREAD_OPTIMIZER_BRIDGE_TOKEN = undefined;

        if (window.__threadOptimizerChatStoreBridge) {
            window.__threadOptimizerChatStoreBridge.__installed = false;
        }

        globalThis.chrome = {
            runtime: {
                getURL: vi.fn((value) => `chrome-extension://testid/${value}`),
            },
        };

        delete globalThis.browser;

        mockRefs.storageSyncGet.mockReset();
        mockRefs.storageSyncGet.mockResolvedValue({
            historyKeptExchanges: 10,
            autoPrune: true,
            enablePruning: true,
            enableOffscreenOptimization: true,
            enableDebugLogging: false,
            enableStoreReadOptimization: true,
            enableCodeBlockScrollbars: true,
            enableUserMessageClamp: true,
        });

        vi.useFakeTimers();
    });

    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";
        document.documentElement.removeAttribute(
            "data-thread-optimizer-initial-load-hiding-settings"
        );

        if (originalChrome === undefined) globalThis.chrome = undefined;
        else globalThis.chrome = originalChrome;

        if (originalBrowser === undefined) globalThis.browser = undefined;
        else globalThis.browser = originalBrowser;

        mockRefs.storageSyncGet.mockReset();

        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("injects the page bridge script immediately", async () => {
        const module = await importFreshBootstrap();

        const script = document.getElementById(module.getPageBridgeScriptId());

        expect(script).not.toBeNull();
        expect(script.tagName).toBe("SCRIPT");
        expect(script.getAttribute("src")).toBe(
            "chrome-extension://testid/" + module.getPageBridgeScriptPath()
        );
        expect(script.getAttribute(
            "data-thread-optimizer-chat-store-page-bridge-token"
        )).toBe(module.getChatStorePageBridgeToken());
    });

    it("does not inject the script twice", async () => {
        const module = await importFreshBootstrap();

        module.installChatStorePageBridgeBootstrap(document);
        module.installChatStorePageBridgeBootstrap(document);

        expect(
            document.querySelectorAll(`#${module.getPageBridgeScriptId()}`)
        ).toHaveLength(1);
    });

    it("returns false when runtime.getURL is unavailable", async () => {
        delete globalThis.chrome;
        delete globalThis.browser;

        const module = await importFreshBootstrap();

        expect(module.installChatStorePageBridgeBootstrap(document)).toBe(false);
    });

    it("loads stored settings and publishes early initial-load hiding settings through the DOM channel", async () => {
        mockRefs.storageSyncGet.mockResolvedValue({
            enablePruning: true,
            historyKeptExchanges: 5,
            enableDebugLogging: true,
        });

        const events = [];
        document.addEventListener(
            "thread-optimizer:initial-load-hiding-settings",
            () => {
                events.push(parseSettingsAttribute());
            }
        );

        await importFreshBootstrap();
        await Promise.resolve();

        expect(mockRefs.storageSyncGet).toHaveBeenCalled();
        expect(parseSettingsAttribute()).toEqual({
            enabled: true,
            historyKeptExchanges: 5,
            debug: true,
        });
        expect(events).toEqual([
            {
                enabled: true,
                historyKeptExchanges: 5,
                debug: true,
            },
        ]);
    });

    it("normalizes invalid stored historyKeptExchanges to the default", async () => {
        mockRefs.storageSyncGet.mockResolvedValue({
            enablePruning: true,
            historyKeptExchanges: 0,
            enableDebugLogging: false,
        });

        await importFreshBootstrap();
        await Promise.resolve();

        expect(parseSettingsAttribute()).toEqual({
            enabled: true,
            historyKeptExchanges: 10,
            debug: false,
        });
    });

    it("publishes a disabled fallback when storage read fails", async () => {
        mockRefs.storageSyncGet.mockRejectedValue(new Error("storage failed"));

        await importFreshBootstrap();
        await Promise.resolve();

        expect(parseSettingsAttribute()).toEqual({
            enabled: false,
            historyKeptExchanges: 10,
            debug: false,
        });
    });

    it("repeats early settings dispatches for late page bridge listeners", async () => {
        mockRefs.storageSyncGet.mockResolvedValue({
            enablePruning: true,
            historyKeptExchanges: 6,
            enableDebugLogging: false,
        });

        const events = [];
        document.addEventListener(
            "thread-optimizer:initial-load-hiding-settings",
            () => {
                events.push(parseSettingsAttribute());
            }
        );

        await importFreshBootstrap();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(150);

        expect(events.length).toBeGreaterThanOrEqual(3);
        expect(events.at(-1)).toEqual({
            enabled: true,
            historyKeptExchanges: 6,
            debug: false,
        });
    });

    it("script onload marks the bootstrap global as installed", async () => {
        const module = await importFreshBootstrap();
        const script = document.getElementById(module.getPageBridgeScriptId());

        expect(window.__threadOptimizerChatStoreBridge.__installed).toBe(false);

        script.onload();

        expect(window.__threadOptimizerChatStoreBridge.__installed).toBe(true);
    });
});
