import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

const packageScriptPath = path.join(rootDir, "scripts", "package-release.cjs");
const verifyZipScriptPath = path.join(rootDir, "scripts", "verify-release-zip.cjs");
const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);

const TARGETS = ["chrome", "firefox", "safari"];

let tempRoot;
let tempDistDir;
let tempReleaseDir;

function getZipPath(target) {
    return path.join(
        tempReleaseDir,
        `${packageJson.name}-${target}-v${packageJson.version}.zip`
    );
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

function writeFile(filePath, content = "") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function createManifest(target) {
    const manifest = {
        manifest_version: 3,
        name: "ChatGPT Long Chat Optimizer",
        version: packageJson.version,
        action: {
            default_popup: "popup/popup.html",
        },
        content_scripts: [
            {
                matches: ["https://chatgpt.com/*"],
                js: ["content.js", "bridgeBootstrap.js"],
            },
        ],
        web_accessible_resources: [
            {
                resources: ["page/chatStorePageBridge.js"],
                matches: ["https://chatgpt.com/*"],
            },
        ],
        icons: {
            16: "icons/icon-16.png",
            32: "icons/icon-32.png",
            48: "icons/icon-48.png",
            128: "icons/icon-128.png",
        },
    };

    if (target === "firefox") {
        manifest.browser_specific_settings = {
            gecko: {
                id: "chatgpt-long-chat-optimizer@example.com",
            },
        };
    }

    return JSON.stringify(manifest, null, 2);
}

function createFakeDistTarget(target) {
    const targetDir = path.join(tempDistDir, target);

    writeFile(path.join(targetDir, "manifest.json"), createManifest(target));
    writeFile(path.join(targetDir, "content.js"), "console.log('content');\n");
    writeFile(
        path.join(targetDir, "bridgeBootstrap.js"),
        "console.log('bridge bootstrap');\n"
    );
    writeFile(
        path.join(targetDir, "popup/popup.html"),
        '<!doctype html><html><body><script src="./popup.js"></script></body></html>\n'
    );
    writeFile(path.join(targetDir, "popup/popup.js"), "console.log('popup');\n");
    writeFile(
        path.join(targetDir, "page/chatStorePageBridge.js"),
        "console.log('page bridge');\n"
    );

    for (const size of [16, 32, 48, 128]) {
        writeFile(path.join(targetDir, `icons/icon-${size}.png`), `png-${size}`);
    }
}

function createFakeDistTargets(targets = TARGETS) {
    for (const target of targets) {
        createFakeDistTarget(target);
    }
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
    expect(entries.some((entry) => /icons\/.*(?:256|512).*\.png/i.test(entry))).toBe(
        false
    );
}

describe("release zip packaging", () => {
    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lco-release-zip-"));
        tempDistDir = path.join(tempRoot, "dist");
        tempReleaseDir = path.join(tempRoot, "release");
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it(
        "packages and verifies release zips for all browser targets",
        () => {
            createFakeDistTargets();

            const packageOutput = runNode(packageScriptPath, [
                "--target=all",
                `--dist-dir=${tempDistDir}`,
                `--release-dir=${tempReleaseDir}`,
            ]);

            for (const target of TARGETS) {
                expect(packageOutput).toContain(`Packaged ${target} release`);
                expect(fs.existsSync(getZipPath(target))).toBe(true);
            }

            const verifyOutput = runNode(verifyZipScriptPath, [
                "--target=all",
                `--release-dir=${tempReleaseDir}`,
            ]);

            for (const target of TARGETS) {
                expect(verifyOutput).toContain(`Verified ${target} release zip`);

                const entries = readZipEntries(getZipPath(target));
                expectValidReleaseEntries(entries);
            }
        },
        30000
    );

    it(
        "fails zip verification when a required entry is missing",
        () => {
            createFakeDistTargets(["chrome"]);

            runNode(packageScriptPath, [
                "--target=chrome",
                `--dist-dir=${tempDistDir}`,
                `--release-dir=${tempReleaseDir}`,
            ]);

            const zipPath = getZipPath("chrome");

            expect(fs.existsSync(zipPath)).toBe(true);

            const zip = new AdmZip(zipPath);
            zip.deleteFile("content.js");
            zip.writeZip(zipPath);

            expect(() =>
                runNode(verifyZipScriptPath, [
                    "--target=chrome",
                    `--release-dir=${tempReleaseDir}`,
                ])
            ).toThrow(/missing required entries/i);
        },
        30000
    );

    it(
        "fails zip verification when forbidden source files are included",
        () => {
            createFakeDistTargets(["chrome"]);

            runNode(packageScriptPath, [
                "--target=chrome",
                `--dist-dir=${tempDistDir}`,
                `--release-dir=${tempReleaseDir}`,
            ]);

            const zipPath = getZipPath("chrome");

            expect(fs.existsSync(zipPath)).toBe(true);

            const zip = new AdmZip(zipPath);
            zip.addFile("src/accidental-source.js", Buffer.from("console.log('nope');"));
            zip.writeZip(zipPath);

            expect(() =>
                runNode(verifyZipScriptPath, [
                    "--target=chrome",
                    `--release-dir=${tempReleaseDir}`,
                ])
            ).toThrow(/forbidden entries/i);
        },
        30000
    );

    it(
        "fails zip verification when oversized store icons are included",
        () => {
            createFakeDistTargets(["chrome"]);

            runNode(packageScriptPath, [
                "--target=chrome",
                `--dist-dir=${tempDistDir}`,
                `--release-dir=${tempReleaseDir}`,
            ]);

            const zipPath = getZipPath("chrome");

            expect(fs.existsSync(zipPath)).toBe(true);

            const zip = new AdmZip(zipPath);
            zip.addFile("icons/icon-512.png", Buffer.from("not really a png"));
            zip.writeZip(zipPath);

            expect(() =>
                runNode(verifyZipScriptPath, [
                    "--target=chrome",
                    `--release-dir=${tempReleaseDir}`,
                ])
            ).toThrow(/forbidden entries/i);
        },
        30000
    );
});