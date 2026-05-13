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
        const runtimeListeners = [];
        const storageListeners = [];
        const storageState = {
            ...injectedSettings,
        };

        function cloneStorageState() {
            return {
                ...storageState,
            };
        }

        function selectStorageValues(keys) {
            if (keys == null) {
                return cloneStorageState();
            }

            if (typeof keys === "string") {
                return {
                    [keys]: storageState[keys],
                };
            }

            if (Array.isArray(keys)) {
                const result = {};

                for (const key of keys) {
                    result[key] = storageState[key];
                }

                return result;
            }

            if (typeof keys === "object") {
                return {
                    ...keys,
                    ...storageState,
                };
            }

            return cloneStorageState();
        }

        function buildStorageChanges(values) {
            const changes = {};

            for (const [key, newValue] of Object.entries(values || {})) {
                const oldValue = storageState[key];

                storageState[key] = newValue;

                changes[key] = {
                    oldValue,
                    newValue,
                };
            }

            return changes;
        }

        function emitStorageChanges(changes) {
            if (!changes || Object.keys(changes).length === 0) {
                return;
            }

            for (const listener of storageListeners) {
                try {
                    listener(changes, "sync");
                } catch (error) {
                    setTimeout(() => {
                        throw error;
                    }, 0);
                }
            }
        }

        globalThis.chrome = {
            runtime: {
                getURL: (path) => path,
                onMessage: {
                    __listeners: runtimeListeners,
                    addListener: (listener) => {
                        runtimeListeners.push(listener);
                    },
                },
            },
            storage: {
                sync: {
                    get: (keys, callback) => {
                        if (typeof keys === "function") {
                            keys(selectStorageValues(null));
                            return;
                        }

                        callback?.(selectStorageValues(keys));
                    },
                    set: (values, callback) => {
                        const changes = buildStorageChanges(values);

                        queueMicrotask(() => {
                            emitStorageChanges(changes);
                            callback?.();
                        });
                    },
                },
                onChanged: {
                    __listeners: storageListeners,
                    addListener: (listener) => {
                        storageListeners.push(listener);
                    },
                },
            },
        };

        globalThis.__THREAD_OPTIMIZER_E2E_STORAGE__ = {
            get: cloneStorageState,
            set: (values) =>
                new Promise((resolve) => {
                    globalThis.chrome.storage.sync.set(values, resolve);
                }),
            dispatch: (values) => {
                const changes = buildStorageChanges(values);
                emitStorageChanges(changes);
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