import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    hasResponseActions,
    hasAssistantActiveGenerationState,
    hasAssistantErrorState,
    hasAssistantFeedbackState,
    isIncompleteAssistantSection,
    isLikelyComposerInput,
    getClosestComposerSubmitButton,
    getActiveComposerElement,
    getComposerDraftText,
    hasActiveComposerDraft,
    moveActiveComposerCaretToEnd,
    installComposerCaretStartGuard,
} from "../../src/content/streaming/assistantSignals.js";

describe("assistantSignals", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it("detects standard response actions by aria-label", () => {
        const section = document.createElement("section");
        const actions = document.createElement("div");
        actions.setAttribute("aria-label", "Response actions");
        section.appendChild(actions);

        expect(hasResponseActions(section)).toBe(true);
    });

    it("detects standard response actions by data-testid", () => {
        const section = document.createElement("section");
        const actions = document.createElement("div");
        actions.setAttribute("data-testid", "response-actions");
        section.appendChild(actions);

        expect(hasResponseActions(section)).toBe(true);
    });

    it("detects the paragen prefer response button as a completion signal", () => {
        const section = document.createElement("section");
        const button = document.createElement("button");
        button.setAttribute("data-testid", "paragen-prefer-response-button");
        section.appendChild(button);

        expect(hasResponseActions(section)).toBe(true);
    });

    it("detects known response action buttons", () => {
        const labels = [
            "Good response",
            "Bad response",
            "Read aloud",
        ];

        for (const labelText of labels) {
            const section = document.createElement("section");
            const button = document.createElement("button");
            button.setAttribute("aria-label", labelText);
            section.appendChild(button);

            expect(hasResponseActions(section)).toBe(true);
        }
    });

    it("returns false when no completion signals are present", () => {
        const section = document.createElement("section");
        section.textContent = "Still streaming";

        expect(hasResponseActions(section)).toBe(false);
    });

    it("returns false for invalid response-action inputs", () => {
        expect(hasResponseActions(null)).toBe(false);
        expect(hasResponseActions(undefined)).toBe(false);
        expect(hasResponseActions("not-an-element")).toBe(false);
    });

    it("detects assistant error text", () => {
        const section = document.createElement("section");
        section.textContent = "Something went wrong";

        expect(hasAssistantErrorState(section)).toBe(true);
    });

    it("detects assistant error role alert", () => {
        const section = document.createElement("section");
        const alert = document.createElement("div");
        alert.setAttribute("role", "alert");
        section.appendChild(alert);

        expect(hasAssistantErrorState(section)).toBe(true);
    });

    it("returns false for invalid assistant error inputs", () => {
        expect(hasAssistantErrorState(null)).toBe(false);
        expect(hasAssistantErrorState(undefined)).toBe(false);
        expect(hasAssistantErrorState("not-an-element")).toBe(false);
    });

    it("detects active generation from stop button", () => {
        const root = document.createElement("div");
        const button = document.createElement("button");
        button.setAttribute("aria-label", "Stop generating");
        root.appendChild(button);

        expect(hasAssistantActiveGenerationState(root)).toBe(true);
    });

    it("detects active generation from busy state", () => {
        const root = document.createElement("div");
        const busy = document.createElement("div");
        busy.setAttribute("aria-busy", "true");
        root.appendChild(busy);

        expect(hasAssistantActiveGenerationState(root)).toBe(true);
    });

    it("detects active generation from thinking status text", () => {
        const root = document.createElement("div");
        const status = document.createElement("div");
        status.setAttribute("role", "status");
        status.textContent = "Thinking";
        root.appendChild(status);

        expect(hasAssistantActiveGenerationState(root)).toBe(true);
    });

    it("returns false when active generation signals are absent", () => {
        const root = document.createElement("div");
        root.textContent = "Settled response";

        expect(hasAssistantActiveGenerationState(root)).toBe(false);
    });

    it("treats an assistant without response actions as incomplete", () => {
        const section = document.createElement("section");
        section.setAttribute("data-turn", "assistant");
        section.textContent = "Still streaming";

        expect(isIncompleteAssistantSection(section)).toBe(true);
    });

    it("treats an assistant with active generation state as incomplete", () => {
        const section = document.createElement("section");
        section.setAttribute("data-turn", "assistant");

        const status = document.createElement("div");
        status.setAttribute("role", "status");
        status.textContent = "Thinking";
        section.appendChild(status);

        expect(isIncompleteAssistantSection(section)).toBe(true);
    });

    it("treats an assistant with response actions as complete", () => {
        const section = document.createElement("section");
        section.setAttribute("data-turn", "assistant");

        const actions = document.createElement("div");
        actions.setAttribute("aria-label", "Response actions");
        section.appendChild(actions);

        expect(isIncompleteAssistantSection(section)).toBe(false);
    });

    it("does not treat non-assistant sections as incomplete assistant sections", () => {
        const section = document.createElement("section");
        section.setAttribute("data-turn", "user");
        section.textContent = "User message";

        expect(isIncompleteAssistantSection(section)).toBe(false);
    });

    it("returns false for invalid incomplete-assistant inputs", () => {
        expect(isIncompleteAssistantSection(null)).toBe(false);
        expect(isIncompleteAssistantSection(undefined)).toBe(false);
        expect(isIncompleteAssistantSection("not-an-element")).toBe(false);
    });

    it("recognizes textarea as a likely composer input", () => {
        const textarea = document.createElement("textarea");

        expect(isLikelyComposerInput(textarea)).toBe(true);
    });

    it("recognizes contenteditable elements as likely composer input", () => {
        const editable = document.createElement("div");
        editable.setAttribute("contenteditable", "true");

        expect(isLikelyComposerInput(editable)).toBe(true);
    });

    it("recognizes role textbox elements as likely composer input", () => {
        const textbox = document.createElement("div");
        textbox.setAttribute("role", "textbox");

        expect(isLikelyComposerInput(textbox)).toBe(true);
    });

    it("recognizes descendants inside composer roots as likely composer input", () => {
        const root = document.createElement("div");
        root.setAttribute("contenteditable", "true");

        const child = document.createElement("span");
        root.appendChild(child);

        expect(isLikelyComposerInput(child)).toBe(true);
    });

    it("returns false for non-composer elements", () => {
        const div = document.createElement("div");

        expect(isLikelyComposerInput(div)).toBe(false);
        expect(isLikelyComposerInput(null)).toBe(false);
    });

    it("finds closest composer submit button", () => {
        const button = document.createElement("button");
        button.setAttribute("aria-label", "Send message");

        const icon = document.createElement("span");
        button.appendChild(icon);

        expect(getClosestComposerSubmitButton(icon)).toBe(button);
    });

    it("finds composer submit button by id", () => {
        const button = document.createElement("button");
        button.id = "composer-submit-button";

        const icon = document.createElement("span");
        button.appendChild(icon);

        expect(getClosestComposerSubmitButton(icon)).toBe(button);
    });

    it("finds composer submit button by submit type", () => {
        const button = document.createElement("button");
        button.type = "submit";

        const icon = document.createElement("span");
        button.appendChild(icon);

        expect(getClosestComposerSubmitButton(icon)).toBe(button);
    });

    it("returns null when no composer submit button exists", () => {
        const div = document.createElement("div");

        expect(getClosestComposerSubmitButton(div)).toBeNull();
        expect(getClosestComposerSubmitButton(null)).toBeNull();
    });

    it("does not treat a standalone Copy button as response actions", () => {
        const section = document.createElement("section");

        const copyButton = document.createElement("button");
        copyButton.setAttribute("aria-label", "Copy");
        section.appendChild(copyButton);

        expect(hasResponseActions(section)).toBe(false);
    });

    it("does not treat a standalone Edit button as response actions", () => {
        const section = document.createElement("section");

        const editButton = document.createElement("button");
        editButton.setAttribute("aria-label", "Edit");
        section.appendChild(editButton);

        expect(hasResponseActions(section)).toBe(false);
    });

    it("detects assistant feedback state by test id", () => {
        const section = document.createElement("section");
        const title = document.createElement("div");
        title.setAttribute("data-testid", "paragen-feedback-title");
        section.appendChild(title);

        expect(hasAssistantFeedbackState(section)).toBe(true);
    });

    it("detects assistant feedback state by text", () => {
        const section = document.createElement("section");
        section.textContent = "Which response do you prefer?";

        expect(hasAssistantFeedbackState(section)).toBe(true);
    });

    it("returns false when assistant feedback state is absent", () => {
        const section = document.createElement("section");
        section.textContent = "Normal assistant response";

        expect(hasAssistantFeedbackState(section)).toBe(false);
        expect(hasAssistantFeedbackState(null)).toBe(false);
    });

    it("gets active composer element from focused contenteditable prompt", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        document.body.appendChild(composer);

        composer.focus();

        expect(getActiveComposerElement()).toBe(composer);
    });

    it("gets active composer element from focused descendant", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");

        const child = document.createElement("span");
        composer.appendChild(child);
        document.body.appendChild(composer);

        child.focus();

        expect(getActiveComposerElement()).toBe(composer);
    });

    it("falls back to composer element when active element is not composer", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        document.body.appendChild(composer);

        const button = document.createElement("button");
        document.body.appendChild(button);
        button.focus();

        expect(getActiveComposerElement()).toBe(composer);
    });

    it("returns empty composer draft text when no composer exists", () => {
        expect(getComposerDraftText()).toBe("");
        expect(hasActiveComposerDraft()).toBe(false);
    });

    it("detects active composer draft text from contenteditable prompt", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello draft";
        document.body.appendChild(composer);

        composer.focus();

        expect(getComposerDraftText()).toBe("hello draft");
        expect(hasActiveComposerDraft()).toBe(true);
    });

    it("ignores whitespace-only composer draft text", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "   ";
        document.body.appendChild(composer);

        composer.focus();

        expect(getComposerDraftText()).toBe("   ");
        expect(hasActiveComposerDraft()).toBe(false);
    });

    it("detects active composer draft text from textarea prompt", () => {
        const composer = document.createElement("textarea");
        composer.id = "prompt-textarea";
        composer.value = "textarea draft";
        document.body.appendChild(composer);

        composer.focus();

        expect(getComposerDraftText()).toBe("textarea draft");
        expect(hasActiveComposerDraft()).toBe(true);
    });

    it("detects active composer draft text from input prompt", () => {
        const composer = document.createElement("input");
        composer.id = "prompt-textarea";
        composer.value = "input draft";
        document.body.appendChild(composer);

        composer.focus();

        expect(getComposerDraftText()).toBe("input draft");
        expect(hasActiveComposerDraft()).toBe(true);
    });

    it("moves textarea composer caret to end", () => {
        const composer = document.createElement("textarea");
        composer.id = "prompt-textarea";
        composer.value = "hello world";
        document.body.appendChild(composer);

        composer.focus();
        composer.setSelectionRange(0, 0);

        expect(moveActiveComposerCaretToEnd()).toBe(true);
        expect(composer.selectionStart).toBe(11);
        expect(composer.selectionEnd).toBe(11);
    });

    it("moves input composer caret to end", () => {
        const composer = document.createElement("input");
        composer.id = "prompt-textarea";
        composer.value = "hello world";
        document.body.appendChild(composer);

        composer.focus();
        composer.setSelectionRange(0, 0);

        expect(moveActiveComposerCaretToEnd()).toBe(true);
        expect(composer.selectionStart).toBe(11);
        expect(composer.selectionEnd).toBe(11);
    });

    it("moves contenteditable composer caret to end", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello world";
        document.body.appendChild(composer);

        composer.focus();

        expect(moveActiveComposerCaretToEnd()).toBe(true);

        const selection = window.getSelection();
        const range = selection.getRangeAt(0);

        expect(range.startContainer).toBe(composer.firstChild);
        expect(range.startOffset).toBe(11);
    });

    it("does not move composer caret when focus is outside composer and there is no draft", () => {
        const composer = document.createElement("textarea");
        composer.id = "prompt-textarea";
        composer.value = "";
        document.body.appendChild(composer);

        const button = document.createElement("button");
        document.body.appendChild(button);
        button.focus();

        expect(moveActiveComposerCaretToEnd()).toBe(false);
    });

    it("guard repairs composer caret at start before input", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello world";
        document.body.appendChild(composer);

        composer.focus();

        const range = document.createRange();
        range.setStart(composer.firstChild, 0);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        const cleanup = installComposerCaretStartGuard();

        composer.dispatchEvent(
            new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: "!",
            })
        );

        const repairedRange = selection.getRangeAt(0);

        expect(repairedRange.startContainer).toBe(composer.firstChild);
        expect(repairedRange.startOffset).toBe(11);

        cleanup();
    });

    it("guard cleanup removes beforeinput repair", () => {
        const composer = document.createElement("div");
        composer.id = "prompt-textarea";
        composer.setAttribute("contenteditable", "true");
        composer.textContent = "hello world";
        document.body.appendChild(composer);

        composer.focus();

        const cleanup = installComposerCaretStartGuard();
        cleanup();

        const range = document.createRange();
        range.setStart(composer.firstChild, 0);
        range.collapse(true);

        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        composer.dispatchEvent(
            new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: "!",
            })
        );

        const currentRange = selection.getRangeAt(0);

        expect(currentRange.startContainer).toBe(composer.firstChild);
        expect(currentRange.startOffset).toBe(0);
    });
});