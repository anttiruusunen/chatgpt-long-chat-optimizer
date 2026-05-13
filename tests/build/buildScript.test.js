import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const buildScriptPath = path.join(rootDir, "scripts", "build.cjs");
const distDir = path.join(rootDir, "dist");
const chromeDistDir = path.join(distDir, "chrome");
const accidentalScriptsDistDir = path.join(rootDir, "scripts", "dist");

function removeBuildOutputs() {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(accidentalScriptsDistDir, { recursive: true, force: true });
}

function runBuild(args = [], env = {}) {
    const nextEnv = {
        ...process.env,
        ...env,
    };

    delete nextEnv.BROWSER_TARGET;
    delete nextEnv.BUILD_DEV;
    delete nextEnv.BUILD_PROFILE;
    delete nextEnv.BRIDGE_PROFILE;
    delete nextEnv.BUILD_MINIFY;

    Object.assign(nextEnv, env);

    return execFileSync(
        process.execPath,
        [buildScriptPath, ...args],
        {
            cwd: rootDir,
            stdio: "pipe",
            encoding: "utf8",
            env: nextEnv,
        }
    );
}

function readChromeBundle(relativePath) {
    return fs.readFileSync(path.join(chromeDistDir, relativePath), "utf8");
}

describe("build script", () => {
    beforeEach(() => {
        removeBuildOutputs();
    });

    afterEach(() => {
        removeBuildOutputs();
    });

    it(
        "builds chrome output from the repository root paths when invoked from scripts",
        () => {
            runBuild(["--target=chrome"]);

            expect(fs.existsSync(chromeDistDir)).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "manifest.json"))).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "content.js"))).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "bridgeBootstrap.js"))).toBe(true);
            expect(
                fs.existsSync(path.join(chromeDistDir, "page", "chatStorePageBridge.js"))
            ).toBe(true);

            expect(fs.existsSync(accidentalScriptsDistDir)).toBe(false);
        },
        30000
    );

    it(
        "builds production output with dev and profile globals disabled by default",
        () => {
            const output = runBuild(["--target=chrome"]);

            expect(output).toContain("minified");
            expect(output).toContain("dev=false");
            expect(output).toContain("profile=false");

            const bridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(bridgeBundle).not.toContain("__DEV__");
            expect(bridgeBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "builds non-minified output without enabling dev or profile globals",
        () => {
            const output = runBuild(["--target=chrome", "--no-minify"]);

            expect(output).toContain("debug");
            expect(output).toContain("dev=false");
            expect(output).toContain("profile=false");

            const bridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(bridgeBundle).not.toContain("__DEV__");
            expect(bridgeBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "enables dev globals only when requested",
        () => {
            const output = runBuild(["--target=chrome", "--dev"]);

            expect(output).toContain("minified");
            expect(output).toContain("dev=true");
            expect(output).toContain("profile=false");

            const bridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(bridgeBundle).not.toContain("__DEV__");
            expect(bridgeBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "enables profile globals only when requested",
        () => {
            const output = runBuild([
                "--target=chrome",
                "--profile",
            ]);

            expect(output).toContain("minified");
            expect(output).toContain("dev=false");
            expect(output).toContain("profile=true");

            const bridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(bridgeBundle).not.toContain("__DEV__");
            expect(bridgeBundle).not.toContain("__PROFILE__");

            expect(bridgeBundle).toContain("__THREAD_OPTIMIZER_STORE_PROFILER__");
            expect(bridgeBundle).toContain("__THREAD_OPTIMIZER_CACHE_PROFILING__");
        },
        30000
    );

    it(
        "can enable dev and profile independently in a non-minified build",
        () => {
            const output = runBuild([
                "--target=chrome",
                "--no-minify",
                "--dev",
                "--profile",
            ]);

            expect(output).toContain("debug");
            expect(output).toContain("dev=true");
            expect(output).toContain("profile=true");

            const bridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(bridgeBundle).not.toContain("__DEV__");
            expect(bridgeBundle).not.toContain("__PROFILE__");

            expect(bridgeBundle).toContain("__THREAD_OPTIMIZER_STORE_PROFILER__");
            expect(bridgeBundle).toContain("__THREAD_OPTIMIZER_CACHE_PROFILING__");
        },
        30000
    );

    it(
        "supports dev builds through environment variables",
        () => {
            const output = runBuild(
                ["--target=chrome"],
                {
                    BUILD_DEV: "true",
                }
            );

            expect(output).toContain("dev=true");
            expect(output).toContain("profile=false");
        },
        30000
    );

    it(
        "supports profile builds through environment variables",
        () => {
            const output = runBuild(
                ["--target=chrome"],
                {
                    BUILD_PROFILE: "true",
                }
            );

            expect(output).toContain("dev=false");
            expect(output).toContain("profile=true");
        },
        30000
    );

    it(
        "keeps profiling independent from legacy BRIDGE_PROFILE env",
        () => {
            const output = runBuild(
                ["--target=chrome"],
                {
                    BRIDGE_PROFILE: "true",
                }
            );

            expect(output).toContain("dev=false");
            expect(output).toContain("profile=true");
        },
        30000
    );
});