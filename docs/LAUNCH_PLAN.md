# Launch Plan — Storyboarder v0.3 (BYOK Desktop App)

**Date:** 2026-04-18
**Model:** free-to-download desktop app. Users bring their own OpenRouter API key. Zero hosting cost to you.
**Scope:** get a signed installable app on macOS + Windows + Linux shipped to real users within 2–3 weeks.

---

## TL;DR — the recommendation

Wrap the current web + Node backend in **Electron**, ship via **GitHub Releases** (free) with a **landing page on Vercel** (free). Skip code-signing on day 1 for Linux and Windows (SmartScreen warning is tolerable for an indie v0.1). Pay the $99/yr Apple Developer fee — an unsigned macOS app is a hostile user experience. Use **electron-updater → GitHub Releases** for auto-updates so users stay current. Keep it **free + BYOK** for launch; monetize later if there's traction.

Total out-of-pocket to launch: **$99** (Apple Developer account) + ~2 weeks of work.

---

## The 5 real questions

1. **What's the delivery mechanism?** Electron.
2. **Where do users download it?** GitHub Releases + a tiny landing page.
3. **Do I need to sign the app?** Yes for macOS, no for launch on Win/Linux.
4. **How do users update?** Electron auto-updater pointing at GitHub Releases.
5. **Free or paid?** Free BYOK for v0.1. Optionally paywall "Pro" features later.

Each answered below.

---

## 1. Delivery — Electron vs. the alternatives

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Electron** | Wraps Node.js backend + React frontend in one process. Mature auto-update, code-sign, native menus, installer tooling. You already used it once in this project. | ~100–150 MB download. Memory hungry (~200 MB idle). | ✅ Ship this |
| **Tauri** | 10–30 MB. Fast. Modern. | Uses system WebView (inconsistent rendering Win vs Mac). Requires Rust to build. You'd need to spawn the Node backend as a sidecar or rewrite it in Rust. Auto-update tooling less mature. | Revisit in v2 |
| **Just a zip + run-script** | Zero packaging work. | Consumer-hostile. Only works for technical users who have Node installed. | Only as a "dev preview" channel |
| **Docker** | Reproducible. | Users must have Docker. Non-starter for filmmakers. | Skip |
| **PWA + free cloud backend** | No install. | You become the hosting provider the moment anyone signs up. Contradicts the "no cloud costs" goal. | Skip |

**Why Electron now.** You have a Node backend that talks to the filesystem (workspace folder, image files, settings). Electron bundles both processes natively — the renderer (React) talks to the main process (Node) via IPC OR just keeps the localhost:3001 HTTP pattern you already have. Either works. Minimum refactor.

---

## 2. The build + distribution stack

**Packaging tool.** Use **electron-builder**. Config-driven (`build/electron-builder.yml`), builds DMG / NSIS / AppImage / Snap / deb / Flatpak in one command.

**Auto-update.** **electron-updater** → GitHub Releases. Sign your releases (already required for macOS), publish to a repo, the app polls for new releases on launch and updates silently.

**Distribution channels for v0.1:**
- **GitHub Releases** (primary) — free, familiar, versioned. Your landing page links here.
- **Landing page** — one static page on Vercel (free). Explains what the app is, links to the latest release for each OS, links to your OpenRouter-key-setup guide, 60-second demo video.
- **Homebrew cask** (optional, macOS) — submit a cask manifest to homebrew-cask. Free. Installs via `brew install --cask storyboarder`. Takes an afternoon.
- **Winget** (optional, Windows) — submit a manifest to winget-pkgs. Free. Installs via `winget install storyboarder`.

**Stores to avoid for v0.1:**
- **Mac App Store** — sandbox rules break localhost servers + arbitrary filesystem access. Big rewrite. Skip.
- **Microsoft Store** — same issue for desktop app style. Skip.
- **Setapp** — requires App Store sandbox. Skip.

---

## 3. Code-signing reality

| OS | Cost | Consequence if unsigned |
|---|---|---|
| macOS | **$99/year** (Apple Developer Program) | Unsigned apps show "this is damaged" on download — users must right-click → open, and most won't know to. Effectively non-starter for non-technical users. Notarization required too, included in the $99. |
| Windows | **$300–500/year** (OV / EV certificate) | SmartScreen warns "Windows protected your PC." User clicks "More info → Run anyway." Ugly but survivable for v0.1. Reputation builds over time with EV cert. |
| Linux | Free | AppImage / deb / Snap — no signing drama. |

**Recommendation:** pay Apple's $99 on day one. Skip the Windows EV cert for v0.1, ship unsigned with a "how to bypass SmartScreen" note on the download page. Revisit Windows signing when you have >500 active users.

---

## 4. Pre-launch checklist (ship-blockers)

These are the things that actually have to be right before real users touch it.

### Technical
- [ ] **Re-wire Electron.** Add `electron/` dir back: main process spawns the Node server as a child process, renderer loads built Vite output. (~1–2 days given you've done this before; the backend is already process-separable.)
- [ ] **First-run onboarding.** When the app starts with no settings file, walk the user through: (1) What's an OpenRouter key? (2) Here's the link to create one. (3) Paste it here. (4) Pick a planning model (pre-select `google/gemini-2.5-flash-preview` for cheapest try). The tutorial overlay exists; extend it.
- [ ] **Error-reporting toggle.** Currently the frontend posts errors to `/api/log` which writes locally. Fine for now — but add a "Help → Send diagnostic log" button that zips the log file and opens the user's mail client / copies to clipboard. Don't auto-phone-home.
- [ ] **Crash-free first-run on a machine that has never seen Storyboarder.** Test on a clean macOS VM and clean Windows VM. The settings race condition I hit during testing (empty-load → PUT → clobbered key) absolutely must not fire on first-run. Fix in `settings-store.init()`: skip the PUT if the loaded payload is empty.
- [ ] **Auto-updater wiring.** Point at `sumanurawat/storyboarder-next` releases. Test that v0.1.0 → v0.1.1 actually updates silently.
- [ ] **Workspace path convention.** Default is `~/Storyboarder/`. On Windows this becomes `C:\Users\X\Storyboarder\` — verify no path-escaping bugs. Let power users override via env var (already works).
- [ ] **Ship a README.md or Help menu entry** that shows the workspace path. Users will ask "where are my stories saved?"

### Product
- [ ] **Delete the "Drowning Garden" and other test projects from your sample seed** before packaging.
- [ ] **Decide on the default planning model.** Opus 4.7 is expensive at scale. For first-run, pre-pick a Fast-tier model (gemini-flash or claude-haiku-4) so users don't get sticker-shocked on turn 1. Surface Opus in Settings as "Flagship".
- [ ] **Add a cost estimate to the Models page.** One line: "Planner turn: ~$0.05–$0.25 depending on model + story size. Title generator: ~$0.0001. Image: ~$0.03 per image."
- [ ] **Write a "Getting your OpenRouter key" page** — hosted on the landing site, linked from the onboarding and Settings screens.

### Legal / operational
- [ ] **Privacy policy.** One short page: "Storyboarder runs entirely on your machine. We do not collect telemetry. Your stories, API keys, and images stay on your laptop. The only network calls are from your laptop to OpenRouter, using your own API key." That's the whole thing. Gets you off the hook.
- [ ] **Terms of service.** Template — "as-is, no warranty, use at own risk." (Consult a real lawyer if you're monetizing.)
- [ ] **License for the app binary.** If you're keeping the source open, MIT or Apache 2. If closed, proprietary with EULA.
- [ ] **Attribution for the planner / image models' output.** OpenRouter's terms handle this — you don't need extra language.

### Landing page
- [ ] **Single Vercel-hosted page** with: hero ("Turn any premise into a shootable storyboard in 90 seconds"), a 30-second looping demo GIF, OS download buttons (macOS DMG, Windows EXE, Linux AppImage), "how to get an OpenRouter key" link, privacy policy, email capture for "tell me when there's an update" (use Formspree or similar — no backend needed).
- [ ] **Demo video.** 60–90 seconds. You typing "story of little red riding hood" and the board filling with 8 panels and generated images. This is your single best marketing asset; put real effort into it.

---

## 5. Launch tactics

Rank in order of expected impact for an indie creator tool with your audience:

### Day 1 — Soft launch
- **Ship to GitHub Releases.** Make the repo public if it isn't already.
- **Post to r/filmmakers, r/cinematography, r/screenwriting, r/storyboards** — "I built this because I was tired of drawing thumbnails by hand. Free, open-source, bring your own AI key." Title must NOT scream "I made a product." Share the tool, not the pitch.
- **Post to r/indiefilm, r/editing, r/animation, r/VFX.**
- **Tweet / Bluesky / Mastodon** with the 60-second demo video.

### Day 2–7 — First wave
- **Show HN on Hacker News.** Aim for a Tuesday or Wednesday morning US time. Title: *"Show HN: Storyboarder — generate a full 8-panel storyboard from one sentence (local + BYOK)"*. Lead with what it does, mention it's Opus 4.7 behind it, emphasize local + no hosting costs. Expect harsh feedback. Respond to every comment for the first 6 hours.
- **Product Hunt.** Launch on a Tuesday or Wednesday. Requires pre-launch assets (logo, tagline, gallery, 60s video). You get one shot at featured-of-the-day, so prep for 1–2 weeks.
- **Reach out to 3–5 indie filmmaking YouTubers** with free early access + the demo. Even a mention drives hundreds of downloads.

### Day 7–30 — Retention
- **Discord / community.** Create a small Discord server. Pin the "how to get an OpenRouter key" doc.
- **Newsletter.** Send one update per month to email list: "here's what's new, here's what's coming, here's a story someone made with it." Use Buttondown or similar cheap service.

---

## 6. Pricing / business model

### v0.1 — Free, BYOK
Your initial stance. Perfect. Here's why it's the right call:

- **Zero friction to try.** The single biggest win.
- **You carry zero ongoing costs.** User's OpenRouter account pays for AI. Your hosting is a static landing page on Vercel's free tier.
- **Audience comes before revenue.** You have no audience yet. Audience is worth more than $19 × 100 early adopters.

### Optional v0.2 — Tip jar
Add a "Buy me a coffee" or "Ko-fi" link in the Help menu. Low-pressure monetization that doesn't feel like a gate.

### v1.0 (future) — Pro tier
Once you have a real user base and clear requests, consider:
- **One-time $29 Pro** for things like: PDF branding, export to Final Draft / Celtx, extra prompt templates, unlimited projects, priority support.
- **$5/mo Pro** for things like: cloud sync between devices, shared projects, asset library. This is when you'd take on cloud costs — and only if demand is real.

Don't try to monetize at launch. Build audience first.

---

## 7. 14-day execution schedule

**Week 1**
- **Day 1–2:** Re-add Electron packaging. Basic main process, spawn Node sidecar, build DMG/EXE/AppImage locally. Test on your own machines.
- **Day 3:** First-run onboarding flow (API-key capture, model picker, workspace confirmation).
- **Day 4:** Fix the settings-race bug. Add cost estimates to the Models page. Pick a sensible default Fast-tier planning model.
- **Day 5:** Apple Developer enrollment ($99). Notarize a test build. Manual test on clean macOS VM.
- **Day 6:** electron-updater wired to GitHub Releases. Ship v0.1.0-beta to yourself. Verify auto-update to 0.1.1-beta.
- **Day 7:** Write privacy policy, terms, license. Record the 60-second demo video.

**Week 2**
- **Day 8:** Landing page on Vercel. Download buttons, demo video embedded, OpenRouter-key guide linked.
- **Day 9:** Submit Homebrew cask. Submit Winget manifest. Both take days to approve — get them in the queue.
- **Day 10:** Test with 3 trusted non-technical friends. Watch them go through first-run. Fix whatever trips them up.
- **Day 11:** Make repo public. Write launch copy (HN title, Reddit posts, Tweet).
- **Day 12:** Soft launch — Reddit posts + Tweet. Measure.
- **Day 13:** Show HN post. Monitor responses, fix the most-reported issue that day.
- **Day 14:** Product Hunt launch (if you've prepped). Or postpone to following Tuesday.

---

## 8. What I'd cut from v0.1 to stay focused

If week 1 slips, ship without these and add in v0.1.1:

- Windows code-signing (live with SmartScreen warning)
- Homebrew / Winget listings (GitHub Releases alone is enough)
- In-app changelog viewer (changelog on GitHub is fine)
- Telemetry / analytics (don't add; "no telemetry" is a feature for your audience)
- Collaboration / cloud sync (don't build; requires backend)
- Export to Final Draft / Celtx (PDF export already works)
- Tip jar (add in 0.1.1)

**Do not cut:**
- Apple signing + notarization — macOS users won't be able to open an unsigned app without deliberate override
- First-run onboarding — lose 80% of trial users without this
- Landing page — nowhere for your launch posts to link to
- Privacy policy — one short paragraph, 15 minutes of work, legal cover
- Auto-updater — v0.1 WILL have bugs; you need to ship fixes without asking users to re-download

---

## 9. What the packaging work actually looks like

I can scope this concretely. You'll roughly need these new files and changes:

```
storyboarder-next/
├── electron/
│   ├── main.js            ← Electron main process; spawns Node server, loads renderer
│   ├── preload.js         ← contextBridge, if you want typed IPC (optional, you can keep using localhost:3001)
│   └── updater.js         ← electron-updater wiring
├── build/
│   ├── electron-builder.yml ← all the DMG/EXE/AppImage config
│   ├── entitlements.mac.plist ← mac hardened runtime entitlements
│   └── icons/             ← .icns, .ico, .png
└── package.json (updated):
    ├── "main": "electron/main.js"
    ├── scripts:
    │   ├── "electron:dev": "concurrently \"npm run dev:server\" \"vite\" \"wait-on http://127.0.0.1:4173 && electron .\""
    │   ├── "electron:build": "vite build && electron-builder"
    │   └── "release": "electron-builder --publish always"
    └── devDependencies: electron, electron-builder, electron-updater, concurrently, wait-on
```

Two specific implementation notes for your setup:

1. **Keep the Node server as a child process.** You could move the backend into Electron's main process, but it's cleaner to spawn `node server/index.js` from Electron main and keep the existing HTTP boundary. Zero refactor of the backend. When the app quits, kill the child process.

2. **Bundle Node, don't require it system-wide.** electron-builder includes a Node runtime. Users without Node installed will still run the app fine. Your `server/index.js` runs inside Electron's bundled Node.

---

## 10. Final take

You're closer than you think. The app works, the observability is in place, the brain produces good output, the UI is presentable. The launch work is **wrap, sign, point at a landing page**, not "build another feature."

The discipline over the next 2 weeks is ruthlessly saying no to anything that isn't ship-blocking. Every time you're tempted to add a feature, ask: "does not having this kill the launch?" If no, it's v0.1.1.

Ship to GitHub Releases. Post to Reddit. Post to HN. See what happens. Iterate from there.
