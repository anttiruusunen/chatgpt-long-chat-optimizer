import { describe, it, expect, beforeEach } from "vitest";

import {
    ensureQolStyles,
    removeQolStyles,
    getQolStyleText,
    syncCodeBlockScrollbarStyles,
    getCodeBlockScrollbarStyleText,
    syncUserMessageClampStyles,
    getUserMessageClampStyleText,
} from "../../src/content/ui/qolStyles.js";

import { state } from "../../src/content/core/state.js";

const USER_MESSAGE_CLAMP_SELECTOR =
    'section[data-turn="user"] [data-message-author-role="user"] .whitespace-pre-wrap';

const USER_MESSAGE_WRAPPER_SELECTOR =
    'section[data-turn="user"] [data-message-author-role="user"]';

const OFFSCREEN_ROOT_SELECTOR =
    'html[data-thread-optimizer-sections-offscreen="true"]';

const OFFSCREEN_SECTION_SELECTOR =
    `${OFFSCREEN_ROOT_SELECTOR} section[data-thread-optimizer-offscreen-opt="true"]`;

describe("qolStyles", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
        state.settings.enableCodeBlockScrollbars = false;
        state.settings.enableUserMessageClamp = false;
    });

    it("installs the QoL style tag once", () => {
        const first = ensureQolStyles();
        const second = ensureQolStyles();

        expect(first).toBe(second);
        expect(document.querySelectorAll("#thread-optimizer-qol-style")).toHaveLength(1);
    });

    it("contains browser-native section offscreen rules", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(OFFSCREEN_SECTION_SELECTOR);
        expect(styleEl.textContent).toContain("content-visibility: auto");
        expect(styleEl.textContent).toContain(
            "contain-intrinsic-size: auto var(--thread-optimizer-section-intrinsic-size, 160px)"
        );
    });

    it("does not include legacy CSS visibility-window hide rules", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).not.toContain(
            'section[data-thread-optimizer-out-of-window="true"]'
        );
    });

    it("does not include legacy live-section override rules", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).not.toContain(
            "data-thread-optimizer-offscreen-live"
        );
        expect(styleEl.textContent).not.toContain("content-visibility: visible");
        expect(styleEl.textContent).not.toContain("contain-intrinsic-size: none");
    });

    it("does not include legacy live large code block CSS rules", () => {
        const text = getQolStyleText();

        expect(text).not.toContain("data-thread-optimizer-large-code-live");
        expect(text).not.toContain("contain-intrinsic-size: auto 240px");
    });

    it("keeps collapsed code block CSS separate from legacy visibility-window behavior", () => {
        const text = getQolStyleText();

        expect(text).toContain(
            'section pre[data-thread-optimizer-code-collapsed="true"]'
        );
        expect(text).toContain("display: none !important");
        expect(text).not.toContain("data-thread-optimizer-out-of-window");
    });

    it("does not install user message clamp styles with base QoL styles", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).not.toContain(USER_MESSAGE_CLAMP_SELECTOR);
        expect(document.getElementById("thread-optimizer-user-message-clamp-style")).toBeNull();
    });

    it("installs and removes the conditional user message clamp style tag", () => {
        state.settings.enableUserMessageClamp = true;
        syncUserMessageClampStyles();

        const styleEl = document.getElementById("thread-optimizer-user-message-clamp-style");

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(USER_MESSAGE_WRAPPER_SELECTOR);
        expect(styleEl.textContent).toContain(USER_MESSAGE_CLAMP_SELECTOR);
        expect(styleEl.textContent).toContain("max-height: none !important");
        expect(styleEl.textContent).toContain("overflow: visible !important");
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-y: auto");
        expect(styleEl.textContent).toContain("overflow-x: hidden");
        expect(styleEl.textContent).toContain("overscroll-behavior: contain");

        state.settings.enableUserMessageClamp = false;
        syncUserMessageClampStyles();

        expect(document.getElementById("thread-optimizer-user-message-clamp-style")).toBeNull();
    });

    it("getUserMessageClampStyleText exposes only the conditional user clamp CSS", () => {
        const text = getUserMessageClampStyleText();

        expect(text).toContain(USER_MESSAGE_WRAPPER_SELECTOR);
        expect(text).toContain(USER_MESSAGE_CLAMP_SELECTOR);
        expect(text).toContain("max-height: none !important");
        expect(text).toContain("overflow: visible !important");
        expect(text).toContain("max-height: 30vh");
        expect(text).toContain("overflow-y: auto");
        expect(text).toContain("overflow-x: hidden");
        expect(text).toContain("overscroll-behavior: contain");
        expect(text).not.toContain("data-thread-optimizer-offscreen-opt");
    });

    it("does not install code block scrollbar styles with base QoL styles", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).not.toContain("section pre:has(.cm-editor)");
        expect(document.getElementById("thread-optimizer-code-scrollbars-style")).toBeNull();
    });

    it("installs and removes the conditional code block scrollbar style tag", () => {
        state.settings.enableCodeBlockScrollbars = true;
        syncCodeBlockScrollbarStyles();

        const styleEl = document.getElementById("thread-optimizer-code-scrollbars-style");

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain("section pre {");
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-x: auto");
        expect(styleEl.textContent).toContain("overflow-y: auto");
        expect(styleEl.textContent).toContain("contain: layout paint");

        expect(styleEl.textContent).toContain("section pre:has(.cm-editor)");
        expect(styleEl.textContent).toContain("section pre .cm-scroller");
        expect(styleEl.textContent).toContain("section pre .cm-content");

        state.settings.enableCodeBlockScrollbars = false;
        syncCodeBlockScrollbarStyles();

        expect(document.getElementById("thread-optimizer-code-scrollbars-style")).toBeNull();
    });

    it("getCodeBlockScrollbarStyleText exposes only the conditional code scrollbar CSS", () => {
        const text = getCodeBlockScrollbarStyleText();

        expect(text).toContain("section pre {");
        expect(text).toContain("section pre:has(.cm-editor)");
        expect(text).toContain("section pre .cm-scroller");
        expect(text).not.toContain("data-thread-optimizer-offscreen-opt");
    });

    it("getQolStyleText exposes the browser-native offscreen selector", () => {
        const text = getQolStyleText();

        expect(text).toContain(OFFSCREEN_SECTION_SELECTOR);
        expect(text).toContain("content-visibility: auto");
        expect(text).toContain(
            "var(--thread-optimizer-section-intrinsic-size, 160px)"
        );
    });

    it("removes the QoL style tag", () => {
        ensureQolStyles();
        removeQolStyles();

        expect(document.getElementById("thread-optimizer-qol-style")).toBeNull();
    });
});