# Thread Optimizer for ChatGPT

Performance-focused browser extension for long ChatGPT conversations.

Thread Optimizer improves responsiveness in large ChatGPT threads by reducing DOM pressure locally in your browser.

Features:
- Store-native hard pruning of old conversation history
- CSS-driven offscreen rendering optimization
- Streaming-aware pruning deferral
- Long prompt and code block scrollbar quality-of-life styles

This extension is an independent third-party project and is not affiliated with OpenAI.

---

## Most Useful Commands

### Verify everything and build the plugin (recommended before commits)
```bash
npm run verify
```
### Export project context
- Export full project:
```bash
npm run export
```

- Export only source code:
```bash
npm run export:src
```

- Export only tests (useful for debugging with AI):
```bash
npm run export:tests
```

- Export only runtime code (src + scripts):
```bash
npm run export:code
```

---

## Recommended Workflow
- While deploying
```bash
npm run verify
npm run export:tests
```

- While working on the project
```bash
npm run test:watch
```

## Key Files

- `src/content/core/index.js` → main content-script orchestrator
- `src/content/pruning/prune.js` → store-native pruning request flow
- `src/content/pruning/pruneController.js` → prune scheduling and lifecycle wrapper
- `src/content/pruning/pruneUi.js` → startup prune mask helpers
- `src/content/offscreen/offscreen.js` → section visibility optimization
- `src/content/streaming/replyTiming.js` → streaming-state detection
- `src/content/ui/qolStyles.js` → quality-of-life CSS rules
- `src/page/chatStorePageBridge.js` → page-context store optimization and pruning bridge