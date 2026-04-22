import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    ensureQolStyles,
    removeQolStyles,
    getQolStyleText,
} from "../../src/content/ui/qolStyles.js";

const STYLE_ID = "thread-optimizer-qol-style";
const USER_CLAMP_SELECTOR =
    'section[data-turn="user"] [data-message-author-role="user"] > div';
const OUT_OF_WINDOW_SELECTOR =
    'section[data-thread-optimizer-out-of-window="true"]';

const SECTIONS_OFFSCREEN_ROOT_SELECTOR =
    'html[data-thread-optimizer-sections-offscreen="true"] section[data-testid^="conversation-turn-"]';
const SECTIONS_OFFSCREEN_TURN_SELECTOR =
    'html[data-thread-optimizer-sections-offscreen="true"] section[data-turn]';
const LIVE_OVERRIDE_SELECTOR =
    'html[data-thread-optimizer-sections-offscreen="true"] section[data-thread-optimizer-offscreen-live="true"]';

describe("qolStyles", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        document.documentElement.removeAttribute("data-thread-optimizer-sections-offscreen");
    });

    afterEach(() => {
        removeQolStyles();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        document.documentElement.removeAttribute("data-thread-optimizer-sections-offscreen");
    });

    it("installs the QoL style tag once", () => {
        const first = ensureQolStyles();
        const second = ensureQolStyles();

        expect(first).toBe(second);
        expect(document.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
    });

    it("contains the CSS visibility-window hide rule", () => {
        ensureQolStyles();

        const styleEl = document.getElementById(STYLE_ID);
        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(OUT_OF_WINDOW_SELECTOR);
        expect(styleEl.textContent).toContain("display: none !important");
    });

    it("contains the CSS-driven section offscreen rules", () => {
        ensureQolStyles();

        const styleEl = document.getElementById(STYLE_ID);
        expect(styleEl).not.toBeNull();

        expect(styleEl.textContent).toContain(SECTIONS_OFFSCREEN_ROOT_SELECTOR);
        expect(styleEl.textContent).toContain(SECTIONS_OFFSCREEN_TURN_SELECTOR);
        expect(styleEl.textContent).toContain("content-visibility: auto");
        expect(styleEl.textContent).toContain("contain-intrinsic-size: auto 160px");
    });

    it("contains the live-section override rule", () => {
        ensureQolStyles();

        const styleEl = document.getElementById(STYLE_ID);
        expect(styleEl).not.toBeNull();

        expect(styleEl.textContent).toContain(LIVE_OVERRIDE_SELECTOR);
        expect(styleEl.textContent).toContain("content-visibility: visible");
        expect(styleEl.textContent).toContain("contain-intrinsic-size: none");
    });

    it("contains the narrowed user clamp rule", () => {
        ensureQolStyles();

        const styleEl = document.getElementById(STYLE_ID);
        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(USER_CLAMP_SELECTOR);
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-y: auto");
    });

    it("contains the code block clamp rule", () => {
        ensureQolStyles();

        const styleEl = document.getElementById(STYLE_ID);
        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain("section pre");
        expect(styleEl.textContent).toContain("section .cm-content");
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-x: auto");
        expect(styleEl.textContent).toContain("overflow-y: auto");
    });

    it("getQolStyleText exposes the CSS-driven offscreen selectors", () => {
        const css = getQolStyleText();

        expect(css).toContain(SECTIONS_OFFSCREEN_ROOT_SELECTOR);
        expect(css).toContain(SECTIONS_OFFSCREEN_TURN_SELECTOR);
        expect(css).toContain(LIVE_OVERRIDE_SELECTOR);
    });

    it("contains the live large code block CSS rule", () => {
        ensureQolStyles();

        const styleEl = document.getElementById("thread-optimizer-qol-style");
        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section pre[data-thread-optimizer-large-code-live="true"]'
        );
        expect(styleEl.textContent).toContain("content-visibility: auto");
        expect(styleEl.textContent).toContain("contain-intrinsic-size: auto 240px");
    });
});