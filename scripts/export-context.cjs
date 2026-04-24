#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUTPUT_DIR = "export";
const OUTPUT = "project_context_full.txt";

const ROOT_FILES = new Set([
  "build.cjs",
  "playwright.config.js",
  "vitest.config.js",
  "package.json",
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

function parseArgs(argv) {
  const args = argv.slice(2);

  let mode = "all";
  let output = OUTPUT;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--mode" || arg === "-m") {
      mode = args[i + 1] || mode;
      i += 1;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      output = args[i + 1] || output;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit(0);
    }

    if (!arg.startsWith("-")) {
      mode = arg;
    }
  }

  if (!MODE_TO_DIRS[mode]) {
    console.error(
      `Unknown mode "${mode}". Expected one of: ${Object.keys(MODE_TO_DIRS).join(", ")}`
    );
    process.exit(1);
  }

  return { mode, output };
}

function printHelpAndExit(code = 0) {
  console.log(`
Usage:
  node export-context.cjs
  node export-context.cjs <mode>
  node export-context.cjs --mode <mode> --output <file>

Modes:
  all    Export root files + src + scripts + tests (default)
  src    Export root files + src
  tests  Export root files + tests
  code   Export root files + src + scripts

Examples:
  node export-context.cjs
  node export-context.cjs tests
  node export-context.cjs --mode src
  node export-context.cjs --mode tests --output testing_context.txt
`.trim());
  process.exit(code);
}

function shouldIncludeFile(relPath) {
  const base = path.basename(relPath);
  if (ROOT_FILES.has(base)) return true;

  const ext = path.extname(relPath);
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

function gatherEntries(selectedDirs) {
  const entries = [];

  for (const file of ROOT_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      entries.push({ type: "file", path: file });
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
  const { mode, output } = parseArgs(process.argv);
  const selectedDirs = MODE_TO_DIRS[mode];

  const entries = gatherEntries(selectedDirs);
  const files = entries.filter((e) => e.type === "file");

  const renderedOutput = [
    "===== PROJECT STATUS EXPORT =====",
    "",
    `===== MODE: ${mode} =====`,
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
    `Exported ${files.length} files in mode "${mode}" to ${path.join(OUTPUT_DIR, output)}`
  );
}

main();