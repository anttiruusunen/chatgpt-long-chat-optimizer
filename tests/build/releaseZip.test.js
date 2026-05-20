import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const buildScriptPath = path.join(rootDir, "scripts", "build.cjs");
const packageScriptPath = path.join(rootDir, "scripts", "package-release.cjs");
const verifyZipScriptPath = path.join(rootDir, "scripts", "verify-release-zip.cjs");
const distDir = path.join(rootDir, "dist");
const releaseDir = path.join(rootDir, "release");
const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);

const TARGETS = ["chrome", "firefox", "safari"];

function getZipPath(target) {
    return path.join(
        releaseDir,
        `${packageJson.name}-${target}-v${packageJson.version}.zip`
    );
}

function removeOutputs() {
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(releaseDir, { recursive: true, force: true });
}

function runNode(scriptPath, args = []) {
    return execFileSync(process.execPath, [scriptPath, ...args], {
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
        },
    });
}

function readZipEntries(zipPath) {
    const zip = new AdmZip(zipPath);

    return zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.entryName.replaceAll("\\", "/"))
        .sort();
}

function expectValidReleaseEntries(entries) {
    expect(entries).toEqual(
        expect.arrayContaining([
            "manifest.json",
            "content.js",
            "bridgeBootstrap.js",
            "popup/popup.html",
            "popup/popup.js",
            "page/chatStorePageBridge.js",
            "icons/icon-16.png",
            "icons/icon-32.png",
            "icons/icon-48.png",
            "icons/icon-128.png",
        ])
    );

    expect(entries.some((entry) => entry.startsWith("src/"))).toBe(false);
    expect(entries.some((entry) => entry.startsWith("tests/"))).toBe(false);
    expect(entries.some((entry) => entry.startsWith("node_modules/"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".map"))).toBe(false);
}

describe("release zip packaging", () => {
    beforeEach(() => {
        removeOutputs();
    });

    afterEach(() => {
        removeOutputs();
    });

    it(
        "packages and verifies release zips for all browser targets",
        () => {
            runNode(buildScriptPath, ["--target=all"]);

            const packageOutput = runNode(packageScriptPath, ["--target=all"]);

            for (const target of TARGETS) {
                expect(packageOutput).toContain(`Packaged ${target} release`);
                expect(fs.existsSync(getZipPath(target))).toBe(true);
            }

            const verifyOutput = runNode(verifyZipScriptPath, ["--target=all"]);

            for (const target of TARGETS) {
                expect(verifyOutput).toContain(`Verified ${target} release zip`);

                const entries = readZipEntries(getZipPath(target));
                expectValidReleaseEntries(entries);
            }
        },
        60000
    );

    it(
        "fails zip verification when a required entry is missing",
        () => {
            runNode(buildScriptPath, ["--target=chrome"]);
            runNode(packageScriptPath, ["--target=chrome"]);

            const zipPath = getZipPath("chrome");

            expect(fs.existsSync(zipPath)).toBe(true);

            const zip = new AdmZip(zipPath);
            zip.deleteFile("content.js");
            zip.writeZip(zipPath);

            expect(() =>
                runNode(verifyZipScriptPath, ["--target=chrome"])
            ).toThrow(/missing required entries/i);
        },
        30000
    );

    it(
        "fails zip verification when forbidden source files are included",
        () => {
            runNode(buildScriptPath, ["--target=chrome"]);
            runNode(packageScriptPath, ["--target=chrome"]);

            const zipPath = getZipPath("chrome");

            expect(fs.existsSync(zipPath)).toBe(true);

            const zip = new AdmZip(zipPath);
            zip.addFile("src/accidental-source.js", Buffer.from("console.log('nope');"));
            zip.writeZip(zipPath);

            expect(() =>
                runNode(verifyZipScriptPath, ["--target=chrome"])
            ).toThrow(/forbidden entries/i);
        },
        30000
    );
});