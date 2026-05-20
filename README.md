# ChatGPT Long Chat Optimizer

Speed up long ChatGPT conversations by pruning old chat turns and reducing page slowdown.

This extension is an independent third-party project and is not affiliated with OpenAI.

## Features

- Store-native hard pruning of old conversation history
- CSS-driven offscreen rendering optimization
- Streaming-aware pruning deferral
- Pre-send pruning to avoid composer caret jumps while typing
- Prune overlay with a user-hide escape hatch
- Long prompt and code block scrollbar quality-of-life styles
- Popup settings for pruning, history limit, offscreen optimization, debug logging, store-read optimization, code scrollbars, and user-message clamping

---

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

---

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

---

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

---

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

---

## Export Project Context

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

---

## Key Files

- `src/content/core/index.js` → main content-script orchestrator
- `src/content/core/navigation.js` → ChatGPT route/navigation watcher
- `src/content/pruning/prune.js` → store-native pruning request flow
- `src/content/pruning/pruneController.js` → prune scheduling and lifecycle wrapper
- `src/content/ui/pruneOverlay.js` → visible pruning overlay and Hide action
- `src/content/ui/pruneOverlayWatchdog.js` → keeps active prune overlay mounted if the host app removes it
- `src/content/offscreen/offscreen.js` → section visibility optimization
- `src/content/streaming/replyTiming.js` → streaming-state detection
- `src/content/streaming/assistantSignals.js` → assistant/composer state helpers
- `src/content/ui/qolStyles.js` → quality-of-life CSS rules
- `src/page/chatStorePageBridge.js` → page-context store optimization and pruning bridge
- `src/popup/popup.js` → extension popup settings UI
- `scripts/build.cjs` → browser-target build script
- `scripts/package-release.cjs` → release zip packaging
- `scripts/verify-release-zip.cjs` → release zip verification