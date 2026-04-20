# Storyboarder

> A conversation-first storyboarding studio. Type one sentence, get a complete 3-act visual storyboard — characters, locations, eight shootable panels, all with inline AI-generated frames.

**Storyboarder** is the first product under the **Friedmomo** umbrella. It runs entirely on your laptop. Your stories, API keys, and generated images stay on your machine. The only network traffic is between your laptop and [OpenRouter](https://openrouter.ai), using your own API key.

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

This boots the Node backend on `:3001` and the Vite dev server on `:4173`. Open <http://127.0.0.1:4173> and work through the first-run wizard to paste your OpenRouter key and pick a planning model.

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

```bash
# Builds for the current OS and publishes to GitHub Releases
GH_TOKEN=... npm run release
```

The packaged app auto-updates silently from the same GitHub Releases feed (electron-updater wired into the main process).

---

## Architecture

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
| [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md) | End-to-end flow, prompt blocks, the text-modelling layer |
| [`docs/STORY_TAXONOMY.md`](docs/STORY_TAXONOMY.md) | Why the Act / Scene / Panel vocabulary (3-phase migration plan) |
| [`docs/STORY_BUILDING_EXPERIENCE.md`](docs/STORY_BUILDING_EXPERIENCE.md) | Multi-turn story-building test results + brain-upgrade recommendations |
| [`docs/UX_EXPERIMENT_REPORT.md`](docs/UX_EXPERIMENT_REPORT.md) | Single-turn UX observations on Claude Opus 4.7 |
| [`docs/TESTING.md`](docs/TESTING.md) | Button-by-button UI test results |
| [`docs/LAUNCH_PLAN.md`](docs/LAUNCH_PLAN.md) | Ship plan, channels, costs, 14-day schedule |
| [`docs/LAUNCH_PLAN_FRIEDMOMO.md`](docs/LAUNCH_PLAN_FRIEDMOMO.md) | Friedmomo-specific launch plan — landing page, email capture, future auth/tiers |

---

## Status

Pre-v0.1. The packaging pipeline works; current runway to a public beta:

- [x] Electron wrapper + macOS DMG pipeline
- [x] First-run onboarding wizard
- [x] electron-updater → GitHub Releases
- [x] Settings-store race fix
- [x] Shot-grammar upgrade in the planner
- [ ] App icon
- [ ] Landing page at friedmomo.com/storyboarder
- [ ] Tag `v0.1.0-beta` and publish first GitHub Release

---

## License

TBD — all rights reserved until a decision is made.

## Credits

Developed with Claude (Anthropic) as a co-author. The planner runs on whichever model the user picks through OpenRouter.
