import { describe, it, expect } from "vitest";
import {
    hasResponseActions,
    isLikelyComposerInput,
    getClosestComposerSubmitButton,
} from "../../src/content/streaming/assistantSignals.js";

describe("assistantSignals", () => {
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

    it("returns false for invalid inputs", () => {
        expect(hasResponseActions(null)).toBe(false);
        expect(hasResponseActions(undefined)).toBe(false);
        expect(hasResponseActions("not-an-element")).toBe(false);
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
        const el = document.createElement("div");
        expect(isLikelyComposerInput(el)).toBe(false);
    });

    it("finds the closest composer submit button by id", () => {
        const button = document.createElement("button");
        button.id = "composer-submit-button";

        const child = document.createElement("span");
        button.appendChild(child);

        expect(getClosestComposerSubmitButton(child)).toBe(button);
    });

    it("finds the closest composer submit button by submit type", () => {
        const button = document.createElement("button");
        button.type = "submit";

        const child = document.createElement("span");
        button.appendChild(child);

        expect(getClosestComposerSubmitButton(child)).toBe(button);
    });

    it("finds the closest composer submit button by aria-label", () => {
        const button = document.createElement("button");
        button.setAttribute("aria-label", "Send message");

        const child = document.createElement("span");
        button.appendChild(child);

        expect(getClosestComposerSubmitButton(child)).toBe(button);
    });

    it("returns null when no submit button is found", () => {
        const el = document.createElement("div");
        expect(getClosestComposerSubmitButton(el)).toBeNull();
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

    it("treats the dedicated response actions container as response actions", () => {
        const section = document.createElement("section");

        const actions = document.createElement("div");
        actions.setAttribute("aria-label", "Response actions");
        section.appendChild(actions);

        expect(hasResponseActions(section)).toBe(true);
    });

    it("treats the dedicated response actions test id as response actions", () => {
        const section = document.createElement("section");

        const actions = document.createElement("div");
        actions.setAttribute("data-testid", "response-actions");
        section.appendChild(actions);

        expect(hasResponseActions(section)).toBe(true);
    });
});