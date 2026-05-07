import { describe, it, expect, beforeEach, vi } from "vitest";

describe("conversation scroll container cache", () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = "";
    });

    function buildConversation() {
        document.body.innerHTML = `
            <main>
                <div id="scroll-root" style="overflow-y: auto">
                    <div id="conversation">
                        <section data-testid="conversation-turn-1" data-turn="user"></section>
                        <section data-testid="conversation-turn-2" data-turn="assistant" data-scroll-anchor="true"></section>
                    </div>
                </div>
            </main>
        `;

        return {
            scrollRoot: document.getElementById("scroll-root"),
            conversation: document.getElementById("conversation"),
        };
    }

    it("does not clear the scroll container cache on normal DOM invalidation", async () => {
        const dom = await import("../../src/content/core/dom.js");
        const { scrollRoot } = buildConversation();

        const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");

        expect(dom.getConversationScrollContainer()).toBe(scrollRoot);
        expect(dom.getConversationScrollContainer()).toBe(scrollRoot);

        const callsBeforeInvalidation = getComputedStyleSpy.mock.calls.length;

        dom.invalidateConversationDomCache();

        expect(dom.getConversationScrollContainer()).toBe(scrollRoot);
        expect(getComputedStyleSpy.mock.calls.length).toBe(callsBeforeInvalidation);
    });

    it("does clear the scroll container cache when explicitly invalidated", async () => {
        const dom = await import("../../src/content/core/dom.js");
        const { scrollRoot } = buildConversation();

        const getComputedStyleSpy = vi.spyOn(window, "getComputedStyle");

        expect(dom.getConversationScrollContainer()).toBe(scrollRoot);

        const callsBeforeInvalidation = getComputedStyleSpy.mock.calls.length;

        dom.invalidateConversationScrollContainerCache();

        expect(dom.getConversationScrollContainer()).toBe(scrollRoot);
        expect(getComputedStyleSpy.mock.calls.length).toBeGreaterThan(callsBeforeInvalidation);
    });
});