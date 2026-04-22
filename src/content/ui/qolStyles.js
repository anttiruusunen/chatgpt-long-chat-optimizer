import { debugLog } from "../core/logger.js";

const STYLE_ID = "thread-optimizer-qol-style";

const QOL_CSS = `
/* immediately hide old visible sections once JS marks them as out-of-window */
section[data-thread-optimizer-out-of-window="true"] {
    display: none !important;
}

/*
 * CSS-driven offscreen optimization for normal conversation sections.
 * JS toggles the root enable flag plus a small per-section
 * "live override" for the newest assistant section.
 */
html[data-thread-optimizer-sections-offscreen="true"] section[data-testid^="conversation-turn-"],
html[data-thread-optimizer-sections-offscreen="true"] section[data-turn] {
    content-visibility: auto;
    contain-intrinsic-size: auto 160px;
}

html[data-thread-optimizer-sections-offscreen="true"] section[data-thread-optimizer-offscreen-live="true"] {
    content-visibility: visible;
    contain-intrinsic-size: none;
}

/*
 * Hybrid code-block model:
 * - old large blocks are usually detached out of DOM by JS
 * - any large block that remains live in DOM still benefits from CSS
 */
html[data-thread-optimizer-sections-offscreen="true"] section pre[data-thread-optimizer-large-code-live="true"] {
    content-visibility: auto;
    contain-intrinsic-size: auto 240px;
}

/* clamp only the intended user message content box */
section[data-turn="user"] [data-message-author-role="user"] > div {
    max-height: 30vh;
    overflow-y: auto;
}

/*
 * Clamp code blocks / editor content,
 * but keep them in normal block flow so they never visually cover text below.
 */
section pre,
section .cm-content,
section .cm_content {
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

/* collapsed live code blocks stay in DOM but should not render */
section pre[data-thread-optimizer-code-collapsed="true"] {
    display: none !important;
}

/* detached/collapsed code block placeholder */
[ data-thread-optimizer-code-placeholder="true" ],
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

function getStyleElement() {
    return document.getElementById(STYLE_ID);
}

export function ensureQolStyles() {
    let styleEl = getStyleElement();
    if (styleEl) return styleEl;

    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = QOL_CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    debugLog("QoL styles: installed");

    return styleEl;
}

export function removeQolStyles() {
    getStyleElement()?.remove();
    debugLog("QoL styles: removed");
}

export function getQolStyleText() {
    return QOL_CSS;
}