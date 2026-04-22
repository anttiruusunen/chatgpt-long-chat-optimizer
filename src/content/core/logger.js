import { state } from "../core/state.js";

const PREFIX = "[Thread Optimizer]";
const SESSION_START = performance.now();

function getElapsedLabel() {
    const elapsed = Math.round(performance.now() - SESSION_START);
    return `${PREFIX} +${elapsed}ms`;
}

export function debugLog(message, data) {
    if (!state.debugLoggingEnabled) return;

    const prefix = getElapsedLabel();

    if (data === undefined) {
        console.log(prefix, message);
        return;
    }

    console.log(prefix, message, data);
}

export function debugGroup(label, fn) {
    if (!state.debugLoggingEnabled) return fn();

    const prefix = getElapsedLabel();
    console.group(`${prefix} ${label}`);

    try {
        return fn();
    } finally {
        console.groupEnd();
    }
}