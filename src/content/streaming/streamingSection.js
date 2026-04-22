import { debugLog } from "../core/logger.js";
import { getConversationSections, getLatestAssistantSection } from "../core/dom.js";
import { hasResponseActions } from "./assistantSignals.js";

const STYLE_ID = "thread-optimizer-streaming-section-style";
export const STREAM_HIDDEN_ATTR = "data-thread-optimizer-stream-hidden";
export const STREAM_FORCE_VISIBLE_ATTR = "data-thread-optimizer-stream-force-visible";
export const STREAM_MARKDOWN_HIDDEN_ATTR = "data-thread-optimizer-stream-markdown-hidden";
export const STREAM_MARKDOWN_MISSING_ATTR = "data-thread-optimizer-stream-markdown-missing";
const STREAM_REVEAL_CONTROL_ATTR = "data-thread-optimizer-stream-reveal-control";
const STREAM_REVEAL_BUTTON_ATTR = "data-thread-optimizer-stream-reveal-button";
const STREAM_REVEAL_LABEL_ATTR = "data-thread-optimizer-stream-reveal-label";
const STREAM_REVEAL_FOR_ATTR = "data-thread-optimizer-stream-reveal-for";
const STREAM_REVEAL_ID_DATASET = "threadOptimizerStreamRevealId";

let nextRevealId = 1;
let streamingSectionHidingEnabled = false;

const STREAMING_SECTION_CSS = `
section[data-turn="assistant"][${STREAM_HIDDEN_ATTR}="true"] {
    position: relative;
    min-height: 56px;
}

/*
 * Prefer hiding only the streamed markdown subtree.
 * This keeps the section shell intact and narrows the style/layout blast radius.
 */
section[data-turn="assistant"][${STREAM_HIDDEN_ATTR}="true"]:not([${STREAM_FORCE_VISIBLE_ATTR}="true"]) .markdown[${STREAM_MARKDOWN_HIDDEN_ATTR}="true"] {
    display: none !important;
}

/*
 * Fallback only when no .markdown root exists yet.
 * This keeps the newest assistant hidden from the start of streaming.
 */
section[data-turn="assistant"][${STREAM_HIDDEN_ATTR}="true"][${STREAM_MARKDOWN_MISSING_ATTR}="true"]:not([${STREAM_FORCE_VISIBLE_ATTR}="true"]) > * {
    display: none !important;
}

[${STREAM_REVEAL_CONTROL_ATTR}="true"] {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 8px 0;
    padding: 10px 14px;
    border-radius: 18px;
    background: rgba(0, 0, 0, 0.06);
    font: inherit;
    line-height: 1.3;
    color: inherit;
    opacity: 0.95;
}

[${STREAM_REVEAL_LABEL_ATTR}="true"] {
    opacity: 0.9;
}

[${STREAM_REVEAL_BUTTON_ATTR}="true"] {
    border: 0;
    border-radius: 999px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.12);
    color: inherit;
    font: inherit;
    cursor: pointer;
}
`;

function getStyleElement() {
    return document.getElementById(STYLE_ID);
}

function ensureStyleElement() {
    let styleEl = getStyleElement();
    if (styleEl) return styleEl;

    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = STREAMING_SECTION_CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    return styleEl;
}

function removeStyleElement() {
    getStyleElement()?.remove();
}

function getAssistantSections() {
    return getConversationSections().filter(
        (section) => section.getAttribute("data-turn") === "assistant"
    );
}

function getStreamingMarkdownRoot(section) {
    if (!(section instanceof HTMLElement)) {
        return null;
    }

    const markdown = section.querySelector(".markdown");
    return markdown instanceof HTMLElement ? markdown : null;
}

function ensureSectionRevealId(section) {
    let id = section.dataset[STREAM_REVEAL_ID_DATASET];
    if (id) return id;

    id = String(nextRevealId++);
    section.dataset[STREAM_REVEAL_ID_DATASET] = id;
    return id;
}

function getRevealControlForSection(section) {
    const id = section?.dataset?.[STREAM_REVEAL_ID_DATASET];
    if (!id) return null;

    const control = document.querySelector(
        `[${STREAM_REVEAL_CONTROL_ATTR}="true"][${STREAM_REVEAL_FOR_ATTR}="${id}"]`
    );

    return control instanceof HTMLElement ? control : null;
}

function createRevealControl(section) {
    const id = ensureSectionRevealId(section);

    const control = document.createElement("div");
    control.setAttribute(STREAM_REVEAL_CONTROL_ATTR, "true");
    control.setAttribute(STREAM_REVEAL_FOR_ATTR, id);

    const label = document.createElement("div");
    label.setAttribute(STREAM_REVEAL_LABEL_ATTR, "true");
    label.textContent = "ChatGPT is answering…";

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(STREAM_REVEAL_BUTTON_ATTR, "true");
    button.textContent = "Show reply";
    button.addEventListener("click", () => {
        section.setAttribute(STREAM_FORCE_VISIBLE_ATTR, "true");
        const markdown = getStreamingMarkdownRoot(section);
        markdown?.removeAttribute(STREAM_MARKDOWN_HIDDEN_ATTR);
        section.removeAttribute(STREAM_MARKDOWN_MISSING_ATTR);
        removeRevealControlForSection(section);
    });

    control.appendChild(label);
    control.appendChild(button);
    return control;
}

function removeRevealControlForSection(section) {
    getRevealControlForSection(section)?.remove();
}

function ensureRevealControlForSection(section) {
    let control = getRevealControlForSection(section);
    if (control) return control;

    control = createRevealControl(section);
    section.parentElement?.insertBefore(control, section);
    return control;
}

function clearStreamingStateForSection(section) {
    const markdown = getStreamingMarkdownRoot(section);

    section.removeAttribute(STREAM_HIDDEN_ATTR);
    section.removeAttribute(STREAM_FORCE_VISIBLE_ATTR);
    section.removeAttribute(STREAM_MARKDOWN_MISSING_ATTR);
    markdown?.removeAttribute(STREAM_MARKDOWN_HIDDEN_ATTR);

    removeRevealControlForSection(section);
}

function applyStreamingStateToSection(section) {
    const markdown = getStreamingMarkdownRoot(section);

    section.setAttribute(STREAM_HIDDEN_ATTR, "true");

    if (section.getAttribute(STREAM_FORCE_VISIBLE_ATTR) === "true") {
        section.removeAttribute(STREAM_MARKDOWN_MISSING_ATTR);
        markdown?.removeAttribute(STREAM_MARKDOWN_HIDDEN_ATTR);
        removeRevealControlForSection(section);
        return;
    }

    if (markdown) {
        markdown.setAttribute(STREAM_MARKDOWN_HIDDEN_ATTR, "true");
        section.removeAttribute(STREAM_MARKDOWN_MISSING_ATTR);
    } else {
        section.setAttribute(STREAM_MARKDOWN_MISSING_ATTR, "true");
    }

    ensureRevealControlForSection(section);
}

export function getActiveStreamingSection() {
    const latestAssistant = getLatestAssistantSection();
    if (!(latestAssistant instanceof HTMLElement)) {
        return null;
    }

    if (hasResponseActions(latestAssistant)) {
        return null;
    }

    return latestAssistant;
}

export function syncStreamingSectionState() {
    const assistantSections = getAssistantSections();
    const activeSection = streamingSectionHidingEnabled
        ? getActiveStreamingSection()
        : null;

    for (const section of assistantSections) {
        if (section !== activeSection) {
            clearStreamingStateForSection(section);
            continue;
        }

        applyStreamingStateToSection(section);
    }
}

export function setStreamingSectionHidingEnabled(enabled) {
    streamingSectionHidingEnabled = Boolean(enabled);

    if (streamingSectionHidingEnabled) {
        ensureStyleElement();
        syncStreamingSectionState();
        debugLog("Streaming section: markdown-level CSS hiding enabled");
        return;
    }

    for (const section of getAssistantSections()) {
        clearStreamingStateForSection(section);
    }

    removeStyleElement();
    debugLog("Streaming section: CSS hiding disabled");
}