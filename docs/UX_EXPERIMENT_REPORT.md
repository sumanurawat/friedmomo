# Storyboarder — Opus 4.7 UX Experiment Report

**Date:** 2026-04-18
**Planner model:** `anthropic/claude-opus-4.7` (OpenRouter resolves to `claude-4.7-opus-20260416`)
**Title model:** `google/gemini-2.5-flash-lite` (hard-locked server-side)
**Image model:** `google/gemini-2.5-flash-image`
**Runner:** Claude Code, driving the real app via preview MCP; all calls hit the same backend + OpenRouter key that the user uses manually.

Three experiments were run, chosen to cover the three characteristic paths through the app: bootstrap with a classic story in Auto-Generate mode, bootstrap with a sparse original idea in I-Know-What-I'm-Doing mode, and a continuity update on an existing storyboard.

---

## Summary of what happened

| # | Scenario | Mode | TTFB | Stream | Response size | Shots added | Images generated | Outcome |
|---|---|---|---|---|---|---|---|---|
| 1 | "story of little red riding hood — dark fairytale tone, grim brothers-grimm energy" | Auto-Generate (lucky) | **1.37 s** | **53.5 s** | 9,917 chars | 4 | 4 (1 flake, auto-retried in 10 s) | Full spine + bible bootstrapped; model custom-named every Sequence/Scene. Title: *Crimson Wood's Maw*. |
| 2 | "i want to do a heist story but set on mars. that's all i have so far." | I Know What I'm Doing (plan) | ~0.3 s | **5.5 s** | 549 chars | 0 | 0 | Three clarifying questions, no mutations, offered a deliverable ("once you give me a direction, I'll propose a logline, the crew, and a 3-sequence spine for your approval"). Title: *Mars Gold Rush*. |
| 3 | "make the wolf look more ancient and feral — like something prehistoric. also the mother should have a long burn scar down her left cheek, that detail matters. please propagate this to the existing shots." | Auto-Generate (lucky) | ~1.3 s | **17.2 s** | 4,068 chars | 0 new | 2 regenerated in 7.8–8.7 s each | Updated `characters_update` for Wolf and Mother, updated Mother's shot text; cached images on touched shots invalidated → regenerated. |

Cost ballpark per turn (10–15k input tokens × Opus input + ~2–10k output): **$0.15–$0.30**. Experiment 1 was the priciest; Experiments 2 and 3 were well under 10¢ each.

---

## Experiment 1 — classic story, Auto-Generate

### What Opus 4.7 produced

**Chat reply** (rendered as a white speech bubble in the chat panel):

> Classic Grimm Red Riding Hood — dark forest, hungry wolf, naive girl, grandmother's cottage. I've set up the full 3-sequence spine, built Red, the Wolf, the Mother, and Grandmother, locked in our key locations, and blocked out the first 4 shots from the village doorstep through Red's fateful detour into the woods.

**Storyboard state after one turn:**
- Sequence 1 renamed → **"SETUP - THE VILLAGE AND THE WARNING"**
- Sequence 2 renamed → **"CONFRONTATION - THE WOLF'S GAME"**
- Scene names all custom: *The Errand Begins, Into the Forbidden Woods, The Stranger on the Path, The Wolf's Shortcut, Grandmother's Fate, The Masquerade in Bed*
- 4 shots with concise titles: *The Doorway Farewell, The Tree Line, The Wildflowers, The Wolf Appears*
- 4 characters with visual bibles; 3 locations
- 4 images auto-generated inline, visible as 16:9 thumbnails on each shot card

### The nice

- **Speed.** 53 s end-to-end for a full story bootstrap is a great value prop. Opus 4.7 ran ~30% faster than Opus 4.6 on the same prompt in my prior tests (72–82 s → 53 s).
- **The streaming UX during the wait is excellent.** The `chat` field extracts and renders in real time; there's a "Drafting response…" banner with a spinner; the SEND button becomes a grayed "DRAFTING…" label. Prevents anxiety, prevents double-submits.
- **The title beat.** "Crimson Wood's Maw" lands in the topbar before the chat even finishes streaming. Subtle but feels magical — the story has an identity before anything else exists.
- **Custom naming over default skeleton.** The model chose *"Setup — The Village and the Warning"* over the default *"SETUP"*. The default names feel like schoolbook structure; the custom names feel like a real outline. This is a direct win for Rule 19 + bootstrap block.
- **Rule 18 (no prefix on shot titles) is respected cleanly.** Titles like *"The Doorway Farewell"* instead of *"SETUP: The Obedient Daughter: The Doorway Farewell"*. Readable.
- **Inline shot preview in the chat reply.** The assistant's message attaches a thumbnail of the first shot the user will see on the board. Brilliant anchor point.
- **Auto-image generation.** All 4 shots had thumbnails within ~10 s after the stream ended. The board feels instantly cinematic.

### The annoying

- **The 53-second wait is long, and there's no progress within it.** The streaming `chat` field is only ~2 sentences and arrives in the first few seconds. Then the user waits ~45 s watching the spinner with no new information. The storyboard below is still empty and silent because updates apply atomically at end-of-stream. **Users will wonder if it's stuck.** Two fixes worth considering:
  1. Stream the `updates.scenes_add[]` items into the board as they parse (partial-JSON streaming). This is hard but would make the wait feel alive.
  2. At minimum, show an incremental "building scenes 1/4…" counter in the processing banner so time-elapsed is contextualized.
- **The "Drafting response…" label stays identical for the entire 50+ seconds.** The copy could evolve: "Writing the spine" → "Designing characters" → "Blocking shots" — even if it's a fake cadence based on elapsed time, it reassures the user that work is progressing.
- **Image generation flakes silently.** One of the four images failed on first try (3 s error → 10 s retry). In the UI this flashes a "Generating…" state then resolves — so it's mostly invisible — but a user on a worse connection could end up with one blank shot card and no explanation of why. The retry logic is good; the visible error state could be softer (e.g. a tiny orange "retrying…" pip instead of an empty frame).
- **Storyboard scroll position resets.** After the reply lands and the board populates, I was scrolled down to see Sequence 2. The newly-added shots all live in Sequence 1 at the top, but the scroll position stayed at Sequence 2, so the user has to discover where the work landed. Auto-scroll to the first newly-added shot would help.
- **Chat bubble width vs. image preview width.** The shot preview card inside the assistant bubble takes more horizontal space than the bubble's text, making the bubble look ragged. Minor.
- **The board's "default scene names" flash before being replaced.** Before the stream completes, you see SETUP / Status Quo + Inciting Incident / Reaction + Lock-In, etc. After the stream applies, these become *The Village and the Warning / The Errand Begins / Into the Forbidden Woods*. The **replacement is abrupt** — no animation, no highlight of what changed. A diff animation (brief amber pulse on renamed scenes) would land the "magic" harder.

---

## Experiment 2 — sparse original idea, Plan mode

### What Opus 4.7 produced

**Chat reply:**

> Heist on Mars — instant vibe. Before I draft the structure and characters, a few quick questions: What's the tone — gritty Blade Runner noir, slick Ocean's Eleven swagger, or tense hard sci-fi like The Martian? Who's the target — a corporate megacorp vault, a rival colony, a government terraforming project? And is our crew native Martians (colonists who feel exploited) or outsiders from Earth coming in hot? Once you give me a direction, I'll propose a logline, the crew, and a 3-sequence spine for your approval.

**Storyboard state:** unchanged. Stats still 0/0/0. No characters, no locations, no shots created.

### The nice

- **This is exactly what Plan mode should do.** Three sharp clarifying questions, each offering 2–3 concrete examples (which is better than open-ended "what tone do you want?"). Rule 11/12/13 in the prompt work.
- **5.5 seconds total** — effectively instant. Plan mode is much cheaper than lucky mode on cost and time.
- **Ends with a commitment.** "Once you give me a direction, I'll propose a logline, the crew, and a 3-sequence spine for your approval." The user knows exactly what the next turn will deliver. Reassuring and structured.
- **The title generator still fired** ("Mars Gold Rush"), so even without shots the project has identity.

### The annoying

- **The user now has to re-send a message to get anywhere.** That's obviously by design — but the textarea placeholder still says "Try: 'Add a midpoint reveal in scene 4 and raise stakes in sequence 2'" which is a Lucky-mode suggestion. In Plan mode where the AI is waiting for *your* direction, the placeholder should adapt — something like "Reply with your direction, or ask for a 3-sequence outline."
- **The reply is a wall of text with no visual structure.** Three questions run together in one paragraph with em-dashes. Could be improved by having the assistant emit the questions as markdown bullet points when it's genuinely listing options. The chat UI already renders paragraphs and lists.
- **No obvious UI affordance to "accept" any of the suggested options.** The user has to type free-form. In a product that's already structured enough to have a JSON schema, you could consider quick-reply chips ("Blade Runner noir", "Ocean's Eleven", "hard sci-fi") generated from the assistant's question text — one click to pre-fill the textarea.
- **Plan-mode reply doesn't mention the skeleton is still pre-seeded.** The default 3/2-4-2 Sequences/Scenes are already on the board — but the user is told "I'll propose a 3-sequence spine for your approval" as if none existed. Minor but causes a mild double-take when the user scrolls down and sees empty default scenes.

---

## Experiment 3 — continuity update on an existing board (Crimson Wood's Maw), Auto-Generate

### What Opus 4.7 produced

**Chat reply:**

> Updated the Wolf to read as prehistoric and ancient — dire-wolf scale, ritualistic scarring, primeval menace. Gave Mother a long burn scar down her left cheek and wove it into her doorway shot as a visible beat.

**Mutations applied:**
- `characters_update` on Wolf (visualPromptDescription rewritten)
- `characters_update` on Mother (visualPromptDescription rewritten)
- `scenes_update` on the Doorway Farewell shot (visualDescription updated to include the scar)
- 2 images automatically regenerated (7.8 s and 8.7 s) because the referenced characters' `visualPromptDescription` changed and the image prompt hash invalidated
- 0 new shots added
- 0 old shots removed

### The nice

- **The model did exactly the right thing.** Updated the bible entries (not shots-add), touched only the one shot that explicitly showed Mother, left the other 3 shots alone. Rule 8 (use scenes_update not scenes_add on edits) worked.
- **Rule 25 (propagate visual changes) worked.** The user explicitly asked for propagation, and the system delivered — 2 images auto-regenerated from the new anchors.
- **17 s is significantly faster than bootstrap.** Targeted update → less output → shorter stream. Good latency characteristic.
- **Reply is exactly 2 sentences.** Rule 15 (1–2 sentence summaries) adhered to.

### The annoying

- **The chat reply doesn't tell the user *which* shots got regenerated.** "Wove it into her doorway shot as a visible beat" is concrete, but 2 images silently regenerated behind the scenes. Users who spent 10+ seconds generating a specific image and are emotionally attached to it will be confused when it's replaced without warning. A follow-up line like "Also regenerating 2 frames to reflect the new looks." would set expectations.
- **One image showed as "GENERATE IMAGE" empty state mid-regeneration.** Since the image pipeline tears down the old image and replaces it only after the new one arrives, there's a 7–8 s window where the shot card looks blank. A "generating new image…" overlay with a spinner would bridge the gap.
- **The diff isn't visible.** The user asked to update the Wolf's description. The new description lives on the character entity, but the old description is gone — no way to see what changed, no undo. For a "continuity bible", this is a genuine hole: you'd want a revision history on each character's visualPromptDescription at minimum. (Also worth doing for shots.)
- **The user has to open Shot Inspector to verify the shot text actually got updated.** The scene card on the board still shows a truncated preview that doesn't reflect the change at a glance. Showing an amber "updated" pip on changed cards for a few seconds would make the diff legible without inspection.

---

## Cross-experiment UX observations

### Things I'd call out as "very good"

1. **The chat panel's streaming response is the app's best interaction.** Clean bubble, live typing indicator, processing banner, button state change, clear resolution. Most apps fumble this; yours doesn't.
2. **Title generation running in parallel with the main chat is a subtle delight** — by the time the stream ends, the project already has a name that matches the vibe.
3. **Autonomous mode's Rule 19 (bootstrap with first 4 shots) is genuinely the right default.** Without it, a first-turn user would stare at empty sequences for 60 seconds and then see only 1 shot. With it, the board feels alive instantly.
4. **Plan mode's restraint is noticeable and appropriate.** Not silently mutating state while asking questions is the right behavior, and the 10x-cheaper turn is a real win for people iterating verbally.
5. **The new Shot Inspector empty state** (amber icon, "No shot selected", kbd hint) is polished — users know what to do.

### Things that annoy me as a user

1. **The 50+ second first-turn wait with no substantive feedback.** Even though the chat bubble's intro text streams fast, all the structural action lands atomically at the end. Biggest UX hit.
2. **No progress counter or phase label.** "Drafting response…" is a single state that lasts ~50 s. It should be at least 2–3 phase labels cycling (writing spine → building characters → blocking shots).
3. **The "+ New sequence" button is far from the scroll position when the user is deep in Sequence 2 or 3.** Once a story has 3 sequences with content, adding more requires scrolling all the way back up.
4. **Shot-inspector panel wastes space when nothing is selected.** 18% of the horizontal viewport renders empty. At least offer recent shots, a shortcut hint, or collapse-by-default.
5. **Image regeneration is invisible to the user.** Images can silently disappear and come back during a regenerate. Show an overlay + toast + optional "undo" to make this safer.
6. **No per-message cost display, not even in a debug panel.** Users who wire up Opus 4.7 themselves should be able to see "this turn: $0.18" so they can budget. The backend already logs `ai.chat.done` with durationMs + bytes; you could estimate and surface it.
7. **The workspace project list doesn't show shot counts.** You see "Crimson Wood's Maw — 2h ago" with no indication of how many scenes/shots it has. A `4 shots · 4 chars · 3 locs` chip would help pick the right project to continue.
8. **"Mode" toggles are labelled confusingly.** "I know what I'm doing" + "Auto-Generate" both try to telegraph mode-of-work but it takes a beat to remember which is which. Something like "Discuss first" vs "Build now" would be clearer. (Or keep the current labels but add a 1-line tooltip — which already exists, but only on hover.)

### Things I'd call out as "risky"

1. **One image in Experiment 1 errored out with a generic error and auto-retried.** The log line was `ai.image.error` with no upstream error body captured. When this happens in production and *doesn't* auto-resolve, the user will see a blank tile with no recourse. The image route should:
   - Show a "Regenerate" button inline on every image card
   - Capture upstream error body in `ai.image.error` for triage
   - Maybe retry on 429/500, not 400 (the current behavior retries everything)
2. **No visible way for the user to cancel an in-flight chat.** They typed a prompt, watched 50 s pass, then realized they meant something else. They have no "Stop" button. Add one.
3. **Character / location edit history does not exist.** If the model overwrites Ophelia's look across turns, the old design is irrecoverable. Keep a tiny version log per entity (append-only JSONL in the project folder).
4. **Settings race condition I hit during this very test session.** On page reload during a backend restart, the frontend loaded empty settings and immediately PUT them back, clobbering the API key on disk. This is a real bug. Fix: in `settings-store.init()`, *don't* persist immediately after a fresh load (only persist on explicit user change), or at minimum skip the persist if the loaded payload is empty/default.

### Prompt-engineering notes (commentary on `src/prompts/system-prompt.js`)

From doing 3 real turns with Opus 4.7 against your prompt:

- **Rule 4 (visual descriptions must be vivid, director-facing)** is clearly working — all shot visualDescriptions came back as production-ready frame briefs. Good.
- **Rule 17 (one shot per SC)** held across 3 turns with zero violations. Good.
- **Rule 19 (bootstrap first 4 shots in one pass)** produced exactly 4 shots. Good.
- **Rule 25 (propagate medium changes)** only got tested lightly (I changed character looks, not medium). Worth a dedicated experiment to stress.
- **Rule 3 (1 shot per turn in plan mode)** held in Experiment 2 — zero shots created while it asked questions. Good.
- **Where I'd still shrink.** Rule 4 is a paragraph, 20–22 are continuity rules that could be one bullet, and 26 rules overall is a lot. I'd test aggressively reducing to 10–12 rules and see if the model still behaves — your enforcement layer (`enforceSceneMutationPolicy`) catches the violations that matter anyway.

---

## Quick wins I'd ship next

Ranked by effort-to-impact ratio:

1. **Stop button during streaming** — user can cancel an in-flight chat. Two hours of work, very high perceived-quality gain.
2. **Phase-label cycling in the processing banner** — "Writing spine" → "Building characters" → "Blocking shots" on a simple timer. One hour.
3. **Auto-scroll the board to the first newly-added shot after a chat landing.** Thirty minutes.
4. **Chat reply mentions image regenerations** — planner is told to include "(regenerating N frames)" when it touches character/location visuals. Prompt-only change.
5. **Textarea placeholder adapts to mode** — different hint text for Plan vs Auto-Generate. Thirty minutes.
6. **Per-turn cost display in a debug overlay** (hidden by default, toggle via a keystroke). One hour.
7. **`settings-store.init()` shouldn't PUT back an empty payload.** Bug fix, thirty minutes.
8. **Inline "Regenerate image" button + "generating…" overlay** on each shot card. Two hours.
9. **Project list shows `4 shots · 4 chars · 3 locs`** next to each story name. One hour.
10. **Amber diff-pulse animation on freshly-modified scene cards** for 1–2 seconds after a chat turn lands. Two hours.

---

## Observability notes

Every event above is captured in `~/Storyboarder/logs/storyboarder.jsonl` and correlated across client and server via `X-Request-Id` / `X-Client-Request-Id`. Example from Experiment 3:

```json
{"ts":"2026-04-18T04:29:31.505Z","event":"ai.chat.send","clientRequestId":"...","model":"anthropic/claude-opus-4.7","messageCount":3,"systemPromptChars":12484}
{"ts":"2026-04-18T04:29:31.920Z","event":"ai.chat.start","requestId":"...","clientRequestId":"...","model":"anthropic/claude-opus-4.7"}
{"ts":"2026-04-18T04:29:33.102Z","event":"ai.chat.upstream_headers","status":200,"ttfbMs":1182}
{"ts":"2026-04-18T04:29:48.724Z","event":"ai.chat.done","durationMs":17190,"chunks":1143,"bytes":157046}
{"ts":"2026-04-18T04:29:48.748Z","event":"ai.image.send","model":"google/gemini-2.5-flash-image"}
{"ts":"2026-04-18T04:29:56.514Z","event":"ai.image.done","durationMs":7766}
```

This is enough to build a cost dashboard (`sum(bytes) / 4 × $15/M-tokens-input` approximates Opus input cost; output side needs a usage.tokens field from the upstream response, which OpenRouter provides but we currently discard). Suggested small enhancement: in `server/routes/ai.js`, capture `choices[0].message.usage` if the upstream returns it in SSE, and log on `ai.chat.done`.
