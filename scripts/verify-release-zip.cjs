const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { resolveBuildTargets } = require("./build-utils.cjs");

const rootDir = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8")
);

function getArgValue(name, fallback = null) {
    const prefix = `${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));

    return arg ? arg.slice(prefix.length) : fallback;
}

function hasArg(name) {
    return process.argv.includes(name);
}

function resolveFromRoot(value, fallback) {
    if (!value) {
        return fallback;
    }

    return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function fail(message, details = []) {
    const renderedDetails = details.length
        ? `\n${details.map((item) => `- ${item}`).join("\n")}`
        : "";

    throw new Error(`${message}${renderedDetails}`);
}

function getZipPathForTarget(target, releaseDir, zipOverride = null) {
    return (
        zipOverride ||
        path.join(
            releaseDir,
            `${packageJson.name}-${target}-v${packageJson.version}.zip`
        )
    );
}

function verifyZipForTarget(target, zipPath, { allowSourceMaps = false } = {}) {
    if (!fs.existsSync(zipPath)) {
        fail(`Release zip does not exist: ${path.relative(rootDir, zipPath)}`);
    }

    const zip = new AdmZip(zipPath);
    const entries = zip
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .map((entry) => entry.entryName.replaceAll("\\", "/"))
        .sort();

    const entrySet = new Set(entries);

    const requiredEntries = [
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
    ];

    const missingRequired = requiredEntries.filter((entry) => !entrySet.has(entry));

    if (missingRequired.length > 0) {
        fail(`${target} release zip is missing required entries:`, missingRequired);
    }

    const forbiddenPatterns = [
        /^src\//,
        /^tests\//,
        /^scripts\//,
        /^node_modules\//,
        /^dist\//,
        /^release\//,
        /^\.git\//,
        /^\.github\//,
        /^icons\/icon-256\.png$/i,
        /^icons\/icon-512\.png$/i,
        /^icons\/.*(?:256|512).*\.png$/i,
        /(^|\/)\.DS_Store$/,
        /(^|\/)Thumbs\.db$/,
        /(^|\/)package\.json$/,
        /(^|\/)package-lock\.json$/,
        /(^|\/)pnpm-lock\.yaml$/,
        /(^|\/)yarn\.lock$/,
        /(^|\/)vitest\.config\./,
        /(^|\/)playwright\.config\./,
    ];

    if (!allowSourceMaps) {
        forbiddenPatterns.push(/\.map$/);
    }

    const forbiddenEntries = entries.filter((entry) =>
        forbiddenPatterns.some((pattern) => pattern.test(entry))
    );

    if (forbiddenEntries.length > 0) {
        fail(`${target} release zip contains forbidden entries:`, forbiddenEntries);
    }

    const manifestEntry = zip.getEntry("manifest.json");

    if (!manifestEntry) {
        fail(`${target} release zip is missing manifest.json`);
    }

    const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));

    if (manifest.manifest_version !== 3) {
        fail(
            `${target} manifest_version should be 3, received ${manifest.manifest_version}`
        );
    }

    if (manifest.version !== packageJson.version) {
        fail(`${target} manifest version does not match package.json`, [
            `manifest.version=${manifest.version}`,
            `package.version=${packageJson.version}`,
        ]);
    }

    if (target === "firefox") {
        if (!manifest.browser_specific_settings?.gecko?.id) {
            fail("Firefox zip is missing gecko browser_specific_settings");
        }
    } else if (manifest.browser_specific_settings) {
        fail(`${target} zip should not include firefox-specific settings`);
    }

    if (!Array.isArray(manifest.content_scripts)) {
        fail(`${target} manifest content_scripts is missing or invalid`);
    }

    const contentScriptFiles = manifest.content_scripts.flatMap((script) =>
        Array.isArray(script.js) ? script.js : []
    );

    for (const jsFile of contentScriptFiles) {
        if (!entrySet.has(jsFile)) {
            fail(`${target} manifest references a missing content script:`, [
                jsFile,
            ]);
        }
    }

    const popupPath = manifest.action?.default_popup;

    if (!popupPath || !entrySet.has(popupPath)) {
        fail(`${target} manifest action.default_popup is missing from zip:`, [
            popupPath || "<missing>",
        ]);
    }

    const popupHtml = zip.getEntry(popupPath)?.getData().toString("utf8") || "";
    const popupScriptMatch = popupHtml.match(
        /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/
    );

    if (!popupScriptMatch) {
        fail(`${target} popup HTML does not reference a script tag`);
    }

    const popupScriptPath = path.posix.normalize(
        path.posix.join(path.posix.dirname(popupPath), popupScriptMatch[1])
    );

    if (!entrySet.has(popupScriptPath)) {
        fail(`${target} popup HTML references a missing script:`, [
            popupScriptPath,
        ]);
    }

    const webAccessibleResources = manifest.web_accessible_resources || [];
    const webAccessibleFiles = webAccessibleResources.flatMap((resource) =>
        Array.isArray(resource.resources) ? resource.resources : []
    );

    for (const resource of webAccessibleFiles) {
        if (!entrySet.has(resource)) {
            fail(`${target} manifest references a missing web accessible resource:`, [
                resource,
            ]);
        }
    }

    console.log(`Verified ${target} release zip: ${path.relative(rootDir, zipPath)}`);
    console.log(`Entries: ${entries.length}`);
}

const requestedTarget = getArgValue("--target", "all");
const zipOverride = getArgValue("--zip", null);
const releaseDir = resolveFromRoot(
    getArgValue("--release-dir", null),
    path.join(rootDir, "release")
);
const allowSourceMaps = hasArg("--allow-source-maps");
const targets = resolveBuildTargets(requestedTarget);

if (zipOverride && targets.length > 1) {
    throw new Error("--zip can only be used with a single --target");
}

for (const target of targets) {
    verifyZipForTarget(target, getZipPathForTarget(target, releaseDir, zipOverride), {
        allowSourceMaps,
    });
}