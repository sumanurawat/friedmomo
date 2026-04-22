# Storyboarder

> A conversation-first storyboarding studio. Type one sentence, get a complete 3-act visual storyboard — characters, locations, eight shootable panels, all with inline AI-generated frames.

**Storyboarder** is the first product under the **Friedmomo** umbrella. It lives at **[friedmomo.com](https://friedmomo.com)** and runs entirely in your browser — no sign-up, no install, no Storyboarder server in the middle. Your stories, API key, and generated images stay on your device (IndexedDB). The only network traffic is between your browser and [OpenRouter](https://openrouter.ai), using your own API key over HTTPS.

A desktop build (Electron) is still produced from the same codebase for users who'd rather have a local app icon, but the web app is the primary way to use Storyboarder.

---

## Try it

- **Web app** — <https://friedmomo.com/app/> — open and start typing.
- **Landing page** — <https://friedmomo.com> — what it is, how it works, and why putting your OpenRouter key in a browser is safe.

On first run you'll be walked through getting a free [OpenRouter](https://openrouter.ai/keys) key (a minute or two) and dropped straight into the planner. The default planning model is Claude Opus 4.7; swap it in **Settings → Models** any time.

---

## What it does

Type something like *"the boy who cried wolf"* and Storyboarder produces:

- A **3-act story spine** with descriptively titled Acts (not generic "Setup / Confrontation / Resolution")
- **Named Scenes** for each act (e.g. *The Lonely Hillside → The First Cry → Villagers Arrive → …*)
- **3–5 core characters** with rich visual bibles used as continuity anchors
- **2–4 locations** with consistent visual language
- **One storyboard panel per scene** — each with a shot-size / angle / camera-movement direction (wide, medium, close-up, OTS, etc.), action, mood, dialogue, and cast
- **Inline AI-generated images** for every panel at 16:9

Then you iterate in chat: *"make shot 3 more claustrophobic"*, *"swap scene 4 for a reveal instead"*, *"reshoot this as stop-motion animation"*. The planner propagates medium changes through character and location bibles so continuity holds across panels.

---

## Running from source

Requires Node.js 20+ and an [OpenRouter API key](https://openrouter.ai/keys).

```bash
npm install
npm run dev
```

This boots the Node backend on `:3001` and the Vite dev server on `:4173`. Open <http://127.0.0.1:4173> and work through the first-run wizard to paste your OpenRouter key.

### Building the web app

```bash
# Build the PWA bundle into dist-web/
npm run build:web

# Build + serve it locally on :4173
npm run preview:web
```

The web build talks to OpenRouter directly from the browser — no Node backend involved. `vite.config.js` resolves `@ai-impl` and `@storage-impl` aliases at build time so the Electron-only server code is never even imported into the web bundle.

### Building the desktop app

```bash
# macOS universal DMG
npm run electron:build:mac

# Windows NSIS installer
npm run electron:build:win

# Linux AppImage + .deb
npm run electron:build:linux
```

Output lands in `release/`. Unsigned for v0.x — macOS users will see a one-time Gatekeeper prompt on first open (right-click → Open). Documented in [`docs/LAUNCH_PLAN.md`](docs/LAUNCH_PLAN.md).

### Publishing a release

The **web app** ships on every push to `main` via GitHub Actions → GitHub Pages. There's no separate release step — the next `git push` is the deploy.

The **desktop app** still publishes manually to GitHub Releases:

```bash
# Builds for the current OS and publishes to GitHub Releases
GH_TOKEN=... npm run release
```

The packaged desktop app auto-updates silently from the same GitHub Releases feed (electron-updater wired into the main process).

---

## How updates ship

The web app and the desktop app use completely different update mechanisms.

**Web app — instant on next reload.** Push to `main` → GitHub Actions rebuilds in ~30s → GitHub Pages serves the new bundle. Users get it on their next page load. No prompt, no download, no re-install; their IndexedDB data (key, settings, stories) is untouched.

The reason it works without version-skew pain:

- Vite fingerprints every bundle with a content hash (`index-D6jkarkf.js`). A new build produces a new hash → new URL → the browser fetches fresh. No stale-cache possible for the code.
- The service worker (`public/sw.js`) uses **network-first** for the HTML shell, so `index.html` — which points at the latest hashed bundle — is always fetched from the network when online, with the cache only as an offline fallback.
- Cross-origin traffic (OpenRouter) and hashed bundles bypass the SW entirely.
- The SW uses `skipWaiting()` + `clients.claim()`, so a new worker takes over immediately on reload instead of waiting for every tab to close.

Offline caveat: if you open the app offline, you boot the last-cached shell with the bundle it pointed at. Next online reload picks up whatever's current.

**Desktop app — electron-updater.** Unchanged from before. The packaged app polls GitHub Releases on launch, downloads any newer version in the background, and swaps it in on next restart.

---

## Analytics

The live site uses [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/) — aggregate pageviews, referrers, and countries. No cookies, no individual tracking, no third-party ad networks. We do it so we can tell whether anyone is using the site; that's the entire scope. The disclosure lives on [the privacy page](https://friedmomo.com/privacy.html).

**If you fork this repo** and want analytics on your own deploy:

1. Create a site at [Cloudflare → Web Analytics](https://one.dash.cloudflare.com/?to=/:account/web-analytics) and copy the beacon token (a hex string).
2. In your fork: Settings → Secrets and variables → Actions → New repository secret. Name it `CF_ANALYTICS_TOKEN`, paste the token.
3. Push to `main`. The deploy workflow substitutes the token into every HTML under `_site/` before uploading; locally the placeholder stays and the beacon never loads, so dev traffic never pollutes the dashboard.

If you don't want analytics, leave the secret unset. The workflow skips injection and serves the site unchanged — just remember to remove the analytics paragraph from `landing/privacy.html` so your privacy copy stays honest.

---

## Architecture

The same React codebase ships in two shapes. A build-time `VITE_STORYBOARDER_MODE` flag + Vite alias (`@ai-impl`, `@storage-impl`) swap in the right AI + storage implementations so neither bundle carries code it'll never use.

### Web mode (primary — what `friedmomo.com` serves)

```
┌─────────────────────────────────────────────────────────┐
│ Browser tab (friedmomo.com/app/)                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ React app                                           │ │
│ │   src/services/ai-direct.js  → OpenRouter client    │ │
│ │   src/services/storage-idb.js → IndexedDB (7 stores)│ │
│ │   public/sw.js                → PWA shell cache     │ │
│ └─────────┬───────────────────────────────────────────┘ │
│           │ HTTPS (streaming SSE for chat)              │
│           └─► OpenRouter API (user's own key)           │
└─────────────────────────────────────────────────────────┘

No Storyboarder server. Static files served by GitHub Pages.
User data lives in IndexedDB on the user's device.
```

### Desktop mode (Electron, same UI, local Node backend)

```
┌─────────────────────────────────────────────────────────┐
│ Desktop app (Electron)                                  │
│ ┌───────────────────┐    ┌─────────────────────────────┐│
│ │ Renderer (React)  │◄──►│ Main process                ││
│ │ UI, chat, board   │    │ Spawns Node backend child,  ││
│ │                   │    │ picks free port, opens      ││
│ │                   │    │ window at that port         ││
│ └─────────┬─────────┘    └─────────────────────────────┘│
│           │ HTTP on 127.0.0.1:<random>                  │
│           ▼                                             │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Node server (server/)                               │ │
│ │   /api/ai/chat   → planner (Opus/Gemini/GPT)        │ │
│ │   /api/ai/image  → image model (Gemini Flash Image) │ │
│ │   /api/ai/title  → locked to cheap Gemini Flash Lite│ │
│ │   /api/projects  → workspace filesystem             │ │
│ │   /api/settings  → ~/Storyboarder/config.json       │ │
│ │   /api/log       → append-only JSON-lines log       │ │
│ │   serves built Vite assets when STATIC_DIR is set   │ │
│ └─────────┬───────────────────────────────────────────┘ │
│           │                                             │
│           └─► OpenRouter API (user's own key)           │
└─────────────────────────────────────────────────────────┘

Workspace folder: ~/Storyboarder/
  ├── config.json          (API key + model preferences)
  ├── projects/<id>/       (storyboard + chat history + generated images)
  ├── entities/            (shared character/location library)
  └── logs/storyboarder.jsonl   (append-only observability log)
```

Full architecture detail in [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md).

---

## The planner brain

The LLM is guided by a system prompt in [`src/prompts/system-prompt.js`](src/prompts/system-prompt.js) that defines:

- The **Act → Scene → Panel** taxonomy and how to disambiguate user references
- The **JSON schema** for every mutation (`scenes_add`, `characters_update`, `locations_update`, `story_outline`, …)
- **Shot grammar** — when to use wide vs. medium vs. close-up, how to vary shot sizes across a storyboard for visual rhythm, how to format `visualDescription` fields like a shotlist
- **Continuity rules** — reuse character/location IDs, propagate medium changes to visual bibles, don't drift
- **Bootstrap mode vs. turn mode** — first-turn responses emit the full story spine + all 8 panels; subsequent turns emit targeted updates

An **enforcement layer** in `src/store/project-store.js` (`enforceSceneMutationPolicy`) silently rejects rule violations before any JSON is applied to the store. Every AI call is logged with correlation IDs — client requests, server upstream calls, streaming chunks, completion bytes — in `~/Storyboarder/logs/storyboarder.jsonl`.

---

## Documentation

| File | Purpose |
|---|---|
| [`docs/STORY_STRUCTURE.md`](docs/STORY_STRUCTURE.md) | **Start here.** The Act → Sequence → Shot hierarchy every part of the app runs on. |
| [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md) | End-to-end flow, prompt blocks, the text-modelling layer |
| [`docs/STORY_TAXONOMY.md`](docs/STORY_TAXONOMY.md) | Earlier notes on the vocabulary migration (superseded by STORY_STRUCTURE.md) |
| [`docs/STORY_BUILDING_EXPERIENCE.md`](docs/STORY_BUILDING_EXPERIENCE.md) | Multi-turn story-building test results + brain-upgrade recommendations |
| [`docs/UX_EXPERIMENT_REPORT.md`](docs/UX_EXPERIMENT_REPORT.md) | Single-turn UX observations on Claude Opus 4.7 |
| [`docs/TESTING.md`](docs/TESTING.md) | Button-by-button UI test results |
| [`docs/LAUNCH_PLAN.md`](docs/LAUNCH_PLAN.md) | Ship plan, channels, costs, 14-day schedule |
| [`docs/LAUNCH_PLAN_FRIEDMOMO.md`](docs/LAUNCH_PLAN_FRIEDMOMO.md) | Friedmomo-specific launch plan — landing page, email capture, future auth/tiers |

---

## Contact

- **Email** — <friedmomoapp@gmail.com> for anything: questions, bug reports, feedback, partnership.
- **Instagram** — [@friedmomo.app](https://instagram.com/friedmomo.app) — updates, example storyboards, behind-the-scenes.
- **Issues / PRs** — the [GitHub repo](https://github.com/sumanurawat/friedmomo) is the right place for anything code-shaped.

---

## Status

Public beta — live at [friedmomo.com](https://friedmomo.com). What's shipped so far:

- [x] Electron wrapper + macOS DMG pipeline (kept for users who want a desktop app)
- [x] electron-updater → GitHub Releases
- [x] First-run onboarding wizard (simplified to 2 steps — welcome + key)
- [x] Shot-grammar upgrade in the planner
- [x] Settings-store race fix
- [x] App icon
- [x] Landing page at [friedmomo.com](https://friedmomo.com)
- [x] Web app at [friedmomo.com/app/](https://friedmomo.com/app/) — IndexedDB storage, direct OpenRouter calls, PWA-installable
- [x] Tag `v0.1.0-beta` and publish first GitHub Release
- [ ] Enough real-user stories to know what to sharpen next

---

## License

TBD — all rights reserved until a decision is made.

## Credits

Developed with Claude (Anthropic) as a co-author. The planner runs on whichever model the user picks through OpenRouter.
