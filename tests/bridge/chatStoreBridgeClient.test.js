import { describe, it, expect } from "vitest";
import { extractMessageId } from "../../src/content/bridge/chatStoreBridgeClient.js";

describe("chatStoreBridgeClient message id extraction", () => {
    it("extracts valid message id", () => {
        const node = document.createElement("div");
        node.setAttribute("data-message-id", "abc123");

        expect(extractMessageId(node)).toBe("abc123");
    });

    it("ignores invalid ids", () => {
        const node = document.createElement("div");
        node.setAttribute("data-message-id", "");

        expect(extractMessageId(node)).toBeNull();
    });

    it("handles nested nodes", () => {
        const parent = document.createElement("div");
        const child = document.createElement("div");

        parent.setAttribute("data-message-id", "parent-id");
        parent.appendChild(child);

        expect(extractMessageId(child)).toBe("parent-id");
    });
});