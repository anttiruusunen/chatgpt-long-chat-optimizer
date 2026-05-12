import {
    PAGE_SCRIPT_TOKEN_ATTR,
    TRUSTED_SOURCE,
    MESSAGE_TYPES,
} from "./config.js";

export function getBridgeTokenFromCurrentScript() {
    const script = document.currentScript;

    if (!(script instanceof HTMLScriptElement)) {
        return null;
    }

    const token = script.getAttribute(PAGE_SCRIPT_TOKEN_ATTR);

    if (typeof token !== "string") {
        return null;
    }

    const normalized = token.trim();

    if (!/^[a-f0-9]{32}$/i.test(normalized)) {
        return null;
    }

    return normalized;
}

export function isPlainObject(value) {
    if (!value || typeof value !== "object") return false;
    return Object.getPrototypeOf(value) === Object.prototype;
}

export function isTrustedBridgeMessage(event, bridgeToken) {
    if (event.source !== window) {
        return false;
    }

    if (event.origin !== window.location.origin) {
        return false;
    }

    const data = event.data;

    if (!isPlainObject(data)) {
        return false;
    }

    if (data.source !== TRUSTED_SOURCE) {
        return false;
    }

    if (data.token !== bridgeToken) {
        return false;
    }

    if (!MESSAGE_TYPES.has(data.type)) {
        return false;
    }

    return true;
}