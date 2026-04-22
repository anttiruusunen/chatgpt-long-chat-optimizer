import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const {
    SUPPORTED_BROWSER_TARGETS,
    normalizeBrowserTarget,
    resolveBuildTargets,
    getEsbuildTargetForBrowser,
    createManifestForTarget,
    getBrowserDistDir,
} = require("../../scripts/build-utils.cjs");

describe("build-utils", () => {
    const baseManifest = {
        manifest_version: 3,
        name: "ChatGPT Thread Optimizer",
        version: "1.0.0",
        description: "Test manifest",
        permissions: ["tabs", "storage"],
        host_permissions: ["https://chatgpt.com/*"],
        action: {
            default_popup: "popup/popup.html",
        },
        content_scripts: [
            {
                matches: ["https://chatgpt.com/*"],
                js: ["content.js"],
                run_at: "document_idle",
            },
        ],
        browser_specific_settings: {
            gecko: {
                id: "thread-optimizer@example.com",
                strict_min_version: "121.0",
            },
        },
    };

    it("exports the supported browser target list", () => {
        expect(SUPPORTED_BROWSER_TARGETS).toEqual(["chrome", "firefox", "safari"]);
    });

    it("normalizes browser targets and accepts all", () => {
        expect(normalizeBrowserTarget("chrome")).toBe("chrome");
        expect(normalizeBrowserTarget("FIREFOX")).toBe("firefox");
        expect(normalizeBrowserTarget("safari")).toBe("safari");
        expect(normalizeBrowserTarget("all")).toBe("all");
        expect(normalizeBrowserTarget("")).toBe("all");
    });

    it("throws on unsupported browser targets", () => {
        expect(() => normalizeBrowserTarget("edge")).toThrow(
            'Unsupported browser target "edge"'
        );
    });

    it("resolves all targets when requested", () => {
        expect(resolveBuildTargets("all")).toEqual(["chrome", "firefox", "safari"]);
        expect(resolveBuildTargets(undefined)).toEqual(["chrome", "firefox", "safari"]);
    });

    it("resolves a single explicit target", () => {
        expect(resolveBuildTargets("chrome")).toEqual(["chrome"]);
        expect(resolveBuildTargets("firefox")).toEqual(["firefox"]);
        expect(resolveBuildTargets("safari")).toEqual(["safari"]);
    });

    it("maps browser targets to esbuild targets", () => {
        expect(getEsbuildTargetForBrowser("chrome")).toEqual(["chrome114"]);
        expect(getEsbuildTargetForBrowser("firefox")).toEqual(["firefox121"]);
        expect(getEsbuildTargetForBrowser("safari")).toEqual(["safari16.4"]);
    });

    it("creates a chrome manifest without firefox-specific settings", () => {
        const manifest = createManifestForTarget(baseManifest, "chrome");

        expect(manifest.browser_specific_settings).toBeUndefined();
        expect(manifest.name).toBe(baseManifest.name);
        expect(baseManifest.browser_specific_settings).toBeDefined();
    });

    it("creates a firefox manifest that preserves only gecko metadata", () => {
        const manifest = createManifestForTarget(baseManifest, "firefox");

        expect(manifest.browser_specific_settings).toEqual({
            gecko: {
                id: "thread-optimizer@example.com",
                strict_min_version: "121.0",
            },
        });
    });

    it("creates a safari manifest without firefox-specific settings", () => {
        const manifest = createManifestForTarget(baseManifest, "safari");

        expect(manifest.browser_specific_settings).toBeUndefined();
        expect(manifest.host_permissions).toEqual(["https://chatgpt.com/*"]);
    });

    it("adds the page bridge script as a web accessible resource", () => {
        const manifest = createManifestForTarget(baseManifest, "chrome");

        expect(manifest.web_accessible_resources).toEqual([
            {
                resources: ["page/chatStorePageBridge.js"],
                matches: ["https://chatgpt.com/*"],
            },
        ]);
    });

    it("builds browser-specific dist paths", () => {
        expect(getBrowserDistDir("/tmp/dist", "chrome")).toBe("/tmp/dist/chrome");
        expect(getBrowserDistDir("/tmp/dist", "firefox")).toBe("/tmp/dist/firefox");
        expect(getBrowserDistDir("/tmp/dist", "safari")).toBe("/tmp/dist/safari");
    });
});