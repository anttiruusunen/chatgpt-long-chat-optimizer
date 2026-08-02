# ChatGPT Long Chat Optimizer

Keep long ChatGPT conversations fast from the moment they load — and responsive as you keep chatting.

Long Chat Optimizer keeps only your selected recent exchanges active on the current ChatGPT page. Older turns are hidden from the current page and removed from the page's local active conversation state, but they are not deleted from your saved ChatGPT conversation.

This extension is an independent third-party project and is not affiliated with OpenAI.

To show more older turns again, increase "Recent exchanges kept" or turn off the optimization and reload or reopen the chat.

## Features

* Fast initial load for long chats by keeping only recent exchanges active before the page renders
* Immediate long-chat pruning while you use ChatGPT — no reload-only workflow
* More than visual hiding: reduces both visible page weight and local active conversation state
* Targeted render/read caches for hot ChatGPT page lookups in long conversations
* Browser-native offscreen rendering optimization for out-of-view exchanges
* Optional scrollbars for long prompts and large code blocks
* Popup controls for recent exchanges kept, speedup behavior, scrollbars, and advanced performance options
* Older turns are hidden from the current page, not deleted from your saved conversation

## How it works

Long Chat Optimizer uses several local performance layers:

1. Initial-load hiding trims older conversation mapping data before the current page renders.
2. Store-native pruning removes older active-branch nodes from the page's local conversation graph after load and during use.
3. DOM pruning keeps hidden older turns out of the visible page.
4. Targeted caches speed up repeated page lookups in long conversations.
5. Optional offscreen rendering and scrollbars improve day-to-day usability.

All optimizations are local to the current browser page. Your saved ChatGPT conversation is not deleted.

## Privacy

Long Chat Optimizer runs locally in your browser. It does not collect, sell, transmit, or share your conversation data.

\---

## Most Useful Commands

### Run unit/integration tests and production build

```bash
npm run verify
```

This runs Vitest and then builds production outputs for all browser targets.

### Run unit/integration tests, Playwright E2E, and production build

```bash
npm run verify:full
```

This runs Vitest, Playwright E2E, and then a final production build.

### Package and verify release zips without Playwright

```bash
npm run verify:release
```

This runs:

```text
Vitest
→ production build for Chrome, Firefox, and Safari
→ package release zips
→ verify zip contents
```

### Package and verify release zips with Playwright

```bash
npm run verify:release:full
```

This runs:

```text
Vitest
→ Playwright E2E
→ production build for Chrome, Firefox, and Safari
→ package release zips
→ verify zip contents
```

### Run Playwright separately

```bash
npm run test:e2e
```

If Playwright is difficult to run from WSL, run it separately from Windows, then run this from WSL:

```bash
npm run verify:release
```

\---

## Build Commands

### Build all targets

```bash
npm run build
```

Outputs:

```text
dist/chrome/
dist/firefox/
dist/safari/
```

### Build one target

```bash
npm run build:chrome
npm run build:firefox
npm run build:safari
```

### Debug builds

```bash
npm run build:debug
npm run build:chrome:debug
npm run build:firefox:debug
npm run build:safari:debug
```

\---

## Release Packaging

### Package all targets

```bash
npm run package:all
```

Outputs:

```text
release/chatgpt-long-chat-optimizer-chrome-v1.0.0.zip
release/chatgpt-long-chat-optimizer-firefox-v1.0.0.zip
release/chatgpt-long-chat-optimizer-safari-v1.0.0.zip
```

### Package one target

```bash
npm run package:chrome
npm run package:firefox
npm run package:safari
```

### Verify release zips

```bash
npm run verify:zip
```

### Verify one release zip

```bash
npm run verify:zip:chrome
npm run verify:zip:firefox
npm run verify:zip:safari
```

The zip verifier checks required extension files, manifest references, popup script references, web-accessible resources, browser-specific manifest metadata, and rejects accidental source/test/build files.

\---

## Recommended Workflow

### While working

```bash
npm run test:watch
```

### Before committing

```bash
npm run verify
```

### Before releasing Chrome only

```bash
npm run verify:release:chrome
```

### Before releasing all targets

```bash
npm run verify:release
```

### Before releasing all targets with Playwright included

```bash
npm run verify:release:full
```

\---

## Export Project Context

These helper scripts are useful when sharing project context for debugging, code review, or AI-assisted development.

### Export full project

```bash
npm run export
```

### Export only source code

```bash
npm run export:src
```

### Export only tests

```bash
npm run export:tests
```

### Export runtime code

```bash
npm run export:code
```

\---

## Project Context Helpers

### Export a repository tree

Use `scripts/export-tree-context.cjs` when you need to inspect the repository structure before collecting specific files.

```bash
node scripts/export-tree-context.cjs > tree-context.txt
```

Export selected roots:

```bash
node scripts/export-tree-context.cjs --root src/page --root tests/bridge --max-depth 8 > tree-context-page-bridge.txt
```

Useful options:

```text
--root, -r       Add a root directory to include
--max-depth, -d  Limit directory depth
--no-lines       Do not include file line counts
```

Example:

```bash
node scripts/export-tree-context.cjs --root src --root tests --max-depth 6 > tree-context.txt
```

### Collect specific files into one context file

Use `scripts/collect-files.cjs` when you already know which files are relevant.

```bash
node scripts/collect-files.cjs src/content/core/index.js src/content/pruning/prune.js > selected-context.txt
```

Example for content-side pruning, overlay, reply timing, and offscreen logic:

```bash
node scripts/collect-files.cjs \\
  src/content/core/index.js \\
  src/content/core/dom.js \\
  src/content/core/state.js \\
  src/content/core/messages.js \\
  src/content/core/conversationMaintenance.js \\
  src/content/pruning/prune.js \\
  src/content/pruning/pruneController.js \\
  src/content/offscreen/offscreen.js \\
  src/content/streaming/replyTiming.js \\
  src/content/streaming/assistantSignals.js \\
  src/content/ui/pruneOverlay.js \\
  src/content/ui/pruneOverlayWatchdog.js \\
  tests/core/index.test.js \\
  tests/core/dom.test.js \\
  tests/pruning/pruneController.test.js \\
  tests/offscreen/offscreen.test.js \\
  > maintenance-pruning-context.txt
```

PuTTY / single-line version:

```bash
node scripts/collect-files.cjs src/content/core/index.js src/content/core/dom.js src/content/core/state.js src/content/core/messages.js src/content/core/conversationMaintenance.js src/content/pruning/prune.js src/content/pruning/pruneController.js src/content/offscreen/offscreen.js src/content/streaming/replyTiming.js src/content/streaming/assistantSignals.js src/content/ui/pruneOverlay.js src/content/ui/pruneOverlayWatchdog.js tests/core/index.test.js tests/core/dom.test.js tests/pruning/pruneController.test.js tests/offscreen/offscreen.test.js > maintenance-pruning-context.txt
```

Example for page-bridge/store optimisation context:

```bash
node scripts/collect-files.cjs \\
  src/page/chatStorePageBridge.js \\
  src/page/chatStoreBridge/cacheInstallers.js \\
  src/page/chatStoreBridge/cacheCore.js \\
  src/page/chatStoreBridge/storeEnhancements.js \\
  src/page/chatStoreBridge/storeValidation.js \\
  src/page/chatStoreBridge/initialLoadHiding.js \\
  tests/bridge/chatStorePageBridge.test.js \\
  > page-bridge-context.txt
```

PuTTY / single-line version:

```bash
node scripts/collect-files.cjs src/page/chatStorePageBridge.js src/page/chatStoreBridge/cacheInstallers.js src/page/chatStoreBridge/cacheCore.js src/page/chatStoreBridge/storeEnhancements.js src/page/chatStoreBridge/storeValidation.js src/page/chatStoreBridge/initialLoadHiding.js tests/bridge/chatStorePageBridge.test.js > page-bridge-context.txt
```

### Search for relevant implementation points

Use `grep` before collecting files when the exact file name is unknown.

```bash
grep -RniE "prune|deleteClientOnlyMessage|deleteNode|currentLeafId|historyKeptExchanges|removedCount|deletedCount|evictedCount" src/page tests/bridge
```

Save the result if it is long:

```bash
grep -RniE "prune|deleteClientOnlyMessage|deleteNode|currentLeafId|historyKeptExchanges|removedCount|deletedCount|evictedCount" src/page tests/bridge > store-prune-grep-context.txt
```

### Recommended context workflow

1. Export the tree first when file locations are uncertain.
2. Use `grep` to find likely implementation points.
3. Use `collect-files.cjs` to gather only the relevant files.
4. Upload or share the generated `.txt` context file.

Example:

```bash
node scripts/export-tree-context.cjs --root src/page --root tests/bridge --max-depth 8 > tree-context-page-bridge.txt
grep -RniE "prune|currentLeafId|historyKeptExchanges" src/page tests/bridge > store-prune-grep-context.txt
node scripts/collect-files.cjs src/page/chatStorePageBridge.js tests/bridge/chatStorePageBridge.test.js > store-prune-protection-context.txt
```

\---

## Key Files

* `src/content/core/index.js` → main content-script orchestrator
* `src/content/core/dom.js` → conversation container, section, anchor, and scroll-container discovery
* `src/content/core/navigation.js` → ChatGPT route/navigation watcher
* `src/content/core/conversationMaintenance.js` → coalesced conversation chrome/offscreen maintenance scheduling
* `src/content/core/messages.js` → popup/runtime message handling
* `src/content/pruning/prune.js` → store-native message hiding request flow
* `src/content/pruning/pruneController.js` → message hiding scheduling and lifecycle wrapper
* `src/content/ui/pruneOverlay.js` → visible message-hiding notice and Hide action
* `src/content/ui/pruneOverlayWatchdog.js` → keeps the active message-hiding notice mounted if the host app removes it
* `src/content/offscreen/offscreen.js` → section visibility optimization
* `src/content/offscreen/offscreenShared.js` → shared offscreen section style helpers
* `src/content/streaming/replyTiming.js` → streaming-state detection
* `src/content/streaming/assistantSignals.js` → assistant/composer state helpers
* `src/content/ui/qolStyles.js` → quality-of-life CSS rules
* `src/page/chatStorePageBridge.js` → page-context initial-load hiding, store optimization, and message-hiding bridge
* `src/page/chatStoreBridge/initialLoadHiding.js` → current-page conversation payload trimming before initial render
* `src/page/chatStoreBridge/cacheInstallers.js` → page-store cache wrapper installation
* `src/page/chatStoreBridge/cacheCore.js` → shared cache/stat helpers
* `src/page/chatStoreBridge/storeEnhancements.js` → page-store enhancement orchestration
* `src/page/chatStoreBridge/storeValidation.js` → page-store shape/feature detection
* `src/popup/popup.js` → extension popup settings UI
* `scripts/build.cjs` → browser-target build script
* `scripts/package-release.cjs` → release zip packaging
* `scripts/verify-release-zip.cjs` → release zip verification
* `scripts/collect-files.cjs` → concatenate selected files into one context file
* `scripts/export-tree-context.cjs` → export repository tree structure with optional line counts

