const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const {
    resolveBuildTargets,
    getEsbuildTargetForBrowser,
    createManifestForTarget,
    getBrowserDistDir,
} = require("./build-utils.cjs");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const srcDir = path.join(rootDir, "src");
const manifestPath = path.join(srcDir, "manifest.json");

function copyStaticFiles(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (
            (entry.isDirectory() && ["content", "background"].includes(entry.name)) ||
            entry.name === "manifest.json"
        ) {
            continue;
        }

        if (entry.isDirectory()) {
            fs.mkdirSync(destPath, { recursive: true });
            copyStaticFiles(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function writeManifestForTarget(target, outDir) {
    const baseManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const manifest = createManifestForTarget(baseManifest, target);

    fs.writeFileSync(
        path.join(outDir, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`
    );
}

function hasArg(name) {
    return process.argv.includes(name);
}

function getArgValue(name) {
    const prefix = `${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
}

function parseBoolean(value, fallback) {
    if (value == null || value === "") return fallback;

    const normalized = String(value).toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;

    return fallback;
}

function shouldMinifyBuild() {
    if (hasArg("--no-minify")) {
        return false;
    }

    const cliMinify = getArgValue("--minify");
    if (cliMinify != null) {
        return parseBoolean(cliMinify, true);
    }

    return parseBoolean(process.env.BUILD_MINIFY, true);
}

function shouldEnableBridgeProfiling() {
    if (hasArg("--bridge-profile")) {
        return true;
    }

    const cliProfile = getArgValue("--bridge-profile");
    if (cliProfile != null) {
        return parseBoolean(cliProfile, false);
    }

    return parseBoolean(process.env.BRIDGE_PROFILE, false);
}

function buildTarget(target, { minify, bridgeProfile }) {
    const outDir = getBrowserDistDir(distDir, target);

    fs.mkdirSync(outDir, { recursive: true });
    copyStaticFiles(srcDir, outDir);
    writeManifestForTarget(target, outDir);

    esbuild.buildSync({
        entryPoints: {
            content: path.join(srcDir, "content", "core", "index.js"),
            bridgeBootstrap: path.join(srcDir, "content", "bridge", "bridgeBootstrap.js"),
            "page/chatStorePageBridge": path.join(srcDir, "page", "chatStorePageBridge.js"),
        },
        bundle: true,
        outdir: outDir,
        format: "iife",
        target: getEsbuildTargetForBrowser(target),
        minify,
        sourcemap: !minify,
        legalComments: "none",
        define: {
            "globalThis.__THREAD_OPTIMIZER_DEBUG__": "false",
            "globalThis.__THREAD_OPTIMIZER_STORE_PROFILER__": JSON.stringify(bridgeProfile),
            "globalThis.__THREAD_OPTIMIZER_CACHE_PROFILING__": JSON.stringify(bridgeProfile),
            "globalThis.__THREAD_OPTIMIZER_BRANCH_CALLSITE_STATS__": JSON.stringify(bridgeProfile),
            "globalThis.__THREAD_OPTIMIZER_NODE_CALLSITE_STATS__": JSON.stringify(bridgeProfile),
            "globalThis.__THREAD_OPTIMIZER_FIND_NODE_CALLSITE_STATS__": JSON.stringify(bridgeProfile),
        },
    });

    console.log(
        `Built ${target} extension -> ${outDir} (${minify ? "minified" : "debug"}, bridgeProfile=${bridgeProfile})`
    );
}

function getRequestedTarget() {
    const cliTargetArg = process.argv.find((arg) => arg.startsWith("--target="));
    if (cliTargetArg) {
        return cliTargetArg.slice("--target=".length);
    }

    if (process.env.BROWSER_TARGET) {
        return process.env.BROWSER_TARGET;
    }

    return "all";
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const requestedTarget = getRequestedTarget();
const targets = resolveBuildTargets(requestedTarget);
const minify = shouldMinifyBuild();
const bridgeProfile = shouldEnableBridgeProfiling();

for (const target of targets) {
    buildTarget(target, { minify, bridgeProfile });
}

console.log(
    `Build complete for: ${targets.join(", ")} (${minify ? "minified" : "debug"}, bridgeProfile=${bridgeProfile})`
);