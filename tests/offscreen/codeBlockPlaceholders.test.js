import { describe, it, expect, beforeEach } from "vitest";

import { state, CODE_BLOCK_PLACEHOLDER_ATTR } from "../../src/content/core/state.js";
import {
    getCodeBlockTextLength,
    isLargeCodeBlock,
    createCodeBlockPlaceholder,
    getPlaceholderId,
    ensurePlaceholderId,
    getPlaceholderIdForPre,
    setPlaceholderIdForPre,
    clearPlaceholderIdForPre,
    getPlaceholderById,
    getRevealButtonForPlaceholder,
    ensurePlaceholderForPre,
    setPlaceholderVisibility,
    isPlaceholderHidden,
} from "../../src/content/offscreen/codeBlockPlaceholders.js";

function makePre(text = "") {
    const pre = document.createElement("pre");
    pre.textContent = text;
    return pre;
}

describe("codeBlockPlaceholders", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        state.featureFlags.largeCodeBlockOptimization = true;
        state.nextDetachedCodeBlockId = 1;
    });

    it("counts code block text length", () => {
        expect(getCodeBlockTextLength(makePre("abc"))).toBe(3);
        expect(getCodeBlockTextLength(makePre(""))).toBe(0);
    });

    it("treats only meaningful pre content as collapsible when feature flag is enabled", () => {
        expect(isLargeCodeBlock(makePre(""))).toBe(false);
        expect(isLargeCodeBlock(makePre("   \n\t  "))).toBe(false);
        expect(isLargeCodeBlock(makePre("\u200B\uFEFF"))).toBe(false);
        expect(isLargeCodeBlock(makePre("abc"))).toBe(true);
        expect(isLargeCodeBlock(makePre("x".repeat(1000)))).toBe(true);
    });

    it("returns false for code blocks when feature flag is disabled", () => {
        state.featureFlags.largeCodeBlockOptimization = false;
        expect(isLargeCodeBlock(makePre("abc"))).toBe(false);
    });

    it("creates a placeholder with a static label", () => {
        const placeholder = createCodeBlockPlaceholder();

        expect(placeholder.getAttribute(CODE_BLOCK_PLACEHOLDER_ATTR)).toBe("true");
        expect(placeholder.textContent).toContain("Code block hidden");
        expect(placeholder.textContent).toContain("Show code block");
        expect(placeholder.textContent).not.toContain("Copy code");
    });

    it("assigns and reads placeholder ids", () => {
        const placeholder = document.createElement("div");

        expect(getPlaceholderId(placeholder)).toBe(null);

        const id = ensurePlaceholderId(placeholder);
        expect(id).toBe("1");
        expect(getPlaceholderId(placeholder)).toBe("1");
    });

    it("assigns and clears placeholder ids for pre elements", () => {
        const pre = makePre("abc");

        expect(getPlaceholderIdForPre(pre)).toBe(null);

        setPlaceholderIdForPre(pre, "12");
        expect(getPlaceholderIdForPre(pre)).toBe("12");

        clearPlaceholderIdForPre(pre);
        expect(getPlaceholderIdForPre(pre)).toBe(null);
    });

    it("finds a placeholder by id from the document", () => {
        const placeholder = createCodeBlockPlaceholder();
        document.body.appendChild(placeholder);

        expect(getPlaceholderById(getPlaceholderId(placeholder))).toBe(placeholder);
    });

    it("keeps the placeholder label static when updated", () => {
        const wrapper = document.createElement("div");
        const pre = makePre("const a = 1;");
        wrapper.appendChild(pre);
        document.body.appendChild(wrapper);

        const placeholder = ensurePlaceholderForPre(pre);

        expect(placeholder.textContent).toContain("Code block hidden");
        expect(placeholder.textContent).toContain("Show code block");
        expect(placeholder.textContent).not.toContain("Copy code");
    });

    it("ensures placeholder is inserted before the pre and reuses it", () => {
        const wrapper = document.createElement("div");
        const pre = makePre("const a = 1;");
        wrapper.appendChild(pre);
        document.body.appendChild(wrapper);

        const firstPlaceholder = ensurePlaceholderForPre(pre);
        const secondPlaceholder = ensurePlaceholderForPre(pre);

        expect(firstPlaceholder).toBe(secondPlaceholder);
        expect(wrapper.firstChild).toBe(firstPlaceholder);
        expect(wrapper.lastChild).toBe(pre);
    });

    it("toggles placeholder visibility without removing the node", () => {
        const placeholder = createCodeBlockPlaceholder();
        document.body.appendChild(placeholder);

        expect(isPlaceholderHidden(placeholder)).toBe(false);

        setPlaceholderVisibility(placeholder, false);
        expect(isPlaceholderHidden(placeholder)).toBe(true);
        expect(placeholder.isConnected).toBe(true);

        setPlaceholderVisibility(placeholder, true);
        expect(isPlaceholderHidden(placeholder)).toBe(false);
    });

    it("reuses and re-shows an existing hidden placeholder for the same pre", () => {
        const wrapper = document.createElement("div");
        const pre = makePre("const a = 1;");
        wrapper.appendChild(pre);
        document.body.appendChild(wrapper);

        const placeholder = ensurePlaceholderForPre(pre);
        setPlaceholderVisibility(placeholder, false);

        const reused = ensurePlaceholderForPre(pre);

        expect(reused).toBe(placeholder);
        expect(isPlaceholderHidden(placeholder)).toBe(false);
        expect(getRevealButtonForPlaceholder(placeholder)).not.toBe(null);
    });
});