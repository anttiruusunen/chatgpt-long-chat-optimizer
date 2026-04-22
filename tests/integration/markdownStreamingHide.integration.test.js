import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

function buildSection() {
    document.body.innerHTML = "";

    const conversation = document.createElement("div");
    document.body.appendChild(conversation);

    const assistant = document.createElement("section");
    assistant.setAttribute("data-turn", "assistant");
    assistant.setAttribute("data-testid", "conversation-turn-1");
    assistant.setAttribute("data-scroll-anchor", "true");

    const header = document.createElement("div");
    header.textContent = "Assistant chrome";

    const markdown = document.createElement("div");
    markdown.className = "markdown";
    markdown.textContent = "Body";

    assistant.appendChild(header);
    assistant.appendChild(markdown);
    conversation.appendChild(assistant);

    return { assistant, header, markdown };
}

describe("markdown-level streaming hiding", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    afterEach(() => {
        document.body.innerHTML = "";
        document.head.innerHTML = "";
        vi.restoreAllMocks();
    });

    it("marks only markdown for hiding while preserving the section shell state", async () => {
        const { assistant, markdown } = buildSection();

        const module = await import("../../src/content/streaming/streamingSection.js");
        module.setStreamingSectionHidingEnabled(true);

        expect(
            assistant.getAttribute("data-thread-optimizer-stream-hidden")
        ).toBe("true");
        expect(
            markdown.getAttribute("data-thread-optimizer-stream-markdown-hidden")
        ).toBe("true");
    });
});