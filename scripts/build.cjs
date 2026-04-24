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

function buildTarget(target) {
    const outDir = getBrowserDistDir(distDir, target);

    fs.mkdirSync(outDir, { recursive: true });
    copyStaticFiles(srcDir, outDir);
    writeManifestForTarget(target, outDir);

    esbuild.buildSync({
        entryPoints: {
            content: path.join(srcDir, "content", "core", "index.js"),
            bridgeBootstrap: path.join(srcDir, "content", "bridge", "bridgeBootstrap.js"),
        },
        bundle: true,
        outdir: outDir,
        format: "iife",
        target: getEsbuildTargetForBrowser(target),
    });

    console.log(`Built ${target} extension -> ${outDir}`);
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

for (const target of targets) {
    buildTarget(target);
}

console.log(`Build complete for: ${targets.join(", ")}`);