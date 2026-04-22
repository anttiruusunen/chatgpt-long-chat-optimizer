#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const OUTPUT = 'project_context_full.txt';

const ROOT_FILES = new Set([
  'build.cjs',
  'playwright.config.js',
  'vitest.config.js',
  'package.json',
  'manifest.json'
]);

const INCLUDE_DIRS = new Set(['src', 'scripts', 'tests']);
const INCLUDE_EXTENSIONS = new Set([
  '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.md'
]);

function shouldIncludeFile(relPath) {
  const base = path.basename(relPath);
  if (ROOT_FILES.has(base)) return true;
  const ext = path.extname(relPath);
  return INCLUDE_EXTENSIONS.has(ext);
}

function walkIncludedDir(absDir, relDir = '') {
  const out = [];
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    const rel = path.join(relDir, entry.name);

    if (entry.isDirectory()) {
      out.push({ type: 'dir', path: rel });
      out.push(...walkIncludedDir(abs, rel));
      continue;
    }

    if (!shouldIncludeFile(rel)) continue;
    out.push({ type: 'file', path: rel });
  }

  return out;
}

function gatherEntries() {
  const entries = [];

  for (const file of ROOT_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      entries.push({ type: 'file', path: file });
    }
  }

  for (const dir of INCLUDE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    entries.push({ type: 'dir', path: dir });
    entries.push(...walkIncludedDir(abs, dir));
  }

  return entries;
}

function renderTree(entries) {
  return entries.map(e => e.path).join('\n');
}

function renderFileContents(fileEntries) {
  return fileEntries.map(({ path: relPath }) => {
    const abs = path.join(ROOT, relPath);
    let content = '';
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      content = `<<FAILED TO READ: ${err.message}>>`;
    }

    return [
      `===== FILE: ${relPath} =====`,
      content,
      ''
    ].join('\n');
  }).join('\n');
}

function main() {
  const entries = gatherEntries();
  const files = entries.filter(e => e.type === 'file');

  const output = [
    '===== PROJECT STATUS EXPORT =====',
    '',
    '===== DIRECTORY TREE =====',
    renderTree(entries),
    '',
    '===== COMPLETE FILE CONTENTS =====',
    renderFileContents(files)
  ].join('\n');

  fs.writeFileSync(path.join(ROOT, OUTPUT), output, 'utf8');
  console.log(`Exported ${files.length} files to ${OUTPUT}`);
}

main();
