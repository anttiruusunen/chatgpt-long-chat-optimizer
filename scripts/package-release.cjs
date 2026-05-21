const fs = require("node:fs");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { resolveBuildTargets } = require("./build-utils.cjs");

const rootDir = path.resolve(__dirname, "..");
const packageJsonPath = path.join(rootDir, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

function getArgValue(name, fallback = null) {
    const prefix = `${name}=`;
    const arg = process.argv.find((item) => item.startsWith(prefix));

    return arg ? arg.slice(prefix.length) : fallback;
}

function resolveFromRoot(value, fallback) {
    if (!value) {
        return fallback;
    }

    return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

function walkFiles(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...walkFiles(fullPath, baseDir));
            continue;
        }

        if (entry.isFile()) {
            files.push({
                fullPath,
                zipPath: path.relative(baseDir, fullPath).replaceAll(path.sep, "/"),
            });
        }
    }

    return files;
}

function getRequiredFilesForTarget() {
    return [
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
}

function assertBuiltExtension(target, distTargetDir) {
    const missing = getRequiredFilesForTarget().filter(
        (relativePath) => !fs.existsSync(path.join(distTargetDir, relativePath))
    );

    if (missing.length > 0) {
        throw new Error(
            [
                `Cannot package ${target} release because ${distTargetDir} is missing required files:`,
                ...missing.map((item) => `- ${item}`),
                "",
                `Run: npm run build:${target}`,
            ].join("\n")
        );
    }
}

function packageTarget(target, options = {}) {
    const {
        distRoot = path.join(rootDir, "dist"),
        releaseDir = path.join(rootDir, "release"),
        outputOverride = null,
    } = options;

    const distTargetDir = path.join(distRoot, target);
    const outputPath =
        outputOverride ||
        path.join(
            releaseDir,
            `${packageJson.name}-${target}-v${packageJson.version}.zip`
        );

    if (!fs.existsSync(distTargetDir)) {
        throw new Error(
            `Missing build output: ${distTargetDir}\nRun: npm run build:${target}`
        );
    }

    assertBuiltExtension(target, distTargetDir);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const zip = new AdmZip();
    const files = walkFiles(distTargetDir);

    for (const file of files) {
        zip.addLocalFile(file.fullPath, path.dirname(file.zipPath));
    }

    zip.writeZip(outputPath);

    const sizeBytes = fs.statSync(outputPath).size;

    console.log(`Packaged ${target} release: ${path.relative(rootDir, outputPath)}`);
    console.log(`Files: ${files.length}`);
    console.log(`Size: ${Math.round(sizeBytes / 1024)} KB`);

    return outputPath;
}

const requestedTarget = getArgValue("--target", "all");
const outputOverride = getArgValue("--out", null);
const distRoot = resolveFromRoot(getArgValue("--dist-dir", null), path.join(rootDir, "dist"));
const releaseDir = resolveFromRoot(
    getArgValue("--release-dir", null),
    path.join(rootDir, "release")
);
const targets = resolveBuildTargets(requestedTarget);

if (outputOverride && targets.length > 1) {
    throw new Error("--out can only be used with a single --target");
}

for (const target of targets) {
    packageTarget(target, {
        distRoot,
        releaseDir,
        outputOverride,
    });
}