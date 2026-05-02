import path from "node:path";
import fs from "node:fs";

export const fixturePath = path.resolve("tests/e2e/fixtures/chat.html");
export const fixtureUrl = `file://${fixturePath}`;

function findBuiltContentScript() {
    const candidates = [
        "dist/chrome/content.js",
        "dist/firefox/content.js",
        "dist/safari/content.js",
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

export async function loadFixtureWithOptimizer(page) {
    await page.goto(fixtureUrl);

    await page.addInitScript(() => {
        globalThis.chrome = {
            runtime: {
                getURL: (path) => path,
                onMessage: {
                    addListener: () => {},
                },
            },
            storage: {
                sync: {
                    get: (defaults, callback) => callback(defaults),
                    set: (_values, callback) => callback?.(),
                },
                onChanged: {
                    addListener: () => {},
                },
            },
        };
    });

    await page.reload();

    const contentScriptPath = findBuiltContentScript();
    const contentScript = fs.readFileSync(contentScriptPath, "utf8");

    await page.addScriptTag({
        content: contentScript,
    });

    await page.waitForTimeout(300);
}