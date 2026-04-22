import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/shared/ext.js", () => ({
    ext: {
        storage: {
            onChanged: {
                addListener: vi.fn(),
            },
        },
        runtime: {
            onMessage: {
                addListener: vi.fn(),
            },
            getURL: vi.fn((path) => path),
        },
    },
    storageSyncGet: vi.fn(async (defaults = {}) => ({
        ...defaults,
        historyKeptExchanges: 10,
        autoPrune: true,
        enablePruning: true,
        enableOffscreenOptimization: true,
        enableLargeCodeBlockOptimization: true,
        enableStreamingSectionHiding: false,
        enableDebugLogging: false,
    })),
}));

function buildConversation() {
    document.body.innerHTML = `
        <main>
            <div id="conversation">
                <section data-testid="conversation-turn-1" data-turn="user">
                    <div>User</div>
                </section>

                <section data-testid="conversation-turn-2" data-turn="assistant">
                    <div class="assistant-body">
                        <div class="markdown">
                            <p>Earlier assistant</p>
                        </div>
                    </div>
                </section>

                <section
                    data-testid="conversation-turn-3"
                    data-turn="assistant"
                    data-scroll-anchor="true"
                >
                    <div class="assistant-body">
                        <div class="markdown">
                            <p>Latest assistant</p>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    `;
}

describe("offscreen code block optimization contract", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.innerHTML = "";
        document.head.innerHTML = "";
    });

    it("eventually optimizes a code block that hydrates into an existing assistant after startup", async () => {
        buildConversation();

        const domModule = await import("../../src/content/core/dom.js");
        const offscreenCodeBlocksModule = await import(
            "../../src/content/offscreen/offscreenCodeBlocks.js"
        );
        await import("../../src/content/ui/qolStyles.js");

        offscreenCodeBlocksModule.refreshObservedCodeBlocks();

        const latestAssistant = domModule.getLatestAssistantSection();
        const markdown = latestAssistant.querySelector(".markdown");

        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = `const hydrated = true;\n${"x".repeat(120)}`;
        pre.appendChild(code);
        markdown.appendChild(pre);

        // First retry scheduled by refreshObservedCodeBlocks().
        await vi.advanceTimersByTimeAsync(250);

        const placeholder = latestAssistant.querySelector(
            '[data-thread-optimizer-code-placeholder="true"]'
        );

        const processed =
            latestAssistant.getAttribute(
                "data-thread-optimizer-codeblocks-processed"
            ) === "true";

        expect(Boolean(placeholder) || pre.isConnected === false || processed).toBe(true);
    });
});