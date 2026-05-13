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
    return execFileSync(process.execPath, [buildScriptPath, ...args], {
        cwd: rootDir,
        stdio: "pipe",
        encoding: "utf8",
        env: {
            ...process.env,
            BROWSER_TARGET: "",
            BUILD_DEV: "",
            BUILD_PROFILE: "",
            BRIDGE_PROFILE: "",
            BUILD_MINIFY: "",
            ...env,
        },
    });
}

function readChromeBundle(relativePath) {
    return fs.readFileSync(path.join(chromeDistDir, relativePath), "utf8");
}

function getPopupHtmlScriptSrc() {
    const popupHtmlPath = path.join(chromeDistDir, "popup", "popup.html");
    const popupHtml = fs.readFileSync(popupHtmlPath, "utf8");

    const scriptMatch = popupHtml.match(
        /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/
    );

    expect(scriptMatch).not.toBeNull();

    return {
        popupHtmlPath,
        scriptSrc: scriptMatch[1],
    };
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

            expect(fs.existsSync(path.join(chromeDistDir, "popup", "popup.html"))).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "popup", "popup.js"))).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "popup.js"))).toBe(false);

            expect(fs.existsSync(accidentalScriptsDistDir)).toBe(false);
        },
        30000
    );

    it(
        "emits bundled popup script at the path referenced by popup html",
        () => {
            runBuild(["--target=chrome"]);

            const { popupHtmlPath, scriptSrc } = getPopupHtmlScriptSrc();

            expect(scriptSrc).toBe("popup.js");

            const popupScriptPath = path.resolve(
                path.dirname(popupHtmlPath),
                scriptSrc
            );

            expect(popupScriptPath).toBe(
                path.join(chromeDistDir, "popup", "popup.js")
            );
            expect(fs.existsSync(popupScriptPath)).toBe(true);
            expect(fs.existsSync(path.join(chromeDistDir, "popup.js"))).toBe(false);

            const popupBundle = fs.readFileSync(popupScriptPath, "utf8");

            expect(popupBundle).not.toContain("__DEV__");
            expect(popupBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "does not copy raw source-only page or type files into chrome output",
        () => {
            runBuild(["--target=chrome"]);

            expect(
                fs.existsSync(path.join(chromeDistDir, "page", "chatStoreBridge", "config.js"))
            ).toBe(false);
            expect(fs.existsSync(path.join(chromeDistDir, "types"))).toBe(false);
        },
        30000
    );

    it(
        "builds production output with dev and profile globals disabled by default",
        () => {
            const output = runBuild(["--target=chrome"]);

            expect(output).toContain("dev=false");
            expect(output).toContain("profile=false");

            const contentBundle = readChromeBundle("content.js");
            const bridgeBootstrapBundle = readChromeBundle("bridgeBootstrap.js");
            const popupBundle = readChromeBundle("popup/popup.js");
            const pageBridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            for (const bundle of [
                contentBundle,
                bridgeBootstrapBundle,
                popupBundle,
                pageBridgeBundle,
            ]) {
                expect(bundle).not.toContain("__DEV__");
                expect(bundle).not.toContain("__PROFILE__");
            }
        },
        30000
    );

    it(
        "keeps dev globals disabled for non-minified debug builds unless dev is explicit",
        () => {
            const output = runBuild(["--target=chrome", "--no-minify"]);

            expect(output).toContain("debug");
            expect(output).toContain("dev=false");
            expect(output).toContain("profile=false");

            const popupBundle = readChromeBundle("popup/popup.js");
            const pageBridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(popupBundle).not.toContain("__DEV__");
            expect(popupBundle).not.toContain("__PROFILE__");
            expect(pageBridgeBundle).not.toContain("__DEV__");
            expect(pageBridgeBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "enables dev globals only for explicit dev builds",
        () => {
            const output = runBuild(["--target=chrome", "--no-minify", "--dev"]);

            expect(output).toContain("debug");
            expect(output).toContain("dev=true");
            expect(output).toContain("profile=false");

            const popupBundle = readChromeBundle("popup/popup.js");
            const pageBridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(popupBundle).not.toContain("__DEV__");
            expect(popupBundle).not.toContain("__PROFILE__");
            expect(pageBridgeBundle).not.toContain("__DEV__");
            expect(pageBridgeBundle).not.toContain("__PROFILE__");
        },
        30000
    );

    it(
        "enables profile globals for explicit profile builds without requiring dev",
        () => {
            const output = runBuild([
                "--target=chrome",
                "--no-minify",
                "--profile",
            ]);

            expect(output).toContain("debug");
            expect(output).toContain("dev=false");
            expect(output).toContain("profile=true");

            const popupBundle = readChromeBundle("popup/popup.js");
            const pageBridgeBundle = readChromeBundle("page/chatStorePageBridge.js");

            expect(popupBundle).not.toContain("__DEV__");
            expect(popupBundle).not.toContain("__PROFILE__");
            expect(pageBridgeBundle).not.toContain("__DEV__");
            expect(pageBridgeBundle).not.toContain("__PROFILE__");

            expect(pageBridgeBundle).toContain("__THREAD_OPTIMIZER_STORE_PROFILER__");
            expect(pageBridgeBundle).toContain("__THREAD_OPTIMIZER_CACHE_PROFILING__");
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
});