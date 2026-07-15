#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = process.cwd();

const DEFAULT_EXCLUDES = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "test-results",
    "playwright-report",
    ".cache",
    ".vite",
]);

const DEFAULT_ROOTS = [
    "src",
    "tests",
    "scripts",
];

function parseArgs(argv) {
    const args = {
        roots: [],
        maxDepth: 6,
        includeLineCounts: true,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "--root" || arg === "-r") {
            args.roots.push(argv[++i]);
        } else if (arg === "--max-depth" || arg === "-d") {
            args.maxDepth = Number(argv[++i]) || args.maxDepth;
        } else if (arg === "--no-lines") {
            args.includeLineCounts = false;
        }
    }

    if (args.roots.length === 0) {
        args.roots = DEFAULT_ROOTS;
    }

    return args;
}

function isExcluded(name) {
    return DEFAULT_EXCLUDES.has(name);
}

function countLines(filePath) {
    try {
        const text = fs.readFileSync(filePath, "utf8");
        if (!text) return 0;
        return text.split(/\r\n|\r|\n/).length;
    } catch {
        return null;
    }
}

function walk(dirPath, { depth, maxDepth, includeLineCounts, prefix = "" }) {
    if (depth > maxDepth) return;

    let entries = [];

    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
        console.log(`${prefix}[unreadable] ${path.relative(repoRoot, dirPath)}: ${error.message}`);
        return;
    }

    entries = entries
        .filter((entry) => !isExcluded(entry.name))
        .sort((a, b) => {
            if (a.isDirectory() !== b.isDirectory()) {
                return a.isDirectory() ? -1 : 1;
            }

            return a.name.localeCompare(b.name);
        });

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(repoRoot, fullPath);

        if (entry.isDirectory()) {
            console.log(`${prefix}${entry.name}/`);
            walk(fullPath, {
                depth: depth + 1,
                maxDepth,
                includeLineCounts,
                prefix: `${prefix}  `,
            });
            continue;
        }

        if (entry.isFile()) {
            const suffix = includeLineCounts
                ? ` (${countLines(fullPath) ?? "?"} lines)`
                : "";

            console.log(`${prefix}${entry.name}${suffix}`);
        }
    }
}

function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log(`# Repository tree context`);
    console.log(`# Root: ${repoRoot}`);
    console.log(`# Max depth: ${args.maxDepth}`);
    console.log("");

    for (const root of args.roots) {
        const fullRoot = path.resolve(repoRoot, root);

        if (!fs.existsSync(fullRoot)) {
            console.log(`## ${root}`);
            console.log(`[missing]`);
            console.log("");
            continue;
        }

        console.log(`## ${root}`);
        walk(fullRoot, {
            depth: 1,
            maxDepth: args.maxDepth,
            includeLineCounts: args.includeLineCounts,
        });
        console.log("");
    }
}

main();