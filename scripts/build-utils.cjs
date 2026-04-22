const path = require("path");

const SUPPORTED_BROWSER_TARGETS = Object.freeze([
    "chrome",
    "firefox",
    "safari",
]);

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeBrowserTarget(target) {
    const normalized = String(target || "").trim().toLowerCase();

    if (!normalized || normalized === "all") {
        return "all";
    }

    if (!SUPPORTED_BROWSER_TARGETS.includes(normalized)) {
        throw new Error(
            `Unsupported browser target "${target}". Expected one of: all, ${SUPPORTED_BROWSER_TARGETS.join(", ")}`
        );
    }

    return normalized;
}

function resolveBuildTargets(target) {
    const normalized = normalizeBrowserTarget(target);
    if (normalized === "all") {
        return [...SUPPORTED_BROWSER_TARGETS];
    }

    return [normalized];
}

function getEsbuildTargetForBrowser(target) {
    switch (target) {
        case "chrome":
            return ["chrome114"];
        case "firefox":
            return ["firefox121"];
        case "safari":
            return ["safari16.4"];
        default:
            throw new Error(`Unsupported browser target "${target}"`);
    }
}

function appendWebAccessibleResources(manifest, extraResourceConfig) {
    const existing = Array.isArray(manifest.web_accessible_resources)
        ? manifest.web_accessible_resources
        : [];

    manifest.web_accessible_resources = [
        ...existing,
        extraResourceConfig,
    ];
}

function createManifestForTarget(baseManifest, target) {
    const manifest = cloneJson(baseManifest);

    if (target !== "firefox") {
        delete manifest.browser_specific_settings;
    } else if (manifest.browser_specific_settings?.gecko) {
        manifest.browser_specific_settings = {
            gecko: manifest.browser_specific_settings.gecko,
        };
    }

    appendWebAccessibleResources(manifest, {
        resources: ["page/chatStorePageBridge.js"],
        matches: ["https://chatgpt.com/*"],
    });

    return manifest;
}

function getBrowserDistDir(rootDistDir, target) {
    return path.join(rootDistDir, target);
}

module.exports = {
    SUPPORTED_BROWSER_TARGETS,
    normalizeBrowserTarget,
    resolveBuildTargets,
    getEsbuildTargetForBrowser,
    createManifestForTarget,
    getBrowserDistDir,
};