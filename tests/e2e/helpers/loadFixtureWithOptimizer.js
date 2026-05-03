import path from "node:path";
import fs from "node:fs";

export const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
export const fixtureUrl = `file://${fixturePath}`;

function findBuiltContentScript() {
    const candidates = [
        "dist/chrome/content/index.js",
        "dist/chrome/content.js",
        "dist/firefox/content.js",
        "dist/safari/content.js",
        "build/chrome/content/index.js",
        "dist/content/index.js",
    ];

    for (const candidate of candidates) {
        const fullPath = path.resolve(candidate);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    throw new Error(
        `Could not find built content script. Run npm run build:chrome first. Tried:\n${candidates.join("\n")}`
    );
}

export async function loadFixtureWithOptimizer(
    page,
    {
        settings = {},
        beforeOptimizerLoad = null,
    } = {}
) {
    await page.goto(fixtureUrl);

    await page.addInitScript((injectedSettings) => {
        const listeners = [];

        globalThis.chrome = {
            runtime: {
                getURL: (path) => path,
                onMessage: {
                    __listeners: listeners,
                    addListener: (listener) => {
                        listeners.push(listener);
                    },
                },
            },
            storage: {
                sync: {
                    get: (defaults, callback) => callback({
                        ...defaults,
                        ...injectedSettings,
                    }),
                    set: (_values, callback) => callback?.(),
                },
                onChanged: {
                    addListener: () => {},
                },
            },
        };
    }, settings);

    await page.reload();

    if (typeof beforeOptimizerLoad === "function") {
        await beforeOptimizerLoad(page);
    }

    const contentScriptPath = findBuiltContentScript();
    const contentScript = fs.readFileSync(contentScriptPath, "utf8");

    await page.addScriptTag({
        content: contentScript,
    });

    await page.waitForTimeout(300);
}