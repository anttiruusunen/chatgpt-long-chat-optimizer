# Thread Optimizer (Chrome Extension)

Performance-focused ChatGPT thread optimizer:
- Auto-pruning old sections
- CSS-driven offscreen rendering
- Streaming reply hiding
- Large code block optimization

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
- src/core/index.js → main orchestrator
- src/pruning/prune.js → pruning logic
- src/pruning/sentinelObservers.js → scroll-triggered restore/prune
- src/offscreen/offscreen.js → section visibility optimization
- src/streaming/streamingSection.js → streaming UI behavior
- src/ui/qolStyles.js → CSS rules