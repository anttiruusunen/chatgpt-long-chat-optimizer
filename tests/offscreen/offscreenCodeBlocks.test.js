import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
    state,
    CODE_BLOCK_PLACEHOLDER_ATTR,
} from "../../src/content/core/state.js";
import {
    refreshObservedCodeBlocks,
    reconcileLatestStreamingAssistantCodeBlocksNow,
} from "../../src/content/offscreen/offscreenCodeBlocks.js";
import { revealCollapsedCodeBlockFromPlaceholder } from "../../src/content/offscreen/codeBlockDetachStore.js";
import { isLargeCodeBlock } from "../../src/content/offscreen/codeBlockPlaceholders.js";

function makeLargePre(text) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = text;
    pre.appendChild(code);
    return pre;
}

function largeText(label) {
    return `${label}\n${"x".repeat(80)}`;
}

function addResponseActions(section) {
    const actions = document.createElement("div");
    actions.setAttribute("aria-label", "Response actions");
    section.appendChild(actions);
    return actions;
}

function getObserverCallback() {
    const observer =
        state.codeBlockMutationObserver ?? state.codeBlockStructureObserver;
    expect(observer).not.toBeNull();
    return observer.__threadOptimizerCallback ?? observer.callback ?? observer.__callback;
}

class FakeMutationObserver {
    constructor(callback) {
        this.__threadOptimizerCallback = callback;
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
    }
}

describe("offscreenCodeBlocks", () => {
    const originalMutationObserver = globalThis.MutationObserver;

    beforeEach(() => {
        vi.useFakeTimers();

        document.body.innerHTML = `
            <main>
                <div id="scroll-root" style="overflow-y:auto;">
                    <div id="conversation">
                        <section data-testid="conversation-turn-1" data-turn="user">
                            <div>User</div>
                        </section>
                        <section data-testid="conversation-turn-2" data-turn="assistant">
                            <div class="assistant-body">
                                <div class="markdown"></div>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        `;

        globalThis.MutationObserver = FakeMutationObserver;

        state.featureFlags.offscreenOptimization = true;
        state.featureFlags.largeCodeBlockOptimization = true;

        state.detachedCodeBlocks = new Map();
        state.nextDetachedCodeBlockId = 1;

        state.codeBlockStructureObserver = null;
        state.observedCodeBlockStructureRoot = null;
        state.observedCodeBlockStructureSection = null;

        state.codeBlockMutationObserver = null;
        state.observedCodeBlockMutationSection = null;

        state.streamingCodeBlockLastSection = null;
        state.streamingCodeBlockLastPre = null;
        state.streamingCodeBlockLastCount = 0;

        state.replyTiming.pending = false;
        state.replyTiming.startedAt = 0;
        state.replyTiming.completedAt = 0;
        state.replyTiming.lastDurationMs = 0;
        state.replyTiming.trigger = null;
    });

    afterEach(() => {
        document.body.innerHTML = "";
        state.detachedCodeBlocks = new Map();

        state.codeBlockStructureObserver = null;
        state.observedCodeBlockStructureRoot = null;
        state.observedCodeBlockStructureSection = null;

        state.codeBlockMutationObserver = null;
        state.observedCodeBlockMutationSection = null;

        state.streamingCodeBlockLastSection = null;
        state.streamingCodeBlockLastPre = null;
        state.streamingCodeBlockLastCount = 0;

        state.replyTiming.pending = false;

        globalThis.MutationObserver = originalMutationObserver;

        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it("stays in text-only streaming phase before the first pre exists", () => {
        const section = document.querySelector('section[data-testid="conversation-turn-2"]');
        const markdown = section.querySelector(".markdown");

        state.replyTiming.pending = true;
        markdown.textContent = "Still plain text streaming";

        reconcileLatestStreamingAssistantCodeBlocksNow();

        expect(state.streamingCodeBlockLastSection).toBe(section);
        expect(state.detachedCodeBlocks.size).toBe(0);
        expect(markdown.querySelectorAll("pre").length).toBe(0);
        expect(
            document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`).length
        ).toBe(0);
    });

    it("enters code-block mode after the first pre appears", () => {
        const markdown = document.querySelector(".markdown");

        state.replyTiming.pending = true;
        markdown.textContent = "Streaming intro";

        reconcileLatestStreamingAssistantCodeBlocksNow();

        const first = makeLargePre(largeText("first"));
        markdown.appendChild(first);

        const callback = getObserverCallback();
        callback([
            {
                type: "childList",
                addedNodes: [first],
                removedNodes: [],
            },
        ]);

        vi.runOnlyPendingTimers();

        expect(markdown.querySelectorAll("pre").length).toBe(1);
        expect(
            document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`).length
        ).toBe(1);
        expect(state.streamingCodeBlockLastCount).toBe(1);
        expect(state.streamingCodeBlockLastPre).toBe(first);
    });

    it("does not treat empty or whitespace-only pre blocks as large code blocks", () => {
        const empty = makeLargePre("");
        const whitespace = makeLargePre("   \n\t  ");
        const meaningful = makeLargePre("const x = 1;");

        expect(isLargeCodeBlock(empty)).toBe(false);
        expect(isLargeCodeBlock(whitespace)).toBe(false);
        expect(isLargeCodeBlock(meaningful)).toBe(true);
    });

    it("does not create a placeholder for a transient empty pre while streaming", () => {
        const markdown = document.querySelector(".markdown");

        state.replyTiming.pending = true;
        markdown.textContent = "Streaming intro";

        reconcileLatestStreamingAssistantCodeBlocksNow();

        const transientPre = makeLargePre("");
        markdown.appendChild(transientPre);

        const callback = getObserverCallback();
        callback([
            {
                type: "childList",
                addedNodes: [transientPre],
                removedNodes: [],
            },
        ]);

        vi.runOnlyPendingTimers();

        const placeholders = document.querySelectorAll(
            `[${CODE_BLOCK_PLACEHOLDER_ATTR}="true"]:not([data-thread-optimizer-code-placeholder-hidden="true"])`
        );
        const remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(0);
        expect(remainingPreBlocks.length).toBe(1);
        expect(remainingPreBlocks[0]).toBe(transientPre);
    });

    it("detaches earlier blocks immediately and keeps only the latest pre live", () => {
        const markdown = document.querySelector(".markdown");

        state.replyTiming.pending = true;

        const first = makeLargePre(largeText("first"));
        const second = makeLargePre(largeText("second"));

        markdown.appendChild(first);
        markdown.appendChild(second);

        reconcileLatestStreamingAssistantCodeBlocksNow();
        refreshObservedCodeBlocks();

        const placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        const remaining = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(2);
        expect(remaining.length).toBe(1);
        expect(remaining[0]).toBe(second);
    });

    it("detaches all large code blocks in a settled assistant section and then leaves the section alone", () => {
        const markdown = document.querySelector(".markdown");

        markdown.appendChild(makeLargePre(largeText("first")));
        markdown.appendChild(makeLargePre(largeText("second")));
        markdown.appendChild(makeLargePre(largeText("third")));

        refreshObservedCodeBlocks();

        let placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        let remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(3);
        expect(remainingPreBlocks.length).toBe(0);
        expect(state.detachedCodeBlocks.size).toBe(3);

        refreshObservedCodeBlocks();

        placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(3);
        expect(remainingPreBlocks.length).toBe(0);
        expect(state.detachedCodeBlocks.size).toBe(3);
    });

    it("tracks the newest assistant markdown when markdown exists", () => {
        const markdown = document.querySelector(".markdown");

        state.replyTiming.pending = true;
        markdown.textContent = "Streaming intro";

        reconcileLatestStreamingAssistantCodeBlocksNow();

        const first = makeLargePre(largeText("first"));
        markdown.appendChild(first);

        const callback = getObserverCallback();
        callback([
            {
                type: "childList",
                addedNodes: [first],
                removedNodes: [],
            },
        ]);

        vi.runOnlyPendingTimers();

        expect(markdown.querySelectorAll("pre").length).toBe(1);
        expect(
            document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`).length
        ).toBe(1);
        expect(state.streamingCodeBlockLastPre).toBe(first);
    });

    it("falls back cleanly when markdown is missing", () => {
        const assistant = document.querySelector('section[data-testid="conversation-turn-2"]');
        const markdown = assistant.querySelector(".markdown");
        markdown.remove();

        state.replyTiming.pending = true;
        assistant.textContent = "Streaming intro";

        reconcileLatestStreamingAssistantCodeBlocksNow();

        const first = makeLargePre(largeText("first"));
        assistant.appendChild(first);

        const callback = getObserverCallback();
        callback([
            {
                type: "childList",
                addedNodes: [first],
                removedNodes: [],
            },
        ]);

        vi.runOnlyPendingTimers();

        expect(assistant.querySelectorAll("pre").length).toBe(1);
        expect(
            document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`).length
        ).toBe(1);
        expect(state.streamingCodeBlockLastPre).toBe(first);
    });

    it("detaches earlier large code blocks when a new pre appears", () => {
        const markdown = document.querySelector(".markdown");
        const first = makeLargePre(largeText("first"));
        markdown.appendChild(first);

        state.replyTiming.pending = true;
        reconcileLatestStreamingAssistantCodeBlocksNow();

        const second = makeLargePre(largeText("second"));
        markdown.appendChild(second);

        const callback = getObserverCallback();
        callback([
            {
                type: "childList",
                addedNodes: [second],
                removedNodes: [],
            },
        ]);

        vi.runOnlyPendingTimers();

        const placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        const remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(2);
        expect(remainingPreBlocks.length).toBe(1);
        expect(remainingPreBlocks[0]).toBe(second);
    });

    it("fully detaches the previously live last code block once the streaming section settles", () => {
        const markdown = document.querySelector(".markdown");
        const assistant = document.querySelector('section[data-testid="conversation-turn-2"]');

        markdown.appendChild(makeLargePre(largeText("first")));
        markdown.appendChild(makeLargePre(largeText("second")));

        state.replyTiming.pending = true;
        reconcileLatestStreamingAssistantCodeBlocksNow();

        let placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        let remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(2);
        expect(remainingPreBlocks.length).toBe(1);

        addResponseActions(assistant);
        state.replyTiming.pending = false;

        refreshObservedCodeBlocks();

        placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        remainingPreBlocks = markdown.querySelectorAll("pre");

        expect(placeholders.length).toBe(2);
        expect(remainingPreBlocks.length).toBe(0);
    });

    it("does not re-detach a manually expanded historical code block on later refreshes", () => {
        const markdown = document.querySelector(".markdown");
        const assistant = document.querySelector('section[data-testid="conversation-turn-2"]');

        markdown.appendChild(makeLargePre(largeText("first")));
        markdown.appendChild(makeLargePre(largeText("second")));

        refreshObservedCodeBlocks();

        const placeholders = document.querySelectorAll(`[${CODE_BLOCK_PLACEHOLDER_ATTR}]`);
        expect(placeholders.length).toBe(2);

        revealCollapsedCodeBlockFromPlaceholder(placeholders[0]);

        let remainingPreBlocks = markdown.querySelectorAll("pre");
        expect(remainingPreBlocks.length).toBe(1);

        const revealedPre = remainingPreBlocks[0];
        expect(revealedPre.dataset.threadOptimizerCodeExpanded).toBe("true");

        addResponseActions(assistant);
        refreshObservedCodeBlocks();

        remainingPreBlocks = markdown.querySelectorAll("pre");
        expect(Array.from(remainingPreBlocks)).toContain(revealedPre);
        expect(revealedPre.dataset.threadOptimizerCodeExpanded).toBe("true");

        const visiblePlaceholders = document.querySelectorAll(
            `[${CODE_BLOCK_PLACEHOLDER_ATTR}="true"]:not([data-thread-optimizer-code-placeholder-hidden="true"])`
        );
        expect(visiblePlaceholders.length).toBe(1);
    });
});