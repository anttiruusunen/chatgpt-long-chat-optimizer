import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    installChatStorePageBridgeBootstrap,
    getPageBridgeScriptId,
    getPageBridgeScriptPath,
} from "../../src/content/bridge/bridgeBootstrap.js";

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

        if (originalChrome === undefined) {
            delete globalThis.chrome;
        } else {
            globalThis.chrome = originalChrome;
        }

        if (originalBrowser === undefined) {
            delete globalThis.browser;
        } else {
            globalThis.browser = originalBrowser;
        }
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
});