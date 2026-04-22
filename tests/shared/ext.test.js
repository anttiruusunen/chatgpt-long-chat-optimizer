import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

async function importFreshExtModule() {
    vi.resetModules();
    return import("../../src/shared/ext.js");
}

describe("shared/ext", () => {
    const originalBrowser = globalThis.browser;
    const originalChrome = globalThis.chrome;

    beforeEach(() => {
        delete globalThis.browser;
        delete globalThis.chrome;
    });

    afterEach(() => {
        if (originalBrowser === undefined) {
            delete globalThis.browser;
        } else {
            globalThis.browser = originalBrowser;
        }

        if (originalChrome === undefined) {
            delete globalThis.chrome;
        } else {
            globalThis.chrome = originalChrome;
        }
    });

    it("prefers the browser namespace and uses promise-based APIs", async () => {
        const getSync = vi.fn(async (defaults) => ({
            ...defaults,
            enabled: true,
        }));
        const setSync = vi.fn(async (values) => values);
        const query = vi.fn(async () => [{ id: 123 }]);
        const sendMessage = vi.fn(async () => ({ ok: true }));
        const getTab = vi.fn(async (tabId) => ({ id: tabId }));
        const getURL = vi.fn((path) => `moz-extension://unit-test/${path}`);

        globalThis.browser = {
            storage: {
                sync: {
                    get: getSync,
                    set: setSync,
                },
                local: {
                    get: vi.fn(async (defaults) => defaults),
                    set: vi.fn(async (values) => values),
                },
                session: {
                    get: vi.fn(async (defaults) => defaults),
                    set: vi.fn(async (values) => values),
                },
            },
            tabs: {
                query,
                sendMessage,
                get: getTab,
            },
            runtime: {
                getURL,
            },
        };

        const {
            ext,
            getExtensionApiName,
            hasExtensionApi,
            usesPromiseBasedApi,
            storageSyncGet,
            storageSyncSet,
            queryTabs,
            sendMessageToTab,
            getTab: getTabById,
            runtimeGetUrl,
        } = await importFreshExtModule();

        expect(ext).toBe(globalThis.browser);
        expect(getExtensionApiName()).toBe("browser");
        expect(hasExtensionApi()).toBe(true);
        expect(usesPromiseBasedApi()).toBe(true);

        await expect(storageSyncGet({ enabled: false })).resolves.toEqual({ enabled: true });
        await expect(storageSyncSet({ enabled: true })).resolves.toEqual({ enabled: true });
        await expect(queryTabs({ active: true })).resolves.toEqual([{ id: 123 }]);
        await expect(sendMessageToTab(123, { action: "ping" })).resolves.toEqual({ ok: true });
        await expect(getTabById(123)).resolves.toEqual({ id: 123 });
        expect(runtimeGetUrl("popup/popup.html")).toBe("moz-extension://unit-test/popup/popup.html");

        expect(getSync).toHaveBeenCalledWith({ enabled: false });
        expect(setSync).toHaveBeenCalledWith({ enabled: true });
        expect(query).toHaveBeenCalledWith({ active: true });
        expect(sendMessage).toHaveBeenCalledWith(123, { action: "ping" });
        expect(getTab).toHaveBeenCalledWith(123);
        expect(getURL).toHaveBeenCalledWith("popup/popup.html");
    });

    it("falls back to the chrome namespace and promisifies callback-based APIs", async () => {
        globalThis.chrome = {
            runtime: {
                lastError: null,
                getURL: vi.fn((path) => `chrome-extension://unit-test/${path}`),
            },
            storage: {
                sync: {
                    get: vi.fn((defaults, done) => done({ ...defaults, count: 2 })),
                    set: vi.fn((values, done) => done(values)),
                },
                local: {
                    get: vi.fn((defaults, done) => done(defaults)),
                    set: vi.fn((values, done) => done(values)),
                },
                session: {
                    get: vi.fn((defaults, done) => done(defaults)),
                    set: vi.fn((values, done) => done(values)),
                },
            },
            tabs: {
                query: vi.fn((queryInfo, done) => done([{ id: 7, ...queryInfo }])),
                sendMessage: vi.fn((tabId, message, done) => done({ tabId, message })),
                get: vi.fn((tabId, done) => done({ id: tabId, title: "Example" })),
            },
        };

        const {
            getExtensionApiName,
            usesPromiseBasedApi,
            storageSyncGet,
            storageSyncSet,
            queryTabs,
            sendMessageToTab,
            getTab,
            runtimeGetUrl,
        } = await importFreshExtModule();

        expect(getExtensionApiName()).toBe("chrome");
        expect(usesPromiseBasedApi()).toBe(false);

        await expect(storageSyncGet({ count: 0 })).resolves.toEqual({ count: 2 });
        await expect(storageSyncSet({ enabled: true })).resolves.toEqual({ enabled: true });
        await expect(queryTabs({ active: true })).resolves.toEqual([{ id: 7, active: true }]);
        await expect(sendMessageToTab(7, { action: "ping" })).resolves.toEqual({
            tabId: 7,
            message: { action: "ping" },
        });
        await expect(getTab(7)).resolves.toEqual({ id: 7, title: "Example" });
        expect(runtimeGetUrl("popup/popup.html")).toBe("chrome-extension://unit-test/popup/popup.html");
    });

    it("rejects callback-based chrome calls when runtime.lastError is populated", async () => {
        globalThis.chrome = {
            runtime: {
                lastError: null,
                getURL: vi.fn((path) => `chrome-extension://unit-test/${path}`),
            },
            storage: {
                sync: {
                    get: vi.fn((_defaults, done) => {
                        globalThis.chrome.runtime.lastError = { message: "Storage failed" };
                        done(undefined);
                        globalThis.chrome.runtime.lastError = null;
                    }),
                    set: vi.fn((values, done) => done(values)),
                },
            },
            tabs: {
                query: vi.fn((queryInfo, done) => done([{ id: 1, ...queryInfo }])),
                sendMessage: vi.fn((tabId, message, done) => done({ tabId, message })),
                get: vi.fn((tabId, done) => done({ id: tabId })),
            },
        };

        const { storageSyncGet } = await importFreshExtModule();

        await expect(storageSyncGet({ enabled: false })).rejects.toThrow("Storage failed");
    });

    it("throws when no extension API is available", async () => {
        const {
            hasExtensionApi,
            getExtensionApiName,
            storageSyncGet,
        } = await importFreshExtModule();

        expect(hasExtensionApi()).toBe(false);
        expect(getExtensionApiName()).toBeNull();
        expect(() => storageSyncGet({ enabled: false })).toThrow(
            "WebExtension API is unavailable in this environment"
        );
    });

    it("throws when requesting an unavailable storage area", async () => {
        globalThis.browser = {
            storage: {
                sync: {
                    get: vi.fn(async (defaults) => defaults),
                    set: vi.fn(async (values) => values),
                },
            },
            tabs: {
                query: vi.fn(async () => []),
                sendMessage: vi.fn(async () => ({ ok: true })),
                get: vi.fn(async (tabId) => ({ id: tabId })),
            },
            runtime: {
                getURL: vi.fn((path) => `moz-extension://unit-test/${path}`),
            },
        };

        const { storageSessionGet } = await importFreshExtModule();

        expect(() => storageSessionGet({ foo: "bar" })).toThrow(
            'Storage area "session" is unavailable'
        );
    });
});