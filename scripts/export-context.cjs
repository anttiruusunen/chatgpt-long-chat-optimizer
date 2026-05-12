#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT_DIR = "export";
const OUTPUT = "project_context_full.txt";

const ROOT_FILES = new Set([
    ".gitignore",
    "LICENSE",
    "LICENSE.md",
    "README.md",
    "PRIVACY.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "playwright.config.js",
    "vitest.config.js",
    "package.json",
    "package-lock.json",
    "manifest.json",
]);

const MODE_TO_DIRS = {
    all: ["src", "scripts", "tests"],
    src: ["src"],
    tests: ["tests"],
    code: ["src", "scripts"],
};

const INCLUDE_EXTENSIONS = new Set([
    ".js",
    ".cjs",
    ".mjs",
    ".ts",
    ".tsx",
    ".jsx",
    ".json",
    ".css",
    ".html",
    ".md",
]);

function normalizeRelPath(input) {
    return String(input || "")
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
}

function isPathInsideRoot(absPath) {
    const relative = path.relative(ROOT, absPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv) {
    const args = argv.slice(2);

    let mode = "all";
    let output = OUTPUT;
    let customDir = null;
    let includeRootFiles = true;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (arg === "--mode" || arg === "-m") {
            mode = args[i + 1] || mode;
            i += 1;
            continue;
        }

        if (arg === "--dir" || arg === "-d") {
            customDir = normalizeRelPath(args[i + 1]);
            i += 1;
            continue;
        }

        if (arg === "--output" || arg === "-o") {
            output = args[i + 1] || output;
            i += 1;
            continue;
        }

        if (arg === "--no-root-files") {
            includeRootFiles = false;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            printHelpAndExit(0);
        }

        if (!arg.startsWith("-")) {
            mode = arg;
        }
    }

    if (customDir) {
        const absCustomDir = path.resolve(ROOT, customDir);

        if (!isPathInsideRoot(absCustomDir)) {
            console.error(`Refusing to export outside project root: ${customDir}`);
            process.exit(1);
        }

        if (!fs.existsSync(absCustomDir) || !fs.statSync(absCustomDir).isDirectory()) {
            console.error(`Directory does not exist: ${customDir}`);
            process.exit(1);
        }

        return {
            mode: `dir:${customDir}`,
            output,
            selectedDirs: [customDir],
            includeRootFiles,
        };
    }

    if (!MODE_TO_DIRS[mode]) {
        console.error(
            `Unknown mode "${mode}". Expected one of: ${Object.keys(MODE_TO_DIRS).join(", ")}`
        );
        process.exit(1);
    }

    return {
        mode,
        output,
        selectedDirs: MODE_TO_DIRS[mode],
        includeRootFiles,
    };
}

function printHelpAndExit(code = 0) {
    console.log(`
Usage:
  node scripts/export-context.cjs
  node scripts/export-context.cjs <mode>
  node scripts/export-context.cjs --mode <mode> --output <file>
  node scripts/export-context.cjs --dir <folder> --output <file>
  node scripts/export-context.cjs --dir <folder> --no-root-files

Modes:
  all    Export root files + src + scripts + tests (default)
  src    Export root files + src
  tests  Export root files + tests
  code   Export root files + src + scripts

Folder export:
  --dir, -d          Export only this folder and its contents
  --no-root-files    Do not include README/package/etc when using any export mode

Examples:
  node scripts/export-context.cjs
  node scripts/export-context.cjs tests
  node scripts/export-context.cjs --mode src
  node scripts/export-context.cjs --mode tests --output testing_context.txt
  node scripts/export-context.cjs --dir src/page --output bridge_context.txt
  node scripts/export-context.cjs --dir src/page/chatStoreBridge --no-root-files --output bridge_modules_context.txt
`.trim());
    process.exit(code);
}

function shouldIncludeFile(relPath) {
    const normalized = relPath.split(path.sep).join("/");
    const base = path.basename(normalized);

    if (ROOT_FILES.has(normalized) || ROOT_FILES.has(base)) {
        return true;
    }

    const ext = path.extname(normalized);
    return INCLUDE_EXTENSIONS.has(ext);
}

function walkIncludedDir(absDir, relDir = "") {
    const out = [];
    const entries = fs
        .readdirSync(absDir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        const abs = path.join(absDir, entry.name);
        const rel = path.join(relDir, entry.name);

        if (entry.isDirectory()) {
            out.push({ type: "dir", path: rel });
            out.push(...walkIncludedDir(abs, rel));
            continue;
        }

        if (!shouldIncludeFile(rel)) continue;
        out.push({ type: "file", path: rel });
    }

    return out;
}

function gatherEntries(selectedDirs, { includeRootFiles = true } = {}) {
    const entries = [];

    if (includeRootFiles) {
        for (const file of ROOT_FILES) {
            const abs = path.join(ROOT, file);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                entries.push({ type: "file", path: file });
            }
        }
    }

    for (const dir of selectedDirs) {
        const abs = path.join(ROOT, dir);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;

        entries.push({ type: "dir", path: dir });
        entries.push(...walkIncludedDir(abs, dir));
    }

    return entries;
}

function renderTree(entries) {
    return entries.map((e) => e.path).join("\n");
}

function renderFileContents(fileEntries) {
    return fileEntries
        .map(({ path: relPath }) => {
            const abs = path.join(ROOT, relPath);
            let content = "";

            try {
                content = fs.readFileSync(abs, "utf8");
            } catch (err) {
                content = `<<FAILED TO READ: ${err.message}>>`;
            }

            return [`===== FILE: ${relPath} =====`, content, ""].join("\n");
        })
        .join("\n");
}

function main() {
    const {
        mode,
        output,
        selectedDirs,
        includeRootFiles,
    } = parseArgs(process.argv);

    const entries = gatherEntries(selectedDirs, { includeRootFiles });
    const files = entries.filter((e) => e.type === "file");

    const renderedOutput = [
        "===== PROJECT STATUS EXPORT =====",
        "",
        `===== MODE: ${mode} =====`,
        `===== INCLUDED ROOT FILES: ${includeRootFiles ? "yes" : "no"} =====`,
        `===== INCLUDED DIRS: ${selectedDirs.join(", ") || "(none)"} =====`,
        "",
        "===== DIRECTORY TREE =====",
        renderTree(entries),
        "",
        "===== COMPLETE FILE CONTENTS =====",
        renderFileContents(files),
    ].join("\n");

    const exportDir = path.join(ROOT, OUTPUT_DIR);
    fs.mkdirSync(exportDir, { recursive: true });

    fs.writeFileSync(path.join(exportDir, output), renderedOutput, "utf8");

    console.log(
        `Exported ${files.length} files in mode "${mode}" to ${path.join(
            OUTPUT_DIR,
            output
        )}`
    );
}

main();