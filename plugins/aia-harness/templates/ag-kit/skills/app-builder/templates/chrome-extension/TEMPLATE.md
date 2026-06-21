---
name: chrome-extension
description: Chrome Extension template principles. Manifest V3, React, TypeScript.
---
<!-- Vendored from ag-kit (github.com/vudovn/ag-kit) @ 20a13da6d4414c7c6ae33db050a9c606eaef9f40 :: .agents/skills/app-builder/templates/chrome-extension/TEMPLATE.md. MIT (c) vudovn. -->

# Chrome Extension Template

> Versions reflect the latest stable line verified 2026-05. Pin to the current stable when scaffolding.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Manifest | V3 |
| UI | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Bundler | Vite + CRXJS (@crxjs/vite-plugin v2) |
| Storage | Chrome Storage API |

---

## Directory Structure

> CRXJS + Vite: `manifest.config.ts` is the source of truth, Vite resolves entries.

```
project-name/
├── src/
│   ├── popup/           # { index.html, main.tsx, Popup.tsx }
│   ├── options/         # { index.html, main.tsx, Options.tsx }
│   ├── background/      # service-worker.ts (MV3 service worker)
│   ├── content/         # { content-script.ts, content.css }
│   ├── components/      # Shared React
│   └── lib/
│       ├── storage.ts   # Chrome storage helpers
│       └── messaging.ts # Message passing
├── public/              # Static assets (icons)
├── manifest.config.ts   # defineManifest() — typed manifest
├── vite.config.ts       # crx({ manifest }) + react + tailwind
└── package.json
```

---

## Manifest V3 Concepts

| Component | Purpose |
|-----------|---------|
| Service Worker | Background processing |
| Content Scripts | Page injection |
| Popup | User interface |
| Options Page | Settings |

---

## Permissions

| Permission | Use |
|------------|-----|
| storage | Save user data |
| activeTab | Current tab access |
| scripting | Inject scripts |
| host_permissions | Site access |

---

## Setup Steps

1. `npm create vite@latest {{name}} -- --template react-ts`
2. Install CRXJS: `npm install -D @crxjs/vite-plugin@latest`
3. Add Chrome types: `npm install -D @types/chrome`
4. Create `manifest.config.ts` with `defineManifest`, wire `crx({ manifest })` in `vite.config.ts`
5. `npm run dev` (HMR for popup/options/content)
6. Load in Chrome: `chrome://extensions` → Load unpacked → select `dist/`

---

## Development Tips

| Task | Method |
|------|--------|
| Debug Popup | Right-click icon → Inspect |
| Debug Background | Extensions page → Service worker |
| Debug Content | DevTools console on page |
| Hot Reload | `npm run dev` (CRXJS HMR) |

---

## Best Practices

- Use type-safe messaging
- Wrap Chrome APIs in promises
- MV3 background is an ephemeral service worker — persist state in `chrome.storage`, not module globals; use event listeners + alarms, not long-lived timers
- Minimize permissions
- Scope content-script styles to avoid host-page bleed
