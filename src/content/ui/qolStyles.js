import { debugLog } from "../core/logger.js";
import { state } from "../core/state.js";

const BASE_STYLE_ID = "thread-optimizer-qol-style";
const CODE_SCROLLBARS_STYLE_ID = "thread-optimizer-code-scrollbars-style";

const USER_MESSAGE_CLAMP_STYLE_ID = "thread-optimizer-user-message-clamp-style";

const USER_MESSAGE_CLAMP_CSS = `
section[data-turn="user"] [data-message-author-role="user"] {
    max-height: none !important;
    overflow: visible !important;
}

section[data-turn="user"] [data-message-author-role="user"] .whitespace-pre-wrap {
    max-height: 30vh;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
}
`;

const BASE_QOL_CSS = `
section[data-thread-optimizer-out-of-window="true"] {
    display: none !important;
}

html[data-thread-optimizer-sections-offscreen="true"] section[data-testid^="conversation-turn-"],
html[data-thread-optimizer-sections-offscreen="true"] section[data-turn] {
    content-visibility: auto;
    contain-intrinsic-size: auto 160px;
}

html[data-thread-optimizer-sections-offscreen="true"] section[data-thread-optimizer-offscreen-live="true"] {
    content-visibility: visible;
    contain-intrinsic-size: none;
}

html[data-thread-optimizer-sections-offscreen="true"] section pre[data-thread-optimizer-large-code-live="true"] {
    content-visibility: auto;
    contain-intrinsic-size: auto 240px;
}

section pre[data-thread-optimizer-code-collapsed="true"] {
    display: none !important;
}

[data-thread-optimizer-code-placeholder="true"] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-sizing: border-box;
    width: 100%;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid rgba(127, 127, 127, 0.2);
    border-radius: 12px;
    background: rgba(127, 127, 127, 0.08);
    color: inherit;
    font-size: 13px;
    line-height: 1.4;
}

[data-thread-optimizer-code-placeholder="true"][hidden] {
    display: none !important;
}

[data-thread-optimizer-code-placeholder-label="true"] {
    flex: 1 1 auto;
    min-width: 0;
    font-style: italic;
    opacity: 0.9;
}

[data-thread-optimizer-code-placeholder-actions="true"] {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
}

[data-thread-optimizer-code-placeholder="true"] button {
    appearance: none;
    border: 1px solid rgba(127, 127, 127, 0.28);
    background: transparent;
    color: inherit;
    border-radius: 10px;
    padding: 6px 10px;
    font: inherit;
    line-height: 1.2;
    cursor: pointer;
}

[data-thread-optimizer-code-placeholder="true"] button:hover {
    background: rgba(127, 127, 127, 0.12);
}

[data-thread-optimizer-code-placeholder="true"] button:focus-visible {
    outline: 2px solid rgba(127, 127, 127, 0.35);
    outline-offset: 2px;
}
`;

const CODE_SCROLLBARS_CSS = `
section pre {
    display: block;
    position: relative;
    z-index: 0;
    clear: both;
    box-sizing: border-box;
    max-width: 100%;
    max-height: 30vh;
    overflow-x: auto;
    overflow-y: auto;
    contain: layout paint;
}

section pre:has(.cm-editor) {
    max-height: none;
    overflow: visible;
    contain: none;
}

section pre .cm-editor {
    display: block;
    box-sizing: border-box;
    max-width: 100%;
}

section pre .cm-scroller {
    box-sizing: border-box;
    max-height: 30vh;
    overflow-x: auto;
    overflow-y: auto;
}

section pre .cm-content,
section pre .cm_content {
    box-sizing: border-box;
    max-height: none !important;
    overflow: visible !important;
    contain: none !important;
}
`;

function ensureStyleElement(id, text) {
    let styleEl = document.getElementById(id);
    if (styleEl) return styleEl;

    styleEl = document.createElement("style");
    styleEl.id = id;
    styleEl.textContent = text;
    (document.head || document.documentElement).appendChild(styleEl);

    return styleEl;
}

export function ensureQolStyles() {
    const styleEl = ensureStyleElement(BASE_STYLE_ID, BASE_QOL_CSS);
    debugLog("QoL styles: installed");
    return styleEl;
}

export function syncCodeBlockScrollbarStyles() {
    if (state.settings.enableCodeBlockScrollbars) {
        ensureStyleElement(CODE_SCROLLBARS_STYLE_ID, CODE_SCROLLBARS_CSS);
        debugLog("Code scrollbar styles: installed");
        return;
    }

    document.getElementById(CODE_SCROLLBARS_STYLE_ID)?.remove();
    debugLog("Code scrollbar styles: removed");
}

export function removeQolStyles() {
    document.getElementById(BASE_STYLE_ID)?.remove();
    document.getElementById(CODE_SCROLLBARS_STYLE_ID)?.remove();
    document.getElementById(USER_MESSAGE_CLAMP_STYLE_ID)?.remove();
    debugLog("QoL styles: removed");
}

export function getQolStyleText() {
    return BASE_QOL_CSS;
}

export function getCodeBlockScrollbarStyleText() {
    return CODE_SCROLLBARS_CSS;
}

export function syncUserMessageClampStyles() {
    if (state.settings.enableUserMessageClamp) {
        ensureStyleElement(USER_MESSAGE_CLAMP_STYLE_ID, USER_MESSAGE_CLAMP_CSS);
        debugLog("User message clamp styles: installed");
        return;
    }

    document.getElementById(USER_MESSAGE_CLAMP_STYLE_ID)?.remove();
    debugLog("User message clamp styles: removed");
}

export function getUserMessageClampStyleText() {
    return USER_MESSAGE_CLAMP_CSS;
}