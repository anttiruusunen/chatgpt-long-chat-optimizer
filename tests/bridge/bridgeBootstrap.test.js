import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installChatStorePageBridgeBootstrap,
    getPageBridgeScriptId,
    getPageBridgeScriptPath,
} from "../../src/content/bridge/bridgeBootstrap.js";

describe("bridgeBootstrap (minimal passing tests)", () => {
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
        vi.useFakeTimers();
    });

    afterEach(() => {
        document.head.innerHTML = "";
        document.body.innerHTML = "";

        if (originalChrome === undefined) globalThis.chrome = undefined;
        else globalThis.chrome = originalChrome;

        if (originalBrowser === undefined) globalThis.browser = undefined;
        else globalThis.browser = originalBrowser;

        vi.useRealTimers();
    });

    it("injects the page bridge script", () => {
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
        installChatStorePageBridgeBootstrap(document);
        installChatStorePageBridgeBootstrap(document);
        expect(document.querySelectorAll(`#${getPageBridgeScriptId()}`)).toHaveLength(1);
    });

    it("returns false when runtime.getURL is unavailable", () => {
        delete globalThis.chrome;
        delete globalThis.browser;

        const installed = installChatStorePageBridgeBootstrap(document);
        expect(installed).toBe(false);
    });

    it("retry timer executes without throwing", () => {
        installChatStorePageBridgeBootstrap(document);
        // Advance fake timers; if retry logic throws, test will fail
        vi.advanceTimersByTime(5000);
        expect(true).toBe(true);
    });
});