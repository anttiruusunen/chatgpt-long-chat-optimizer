import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    captureActiveComposerCaret,
    restoreComposerCaretAfterDomSettles,
} from "../../src/content/ui/composerCaret.js";

async function flushRaf() {
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
}

describe("composerCaret", () => {
    let originalRAF;
    let originalCAF;

    beforeEach(() => {
        vi.useFakeTimers();

        originalRAF = globalThis.requestAnimationFrame;
        originalCAF = globalThis.cancelAnimationFrame;

        globalThis.requestAnimationFrame = (callback) =>
            setTimeout(() => callback(performance.now()), 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

        document.body.innerHTML = "";
    });

    afterEach(() => {
        document.body.innerHTML = "";

        globalThis.requestAnimationFrame = originalRAF;
        globalThis.cancelAnimationFrame = originalCAF;

        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("restores textarea caret when text is unchanged", () => {
        const textarea = document.createElement("textarea");
        textarea.id = "prompt-textarea";
        textarea.value = "hello world";
        document.body.appendChild(textarea);

        textarea.focus();
        textarea.setSelectionRange(3, 3);

        const restore = captureActiveComposerCaret();

        textarea.setSelectionRange(0, 0);

        restore();

        expect(textarea.selectionStart).toBe(3);
        expect(textarea.selectionEnd).toBe(3);
    });

    it("moves textarea caret to end when text changed", () => {
        const textarea = document.createElement("textarea");
        textarea.id = "prompt-textarea";
        textarea.value = "hello";
        document.body.appendChild(textarea);

        textarea.focus();
        textarea.setSelectionRange(2, 2);

        const restore = captureActiveComposerCaret();

        textarea.value = "hello world";
        textarea.setSelectionRange(0, 0);

        restore();

        expect(textarea.selectionStart).toBe(11);
        expect(textarea.selectionEnd).toBe(11);
    });

    it("restores contenteditable caret when text is unchanged", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello world";
        document.body.appendChild(composer);

        composer.focus();

        const textNode = composer.firstChild;
        const range = document.createRange();
        range.setStart(textNode, 5);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const restore = captureActiveComposerCaret();

        const resetRange = document.createRange();
        resetRange.setStart(textNode, 0);
        resetRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(resetRange);

        restore();

        const restoredRange = selection.getRangeAt(0);
        expect(restoredRange.startContainer).toBe(textNode);
        expect(restoredRange.startOffset).toBe(5);
    });

    it("moves contenteditable caret to end when text changed", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello";
        document.body.appendChild(composer);

        composer.focus();

        const range = document.createRange();
        range.setStart(composer.firstChild, 2);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const restore = captureActiveComposerCaret();

        composer.textContent = "hello world";

        restore();

        const restoredRange = selection.getRangeAt(0);
        expect(restoredRange.startContainer).toBe(composer.firstChild);
        expect(restoredRange.startOffset).toBe(11);
    });

    it("restores after two animation frames", async () => {
        const textarea = document.createElement("textarea");
        textarea.id = "prompt-textarea";
        textarea.value = "hello world";
        document.body.appendChild(textarea);

        textarea.focus();
        textarea.setSelectionRange(4, 4);

        const restore = captureActiveComposerCaret();

        textarea.setSelectionRange(0, 0);

        restoreComposerCaretAfterDomSettles(restore);

        expect(textarea.selectionStart).toBe(0);

        await flushRaf();

        expect(textarea.selectionStart).toBe(4);
        expect(textarea.selectionEnd).toBe(4);
    });

    it("returns null when no composer is active", () => {
        const button = document.createElement("button");
        document.body.appendChild(button);
        button.focus();

        expect(captureActiveComposerCaret()).toBeNull();
    });
});