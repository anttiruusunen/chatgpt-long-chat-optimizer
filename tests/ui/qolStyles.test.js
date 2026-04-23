import { describe, it, expect, beforeEach } from "vitest";

import {
    ensureQolStyles,
    removeQolStyles,
    getQolStyleText,
} from "../../src/content/ui/qolStyles.js";

describe("qolStyles", () => {
    beforeEach(() => {
        document.head.innerHTML = "";
    });

    it("installs the QoL style tag once", () => {
        const first = ensureQolStyles();
        const second = ensureQolStyles();

        expect(first).toBe(second);
        expect(document.querySelectorAll("#thread-optimizer-qol-style")).toHaveLength(1);
    });

    it("contains the CSS visibility-window hide rule", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(
            'section[data-thread-optimizer-out-of-window="true"]'
        );
        expect(styleEl.textContent).toContain("display: none !important");
    });

    it("contains the CSS-driven section offscreen rules", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section[data-testid^="conversation-turn-"]'
        );
        expect(styleEl.textContent).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section[data-turn]'
        );
        expect(styleEl.textContent).toContain("content-visibility: auto");
        expect(styleEl.textContent).toContain("contain-intrinsic-size: auto 160px");
    });

    it("contains the live-section override rule", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section[data-thread-optimizer-offscreen-live="true"]'
        );
        expect(styleEl.textContent).toContain("content-visibility: visible");
        expect(styleEl.textContent).toContain("contain-intrinsic-size: none");
    });

    it("contains the narrowed user clamp rule", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();
        expect(styleEl.textContent).toContain(
            'section[data-turn="user"] [data-message-author-role="user"] > div'
        );
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-y: auto");
    });

    it("contains the code block clamp rule", () => {
        const styleEl = ensureQolStyles();

        expect(styleEl).not.toBeNull();

        expect(styleEl.textContent).toContain("section pre {");
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-x: auto");
        expect(styleEl.textContent).toContain("overflow-y: auto");
        expect(styleEl.textContent).toContain("contain: layout paint");

        expect(styleEl.textContent).toContain("section pre:has(.cm-editor)");
        expect(styleEl.textContent).toContain("section pre .cm-scroller");
        expect(styleEl.textContent).toContain("section pre .cm-content");
        expect(styleEl.textContent).toContain("max-height: 30vh");
        expect(styleEl.textContent).toContain("overflow-y: auto");
    });

    it("getQolStyleText exposes the CSS-driven offscreen selectors", () => {
        const text = getQolStyleText();

        expect(text).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section[data-testid^="conversation-turn-"]'
        );
        expect(text).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section[data-thread-optimizer-offscreen-live="true"]'
        );
    });

    it("contains the live large code block CSS rule", () => {
        const text = getQolStyleText();

        expect(text).toContain(
            'html[data-thread-optimizer-sections-offscreen="true"] section pre[data-thread-optimizer-large-code-live="true"]'
        );
        expect(text).toContain("contain-intrinsic-size: auto 240px");
    });

    it("removes the QoL style tag", () => {
        ensureQolStyles();
        removeQolStyles();

        expect(document.getElementById("thread-optimizer-qol-style")).toBeNull();
    });
});