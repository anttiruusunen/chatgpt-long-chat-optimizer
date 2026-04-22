const BROWSER_API_NAME = "browser";
const CHROME_API_NAME = "chrome";

function hasApiObject(name) {
    return typeof globalThis[name] === "object" && globalThis[name] !== null;
}

export function getExtensionApiName() {
    if (hasApiObject(BROWSER_API_NAME)) {
        return BROWSER_API_NAME;
    }

    if (hasApiObject(CHROME_API_NAME)) {
        return CHROME_API_NAME;
    }

    return null;
}

export function getExtensionApi() {
    const apiName = getExtensionApiName();
    return apiName ? globalThis[apiName] : null;
}

export function hasExtensionApi() {
    return getExtensionApi() !== null;
}

export function usesPromiseBasedApi() {
    return getExtensionApiName() === BROWSER_API_NAME;
}

export const ext = getExtensionApi();

function ensureExtensionApi() {
    const api = getExtensionApi();
    if (!api) {
        throw new Error("WebExtension API is unavailable in this environment");
    }
    return api;
}

function promisifyChromeCall(registerCallback) {
    return new Promise((resolve, reject) => {
        registerCallback((result) => {
            const error = globalThis.chrome?.runtime?.lastError;
            if (error) {
                reject(new Error(error.message || String(error)));
                return;
            }

            resolve(result);
        });
    });
}

function callWebExtensionMethod({
    promiseCall,
    chromeCall,
}) {
    if (usesPromiseBasedApi()) {
        return Promise.resolve(promiseCall());
    }

    return promisifyChromeCall(chromeCall);
}

function getStorageArea(areaName) {
    const api = ensureExtensionApi();
    const storageArea = api.storage?.[areaName];

    if (!storageArea) {
        throw new Error(`Storage area "${areaName}" is unavailable`);
    }

    return storageArea;
}

function storageGet(areaName, defaults) {
    const storageArea = getStorageArea(areaName);

    return callWebExtensionMethod({
        promiseCall: () => storageArea.get(defaults),
        chromeCall: (done) => storageArea.get(defaults, done),
    });
}

function storageSet(areaName, values) {
    const storageArea = getStorageArea(areaName);

    return callWebExtensionMethod({
        promiseCall: () => storageArea.set(values),
        chromeCall: (done) => storageArea.set(values, done),
    });
}

export function storageSyncGet(defaults) {
    return storageGet("sync", defaults);
}

export function storageSyncSet(values) {
    return storageSet("sync", values);
}

export function storageLocalGet(defaults) {
    return storageGet("local", defaults);
}

export function storageLocalSet(values) {
    return storageSet("local", values);
}

export function storageSessionGet(defaults) {
    return storageGet("session", defaults);
}

export function storageSessionSet(values) {
    return storageSet("session", values);
}

export function queryTabs(queryInfo) {
    const api = ensureExtensionApi();

    return callWebExtensionMethod({
        promiseCall: () => api.tabs.query(queryInfo),
        chromeCall: (done) => api.tabs.query(queryInfo, done),
    });
}

export function getTab(tabId) {
    const api = ensureExtensionApi();

    return callWebExtensionMethod({
        promiseCall: () => api.tabs.get(tabId),
        chromeCall: (done) => api.tabs.get(tabId, done),
    });
}

export function sendMessageToTab(tabId, message, options) {
    const api = ensureExtensionApi();

    return callWebExtensionMethod({
        promiseCall: () =>
            options == null
                ? api.tabs.sendMessage(tabId, message)
                : api.tabs.sendMessage(tabId, message, options),
        chromeCall: (done) =>
            options == null
                ? api.tabs.sendMessage(tabId, message, done)
                : api.tabs.sendMessage(tabId, message, options, done),
    });
}

export function runtimeGetUrl(path = "") {
    const api = ensureExtensionApi();
    const getUrl = api.runtime?.getURL;

    if (typeof getUrl !== "function") {
        throw new Error("runtime.getURL is unavailable");
    }

    return getUrl(path);
}