# Launch Plan — Storyboarder on friedmomo.com

**Date:** 2026-04-18
**Updates:** supersedes `LAUNCH_PLAN.md` for the specific case where friedmomo.com is the distribution portal.

---

## Architecture at a glance

```
                    friedmomo.com
                          │
      ┌───────────────────┼────────────────────┐
      │                   │                    │
  Marketing &        User identity         Downloads link out
  signup forms       (Firebase Auth)        ↓
  (new page on             │
   existing Phoenix  Stripe billing    GitHub Releases
   Flask app)        (existing)        (free CDN, auto-updates)
      │                   │                    ↓
      ▼                   ▼              Desktop Electron app
    Firestore          Firestore         on user's laptop
   (emails,            (users,               │
    subscribers)        tiers)          OpenRouter API calls
                                        (user's own key)
```

**Key insight:** Phoenix already has every backend piece you need. You're not building new auth, new billing, or new user storage — you're adding one new product vertical to an existing platform.

---

## Zero-cost distribution stack

| Piece | Where | Cost |
|---|---|---|
| Desktop app binaries (DMG / EXE / AppImage) | GitHub Releases | **Free.** Unlimited bandwidth, unlimited storage for public repos, globally cached. |
| Auto-update feed | GitHub Releases (latest-mac.yml, latest.yml) | **Free.** electron-updater polls these files on app launch. |
| Landing page | friedmomo.com/storyboarder | **Free.** New Flask route on your existing Phoenix Cloud Run service + Firebase Hosting. Already paying. |
| Email capture | Phoenix endpoint → Firestore collection | **Free.** Already paying for Firestore; well within free tier for hobby volume. |
| User auth (for future tiers) | Firebase Auth (already wired) | **Free** up to 50K monthly active users. |
| Stripe billing (for future tiers) | Existing `stripe_service.py` | Only pay Stripe's processing fees on actual revenue. No subscription or monthly. |
| Newsletter sending | Buttondown (free < 100 subs) OR Phoenix's existing email path if there is one | **Free** until 100 subscribers. |
| macOS code signing + notarization | Apple Developer Program | **$99/year.** Non-optional for real users. |
| Windows code signing | Skip for v0.1 | $0 (SmartScreen warning tolerable) |

**Total out-of-pocket:** $99/year, full stop.

---

## How downloads work

### The user flow
1. User visits **friedmomo.com/storyboarder** (new landing page on existing site).
2. They see: hero, 60-second demo video, "Download for macOS / Windows / Linux" buttons.
3. (Optional) they enter email before download → Phoenix saves to Firestore → returns the GitHub Releases URL.
4. Download button links directly to the signed binary on GitHub Releases.
5. They install. First-run wizard asks for their OpenRouter API key.
6. They use the app locally. Your servers see zero traffic.

### Why GitHub Releases and not GCS
- **GitHub Releases** is a free CDN built on top of AWS/Fastly, with no bandwidth cap for public repos.
- **Google Cloud Storage** has a 5 GB / 1 GB-egress-per-month free tier, then you pay. A single 150 MB macOS DMG × 200 downloads = 30 GB egress = ~$3. GitHub Releases = $0.
- GitHub Releases also ships the update manifest (`latest-mac.yml`) that electron-updater needs, without you writing anything.

### Optional: serve the download link *through* friedmomo.com
Two options:

**(a) Direct link — simpler.** `friedmomo.com/storyboarder` → download buttons link straight to `github.com/sumanurawat/storyboarder-next/releases/latest/download/Storyboarder-1.0.0.dmg`. One hop, no server-side logic. You lose email capture unless the user voluntarily signs up.

**(b) Gated link — more engagement.** `friedmomo.com/storyboarder` → email form → Phoenix endpoint stores email + returns the download URL. Costs you ~20–30% of trial conversion (some users don't want to give their email) but you get a mailing list.

**Recommendation: (a) with optional email capture in the corner.** Ship-blocking speed matters more than the email list early. Add (b) as a soft "Stay in the loop" field next to the download button, not gating it.

---

## How app updates work

### electron-updater + GitHub Releases
1. User opens the app. Electron main process calls `autoUpdater.checkForUpdatesAndNotify()`.
2. The updater fetches `https://github.com/.../releases/latest/download/latest-mac.yml` and compares to installed version.
3. If newer, downloads the delta (or full DMG), verifies signature, stages for install.
4. On app quit, new version takes over silently. No user action needed.

### What the user sees
- **Silent update path** (default): nothing. The app is just newer next time.
- **Announced update** (for meaningful releases): a small toast appears — *"Storyboarder 1.2 ready. Restart to apply."* Two buttons: *Restart now* / *Later*.

### How you control the pace
- Every `git tag v1.X.Y && npm run release` publishes a new release via electron-builder's `--publish always` flag. Takes ~5 minutes.
- Optional: staged rollout using GitHub Releases' "pre-release" flag. Tag `v1.2.0-beta` for a week, promote to full release after a handful of users confirm it's stable.

### How to nudge users to update *proactively*
Three mechanisms, stacked:

1. **Automatic (silent)** — covers 95%+ of users. They never know they updated, they just have the new version next launch.
2. **In-app "What's new" modal** on first launch after each significant update. Reads from a bundled CHANGELOG.md. Takes 10 minutes to wire; massively improves perceived product velocity.
3. **Newsletter** — only for users who opted in. Monthly "here's what's new in v0.X, here's a story someone made with it, here's what's coming." Low pressure, builds relationship.

---

## Email capture + newsletter strategy

### What to capture and where
Two Firestore collections on the existing Phoenix backend:

```
storyboarder_subscribers/{autoId}
  email: "user@example.com"
  source: "landing-page" | "in-app-prompt" | "first-run-wizard"
  consentedAt: Timestamp
  unsubscribedAt: Timestamp | null
  platform: "macos" | "windows" | "linux" | null
  appVersionAtSignup: "0.1.0" | null
  userId: string | null    // populated when they later sign in
```

Later, when you add auth tiers, `userId` joins this with Phoenix's existing `users` collection.

### Where to ask for email
Three touchpoints, in escalating commitment order:

1. **Landing page corner form** — "Get updates" next to the download button. Optional, not gating. Expect 5–10% conversion of downloaders.
2. **First-run wizard inside the app** — one step after API key setup: *"Want an email when there's an update or new features? [Email] [Skip]"*. Opt-in only. Expect 15–25% of first-run users.
3. **Help menu item** — *"Subscribe to updates"* opens a small window with the same form. For users who skipped initially but warmed up.

### Who sends the emails
Three options, in order of ease:

1. **Buttondown** (free tier: 100 subs, generous enough for early days). Integrate via their API: Phoenix endpoint POSTs the captured email to Buttondown's subscriber API, then Buttondown handles unsubscribes + sending.
2. **Phoenix's own path** — if Phoenix already has a mail service (check `services/` or env vars for SendGrid/Mailgun/SES), use it. Phoenix probably already sends Stripe receipts, so something is wired up. Free if you're in whatever free tier you already have.
3. **ConvertKit free tier** (10K subs) — if you expect to grow fast. More newsletter-focused than Buttondown.

**Recommendation:** start with Buttondown. It's the least work. Switch when you cross 100 subs, which is a good problem.

### What to send
Once a month, maximum. Keep it short:
- 1 line — what's new in the latest release
- 1 paragraph — a specific user-created story (ask for submissions in the app's Help menu)
- 1 link — something useful (OpenRouter's pricing update, a new model they can try)
- Unsubscribe link

This is the minimum viable newsletter. Don't overthink it.

---

## How this slots in with future auth + payment tiers

Because you already have `auth_service.py` and `stripe_service.py` in Phoenix, the upgrade path for Storyboarder is almost free.

### Phase A — v0.1 to v0.5: anonymous, free, BYOK
No auth. App reads/writes local settings. Phoenix just serves the landing page + captures opt-in emails.

### Phase B — v1.0: optional account
Add a "Sign in with Google" button in the app (Help menu → *Connect friedmomo account*). Uses Firebase Auth, the same flow Phoenix already uses. Benefits for the user:
- Cloud-sync their storyboards across devices (you host the sync, but only for signed-in users)
- Access to Pro tier if they upgrade
- Avatar + user menu in the app

Signing in is **optional**. Everything works without an account, same as today.

### Phase C — v1.5: Pro tier
Add a Stripe checkout flow via Phoenix's existing `stripe_service.py`. Pro unlocks:
- PDF branding with your own logo
- Export to Final Draft / Celtx
- Cloud sync (already wired in Phase B)
- Priority support
- Cheaper/Pro AI routing (you become a pass-through for Anthropic/OpenAI with a small markup on inference — optional, keeps the BYOK model for free users)

Price: one-time **$29** OR subscription **$5/mo**. Probably one-time for v1.5, subscription later.

The whole Phase B + C path reuses Phoenix. You're not building a second backend.

---

## Technical checklist — what has to happen

### For v0.1 download-to-launch
- [ ] Re-add Electron wrapper (main process, preload, bundling). Details in `LAUNCH_PLAN.md` §9.
- [ ] Wire electron-updater → GitHub Releases.
- [ ] Sign + notarize macOS builds.
- [ ] First-run wizard: OpenRouter key → model pick → (optional) email capture.
- [ ] Build & publish v0.1.0-beta to GitHub Releases.

### For friedmomo.com integration
- [ ] Add new Flask route `/storyboarder` (or SPA route) in Phoenix. Landing page: hero, demo video, OS download buttons, optional email form.
- [ ] Add Phoenix endpoint `POST /api/storyboarder/subscribe` that writes to Firestore `storyboarder_subscribers` collection + forwards to Buttondown.
- [ ] Add Phoenix endpoint `GET /api/storyboarder/latest-version` that returns the current version from GitHub API (cacheable for 1 hour). Used by marketing page to show "Latest: v0.3.1 · released April 18".
- [ ] Deploy Phoenix to Cloud Run (your existing `cloudbuild.yaml`).
- [ ] Point `friedmomo.com/storyboarder` at the new page (Firebase Hosting rewrites).

### For the newsletter
- [ ] Create Buttondown account. Get API key. Add to Phoenix's secrets (Secret Manager).
- [ ] Write the subscribe endpoint (above).
- [ ] Draft your first issue before launch so you have something to send.

### What NOT to do for v0.1
- [ ] Auth in the app. Not needed until Phase B.
- [ ] Stripe in the app. Not needed until Phase C.
- [ ] Cloud sync. Phase B.
- [ ] Windows code signing. Skip; tolerate SmartScreen.
- [ ] Homebrew / Winget listings. Nice-to-have in v0.2.

---

## What happens day 1 after launch

- Someone lands on friedmomo.com/storyboarder from a Reddit link
- They read 3 sentences, watch a 60-second demo loop
- Click *Download for Mac*
- A 140 MB signed DMG downloads from GitHub Releases (cached globally, fast)
- They drag to Applications, open, Gatekeeper sees it's notarized, lets them in
- First-run wizard asks for OpenRouter key (link to create one)
- They type *"tell me the story of king arthur"* and hit Send
- 90 seconds later they have an 8-panel storyboard with images
- They feel something and tell a friend

None of that touched your GCP billing. Your only cost was the $99 Apple fee for the year.

---

## When you scale

You'll hit real decisions at:

- **100 subscribers:** upgrade Buttondown or move to ConvertKit.
- **500 downloads/week:** worth reconsidering Windows code signing ($300/yr) because SmartScreen will start hurting conversion.
- **1000 MAU:** check Firebase Auth quota. Still well inside the free 50K.
- **Revenue > $500/mo:** consider forming an LLC or similar for liability reasons.
- **Real Pro tier demand:** wire Phase C.

None of these are ship-blockers. Ship free, measure, decide later.

---

## The answer to your actual question

> *"How will the downloaded app be updated for users? How will we nudge them?"*

Three layers:

1. **electron-updater** → silent, automatic, works on every launch → they always have the latest version without thinking about it.
2. **In-app "What's new" modal** → first launch after each non-trivial release → they see the changelog without you nudging.
3. **Monthly newsletter** → only for users who opted in (friedmomo.com landing page OR first-run wizard) → stays in their inbox with low pressure.

No push notifications, no spam, no dark patterns. The technology does 95% of the work; email + in-app modal do the other 5%.

And when you're ready for auth + tiers, Phoenix's existing services light up the path with almost no new work.
