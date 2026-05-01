import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest";
import {
    installChatStorePageBridgeBootstrap,
    getPageBridgeScriptId,
    getPageBridgeScriptPath,
} from "../../src/content/bridge/bridgeBootstrap.js";
import * as pageBridgeSync from "../../src/content/core/pageBridgeSync.js";

describe("bridgeBootstrap", () => {
    const originalChrome = globalThis.chrome;
    const originalBrowser = globalThis.browser;

    beforeEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";

        globalThis.chrome = {
            runtime: {
                getURL: vi.fn((value) => `chrome-extension://testid/${value}`),
            },
        };

        delete globalThis.browser;
    });

    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";

        if (originalChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = originalChrome;

        if (originalBrowser === undefined) delete globalThis.browser;
        else globalThis.browser = originalBrowser;

        delete window.__threadOptimizerChatStoreBridge;
    });

    it("injects the page bridge script by extension URL", () => {
        const installed = installChatStorePageBridgeBootstrap(document);
        expect(installed).toBe(true);

        const script = document.getElementById(getPageBridgeScriptId());
        expect(script).not.toBeNull();
        expect(script.tagName).toBe("SCRIPT");
        expect(script.getAttribute("src")).toBe(
            "chrome-extension://testid/" + getPageBridgeScriptPath()
        );
    });

    it("does not inject the script twice", () => {
        const first = installChatStorePageBridgeBootstrap(document);
        const second = installChatStorePageBridgeBootstrap(document);

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(document.querySelectorAll(`#${getPageBridgeScriptId()}`)).toHaveLength(1);
    });

    it("returns false when runtime.getURL is unavailable", () => {
        delete globalThis.chrome;
        delete globalThis.browser;

        const installed = installChatStorePageBridgeBootstrap(document);
        expect(installed).toBe(false);
        expect(document.getElementById(getPageBridgeScriptId())).toBeNull();
    });

    it("bridge object can be created in test environment", () => {
        installChatStorePageBridgeBootstrap(document);

        // Mock the bridge object as the injected script would
        window.__threadOptimizerChatStoreBridge = {
            __installed: true,
            applyStoreReadOptimization: () => {},
            setKnownPruningState: () => {},
        };

        const bridge = window.__threadOptimizerChatStoreBridge;
        expect(bridge).toBeDefined();
        expect(bridge.__installed).toBe(true);
        expect(typeof bridge.applyStoreReadOptimization).toBe("function");
    });

    it("ignores messages from other origins", () => {
        installChatStorePageBridgeBootstrap(document);
        window.__threadOptimizerChatStoreBridge = { __installed: true };

        const postMessageSpy = vi.spyOn(window, "postMessage");

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    source: "thread-optimizer",
                    type: "thread-optimizer:set-pruning-state",
                    enabled: true,
                    prunedTurnCount: 5,
                },
                origin: "https://evil.com",
                source: window,
            })
        );

        expect(postMessageSpy).not.toHaveBeenCalled();
        postMessageSpy.mockRestore();
    });

    it("retries store read optimization sync using fake timers", async () => {
        vi.useFakeTimers();
        const spy = vi.spyOn(window, "postMessage");

        // Initially no bridge
        delete window.__threadOptimizerChatStoreBridge;

        const promise = pageBridgeSync.syncStoreReadOptimizationToPageWithRetry(3);

        // Advance timers so retry happens
        vi.advanceTimersByTime(200);
        // Now install the bridge
        window.__threadOptimizerChatStoreBridge = { __installed: true };
        vi.advanceTimersByTime(200);
        await promise;

        expect(spy).toHaveBeenCalledWith(
            expect.objectContaining({
                source: "thread-optimizer",
                type: "thread-optimizer:set-store-read-optimization",
            }),
            window.location.origin
        );

        spy.mockRestore();
        vi.useRealTimers();
        delete window.__threadOptimizerChatStoreBridge;
    });
});