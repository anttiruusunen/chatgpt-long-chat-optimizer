import { state } from "../core/state.js";

const PREFIX = "[Thread Optimizer]";
const SESSION_START = performance.now();

/**
 * Returns a consistent timestamped prefix for all debug logs.
 * Helps correlate events relative to content script startup.
 */
function getElapsedLabel() {
    const elapsed = Math.round(performance.now() - SESSION_START);
    return `${PREFIX} +${elapsed}ms`;
}

/**
 * Debug logging utility.
 * No-op when debug logging is disabled.
 */
export function debugLog(message, data) {
    if (!state.debugLoggingEnabled) return;

    const prefix = getElapsedLabel();

    if (data === undefined) {
        console.log(prefix, message);
        return;
    }

    console.log(prefix, message, data);
}

/**
 * Groups related debug logs under a collapsible console group.
 * Executes the provided function regardless of logging state.
 */
export function debugGroup(label, fn) {
    if (!state.debugLoggingEnabled) {
        return fn();
    }

    const prefix = getElapsedLabel();
    console.group(`${prefix} ${label}`);

    try {
        return fn();
    } finally {
        console.groupEnd();
    }
}