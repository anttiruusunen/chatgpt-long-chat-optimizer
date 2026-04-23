import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/shared/ext.js", async (importOriginal) => {
    const actual = await importOriginal();

    const addListener = vi.fn();
    const removeListener = vi.fn();

    return {
        ...actual,
        ext: {
            ...actual.ext,
            storage: {
                ...(actual.ext?.storage ?? {}),
                sync: {
                    get: vi.fn(async () => ({})),
                    set: vi.fn(async () => {}),
                },
                onChanged: {
                    addListener,
                    removeListener,
                },
            },
            runtime: {
                ...(actual.ext?.runtime ?? {}),
                sendMessage: vi.fn(async () => undefined),
                onMessage: {
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                },
            },
        },
        storageSyncGet: vi.fn(async (defaults = {}) => defaults),
        storageSyncSet: vi.fn(async () => {}),
    };
});

describe("markdown-level streaming hiding", () => {
    beforeEach(() => {
        document.body.innerHTML = "";

        class MockIntersectionObserver {
            constructor(callback) {
                this.callback = callback;
            }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() {
                return [];
            }
        }

        globalThis.IntersectionObserver = MockIntersectionObserver;
        window.IntersectionObserver = MockIntersectionObserver;

        globalThis.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        };

        globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    });

    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
        vi.resetModules();
        delete globalThis.IntersectionObserver;
        delete window.IntersectionObserver;
        delete globalThis.ResizeObserver;
    });

    it("marks only markdown for hiding while preserving the section shell state", async () => {
        document.body.innerHTML = `
            <main>
                <div id="conversation-host">
                    <div data-turn-id-container="u1">
                        <section
                            data-testid="conversation-turn-1"
                            data-turn-id="u1"
                            data-turn="user"
                            data-scroll-anchor="false"
                        >
                            <div data-message-author-role="user">Hi</div>
                        </section>
                    </div>
                    <div data-turn-id-container="a1">
                        <section
                            data-testid="conversation-turn-2"
                            data-turn-id="a1"
                            data-turn="assistant"
                            data-scroll-anchor="true"
                        >
                            <div class="markdown">Streaming answer</div>
                        </section>
                    </div>
                </div>
            </main>
        `;

        await import("../../src/content/core/index.js");

        const domModule = await import("../../src/content/core/dom.js");
        const streamingSectionModule = await import(
            "../../src/content/streaming/streamingSection.js"
        );
        const {
            STREAM_HIDDEN_ATTR,
            STREAM_MARKDOWN_HIDDEN_ATTR,
        } = streamingSectionModule;

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        streamingSectionModule.setStreamingSectionHidingEnabled(true);
        streamingSectionModule.syncStreamingSectionState();

        const assistant = document.querySelector('[data-turn="assistant"]');
        const markdown = assistant?.querySelector(".markdown");
        const mountNode =
            assistant && typeof domModule.getConversationSectionMountNode === "function"
                ? domModule.getConversationSectionMountNode(assistant)
                : assistant;

        expect(assistant).not.toBeNull();
        expect(markdown).not.toBeNull();
        expect(mountNode).not.toBeNull();

        expect(markdown.getAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe("true");
        expect(assistant.getAttribute(STREAM_MARKDOWN_HIDDEN_ATTR)).toBe(null);
        expect(mountNode.getAttribute(STREAM_HIDDEN_ATTR)).toBe("true");
    });
});