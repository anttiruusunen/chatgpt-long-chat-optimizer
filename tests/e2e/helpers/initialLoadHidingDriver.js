import fs from "node:fs";
import path from "node:path";

export const INITIAL_LOAD_HIDING_TEST_URL =
    "https://chatgpt.com/c/thread-optimizer-initial-load-hiding-e2e";

const CONVERSATION_URL =
    "https://chatgpt.com/backend-api/conversation/thread-optimizer-e2e";

const PAGE_BRIDGE_TOKEN_ATTR =
    "data-thread-optimizer-chat-store-page-bridge-token";
const EARLY_INITIAL_LOAD_HIDING_SETTINGS_ATTR =
    "data-thread-optimizer-initial-load-hiding-settings";
const EARLY_INITIAL_LOAD_HIDING_SETTINGS_EVENT =
    "thread-optimizer:initial-load-hiding-settings";

function findBuiltFile(candidates, description) {
    for (const candidate of candidates) {
        const fullPath = path.resolve(candidate);

        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    throw new Error(
        `Could not find built ${description}. Run npm run build:chrome:debug first. Tried:\n${candidates.join("\n")}`
    );
}

function findBuiltPageBridgeScript() {
    return findBuiltFile(
        [
            "dist/chrome/page/chatStorePageBridge.js",
            "dist/firefox/page/chatStorePageBridge.js",
            "dist/safari/page/chatStorePageBridge.js",
            "build/chrome/page/chatStorePageBridge.js",
        ],
        "page bridge script"
    );
}

export function createConversationPayload({
    exchangeCount = 10,
} = {}) {
    const mapping = {
        "client-created-root": {
            id: "client-created-root",
            message: null,
            parent: null,
            children: [],
        },
    };

    let parentId = "client-created-root";

    for (let i = 1; i <= exchangeCount; i += 1) {
        const userId = `user-${i}`;
        const assistantId = `assistant-${i}`;

        mapping[userId] = {
            id: userId,
            message: {
                id: `message-${userId}`,
                author: {
                    role: "user",
                },
                content: {
                    content_type: "text",
                    parts: [`User message ${i}`],
                },
                metadata: {},
            },
            parent: parentId,
            children: [assistantId],
        };

        mapping[assistantId] = {
            id: assistantId,
            message: {
                id: `message-${assistantId}`,
                author: {
                    role: "assistant",
                },
                content: {
                    content_type: "text",
                    parts: [`Assistant message ${i}`],
                },
                metadata: {},
            },
            parent: userId,
            children: [],
        };

        mapping[parentId].children = [userId];
        parentId = assistantId;
    }

    return {
        id: "thread-optimizer-e2e-conversation",
        title: "Thread Optimizer E2E Conversation",
        current_node: parentId,
        mapping,
    };
}

function createFixtureHtml() {
    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Initial Load Hiding E2E</title>
</head>
<body>
    <main id="app">Initial-load hiding fixture ready</main>
</body>
</html>`;
}

function normalizeInitialLoadSettings(settings = {}) {
    return {
        enabled: Boolean(settings.enablePruning),
        historyKeptExchanges: Math.max(
            1,
            Math.floor(Number(settings.historyKeptExchanges) || 10)
        ),
        debug: Boolean(settings.enableDebugLogging),
    };
}

async function installPageBridge(page, pageBridgeSource, settings) {
    const startupSettings = normalizeInitialLoadSettings(settings);

    await page.evaluate(
        ({
            bridgeSource,
            token,
            tokenAttr,
            settingsAttr,
            settingsEvent,
            startupSettings: nextStartupSettings,
        }) => {
            window.THREAD_OPTIMIZER_BRIDGE_TOKEN = token;

            document.documentElement.setAttribute(
                settingsAttr,
                JSON.stringify(nextStartupSettings)
            );

            const fakeCurrentScript = document.createElement("script");
            fakeCurrentScript.setAttribute(tokenAttr, token);

            const descriptor = Object.getOwnPropertyDescriptor(
                Document.prototype,
                "currentScript"
            );
            const hadOwnCurrentScript =
                Object.prototype.hasOwnProperty.call(document, "currentScript");
            const ownCurrentScriptDescriptor = hadOwnCurrentScript
                ? Object.getOwnPropertyDescriptor(document, "currentScript")
                : null;

            Object.defineProperty(document, "currentScript", {
                configurable: true,
                get: () => fakeCurrentScript,
            });

            try {
                // Built page/chatStorePageBridge.js is an IIFE bundle. Evaluating
                // it with a synthetic currentScript exercises the production
                // bridge install code while avoiding Firefox/jsdom differences
                // around dynamically inserted external script currentScript.
                new Function(`${bridgeSource}\n//# sourceURL=thread-optimizer-page-bridge-e2e.js`)();
            } finally {
                if (hadOwnCurrentScript && ownCurrentScriptDescriptor) {
                    Object.defineProperty(
                        document,
                        "currentScript",
                        ownCurrentScriptDescriptor
                    );
                } else if (descriptor) {
                    delete document.currentScript;
                }
            }

            document.dispatchEvent(new Event(settingsEvent));
        },
        {
            bridgeSource: pageBridgeSource,
            token: "0123456789abcdef0123456789abcdef",
            tokenAttr: PAGE_BRIDGE_TOKEN_ATTR,
            settingsAttr: EARLY_INITIAL_LOAD_HIDING_SETTINGS_ATTR,
            settingsEvent: EARLY_INITIAL_LOAD_HIDING_SETTINGS_EVENT,
            startupSettings,
        }
    );

    await page.waitForFunction(
        () => window.__threadOptimizerChatStoreBridge?.status,
        null,
        {
            timeout: 5000,
        }
    );
}

async function fetchConversationInFixture(page) {
    return await page.evaluate(async () => {
        try {
            const response = await fetch(
                "/backend-api/conversation/thread-optimizer-e2e"
            );
            const payload = await response.json();
            const receivedNodeCount = Object.keys(payload.mapping || {}).length;

            const result = {
                error: null,
                receivedNodeCount,
                currentNode: payload.current_node,
            };

            document.querySelector("#app").textContent =
                `received ${receivedNodeCount} nodes`;

            return result;
        } catch (error) {
            return {
                error: String(error?.message || error),
                receivedNodeCount: null,
                currentNode: null,
            };
        }
    });
}

export async function loadInitialLoadHidingFixture(
    page,
    {
        settings = {},
        payload = createConversationPayload(),
    } = {}
) {
    const pageBridge = fs.readFileSync(
        findBuiltPageBridgeScript(),
        "utf8"
    );
    const originalNodeCount = Object.keys(payload.mapping || {}).length;

    await page.route(CONVERSATION_URL, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json; charset=utf-8",
            body: JSON.stringify(payload),
        });
    });

    await page.route(INITIAL_LOAD_HIDING_TEST_URL, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: createFixtureHtml(),
        });
    });

    await page.goto(INITIAL_LOAD_HIDING_TEST_URL);
    await installPageBridge(page, pageBridge, settings);

    const fixtureResult = await fetchConversationInFixture(page);

    const initialLoadHidingState = await getInitialLoadHidingState(page);

    return {
        payload,
        originalNodeCount,
        fixtureResult,
        initialLoadHidingState,
    };
}

export async function getInitialLoadHidingState(page) {
    return await page.evaluate(
        () =>
            window.__threadOptimizerChatStoreBridge
                ?.status?.()
                ?.initialLoadHiding ?? null
    );
}

export async function postRuntimeInitialLoadHidingSettings(
    page,
    {
        enabled,
        historyKeptExchanges,
        debug,
    }
) {
    await page.evaluate(
        ({ nextEnabled, nextHistoryKeptExchanges, nextDebug }) => {
            window.postMessage(
                {
                    source: "thread-optimizer",
                    token: window.THREAD_OPTIMIZER_BRIDGE_TOKEN,
                    type: "thread-optimizer:set-initial-load-hiding",
                    enabled: nextEnabled,
                    historyKeptExchanges: nextHistoryKeptExchanges,
                    debug: nextDebug,
                },
                window.location.origin
            );
        },
        {
            nextEnabled: enabled,
            nextHistoryKeptExchanges: historyKeptExchanges,
            nextDebug: debug,
        }
    );
}
