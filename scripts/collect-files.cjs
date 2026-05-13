#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join("export", "project_context_selected.txt");

function normalizeInputItems(rawItems) {
    return rawItems
        .flatMap((item) => String(item).split(/\r?\n/))
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/^["']|["']$/g, ""));
}

function toRelativeProjectPath(inputPath) {
    const normalized = inputPath.replaceAll("\\", "/");
    const absolute = path.isAbsolute(normalized)
        ? normalized
        : path.resolve(process.cwd(), normalized);

    return path.relative(rootDir, absolute).replaceAll("\\", "/");
}

function resolveProjectPath(inputPath) {
    const normalized = inputPath.replaceAll("\\", "/");

    if (path.isAbsolute(normalized)) {
        return normalized;
    }

    const fromCwd = path.resolve(process.cwd(), normalized);
    if (fs.existsSync(fromCwd)) {
        return fromCwd;
    }

    return path.resolve(rootDir, normalized);
}

function parseArgs(argv) {
    const args = [...argv];
    let outputPath = path.resolve(rootDir, DEFAULT_OUTPUT);
    const fileArgs = [];

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (arg === "--out" || arg === "-o") {
            const next = args[i + 1];
            if (!next) {
                throw new Error(`${arg} requires an output file path`);
            }

            outputPath = path.resolve(process.cwd(), next);
            i += 1;
            continue;
        }

        if (arg.startsWith("--out=")) {
            outputPath = path.resolve(process.cwd(), arg.slice("--out=".length));
            continue;
        }

        fileArgs.push(arg);
    }

    return {
        outputPath,
        files: normalizeInputItems(fileArgs),
    };
}

function readStdinIfAvailable() {
    if (process.stdin.isTTY) {
        return "";
    }

    return fs.readFileSync(0, "utf8");
}

function collectFiles(files) {
    const chunks = [];

    for (const inputPath of files) {
        const absolutePath = resolveProjectPath(inputPath);
        const relativePath = toRelativeProjectPath(absolutePath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`File not found: ${inputPath}`);
        }

        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) {
            throw new Error(`Not a file: ${inputPath}`);
        }

        const content = fs.readFileSync(absolutePath, "utf8");

        chunks.push(`${relativePath}:\n${content}\n`);
    }

    return chunks.join("\n");
}

function main() {
    const parsed = parseArgs(process.argv.slice(2));
    const stdinFiles = normalizeInputItems([readStdinIfAvailable()]);
    const files = [...parsed.files, ...stdinFiles];

    if (files.length === 0) {
        console.error(
            [
                "Usage:",
                "  node scripts/collect-files.cjs <file...> [-o output.txt]",
                "  printf 'src/a.js\\nsrc/b.js\\n' | node scripts/collect-files.cjs -o context.txt",
            ].join("\n")
        );
        process.exit(1);
    }

    const output = collectFiles(files);

    fs.mkdirSync(path.dirname(parsed.outputPath), { recursive: true });
    fs.writeFileSync(parsed.outputPath, output, "utf8");

    console.log(`Wrote ${files.length} file(s) to ${parsed.outputPath}`);
}

try {
    main();
} catch (error) {
    console.error(error?.message || String(error));
    process.exit(1);
}