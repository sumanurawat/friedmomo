# Story Taxonomy — is our structure working?

**Date:** 2026-04-18
**Status:** Phase 1 (prompt-only) is landing in this change; Phases 2 and 3 are proposed for follow-up.

This document answers the question: is the current Sequence → Scene → Shot structure actually working for the users and the brain, or do we need a different taxonomy?

**TL;DR.** The *structure* is fine (three levels is right). The *naming* is misleading and costs us brain-quality on every turn. Adopt **Act → Scene → Panel** as the canonical vocabulary, in three phases. Phase 1 (prompt-only) lands now; Phases 2 (UI labels) and 3 (JSON keys) can follow when we're comfortable with the migration cost.

---

## What we have today

| Where | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| UI (visible) | **Sequence** | **Scene** | **Shot** |
| JSON (on disk) | `act` | `sequence` | `scene` |
| Topbar stats chip | — | — | "**SCENES**" (actually counts shots) |

Three observations:

1. **The UI and the JSON use different words for the same thing.** "Sequence" in the UI = `act` in the JSON.
2. **The topbar stat is inaccurately labeled.** It says "N SCENES" but counts individual shots (JSON `scene` objects).
3. **The word "Sequence" has a strong competing meaning** in film/TV theory — a 3-to-8-scene mini-arc inside an Act. We don't use it that way, but the user and the model both know the film meaning.

## What real filmmaking/comics call the layers

| Level | Film/TV | Comics & storyboards | Pixar/Disney board rooms |
|---|---|---|---|
| Top division of a story | Act (3- or 5-act) | Act / Chapter | Act |
| Mid chunk within an act | Sequence (mini-arc, 3-8 scenes) | — | Sequence (a self-contained action chunk like "the chase") |
| Continuous location/time moment | Scene | Scene | Scene |
| One camera setup | Shot | Panel / Frame | Boards / Panels |
| Intention shift within a scene | Beat | — | Beat |

**Key observations vs. our app:**

- Our "Sequence" is really an **Act**. In film terminology, a Sequence is between Act and Scene. We don't use that middle layer.
- Our "Shot" is really a **Panel**. In film terminology, a Shot is one camera setup and a Scene has many of them. We enforce one-per-Scene, which is "one Panel per Scene."
- We don't have "Sequences" (in the film sense) or "Beats" (in the dramatic sense) as explicit concepts. That's fine for this product — but we shouldn't call the wrong things by those names.

## Why this matters for story quality

The planner LLM's output quality depends on how unambiguously the prompt expresses constraints. Under the current names:

- **Rule 17** says *"exactly ONE shot for SQ1/SC1"* — the model has to mentally translate SQ/SC to the JSON `act.sequences[x].scenes[0]` tree, and keep it straight across every turn.
- **A user's "restructure sequence 2"** is ambiguous: do they mean the top-level UI Sequence (= JSON `act` 2) or a nested sequence (= JSON `sequence` inside Act 1)? Published evidence from the 7-turn experiment shows the model guessed wrong on Turn 4.
- **Rule 25** says *"update affected characters, locations, and upcoming shots"* — but "shots" is ambiguous (one frame or all frames in a scene?).

Under a clean Act / Scene / Panel vocabulary:

- "Exactly ONE Panel per Scene"
- "User says 'Act 2' → the top-level block"
- "Update affected characters, locations, and upcoming Panels"

Zero translation. Zero ambiguity. Better output with no model change.

## Three options we considered

### Option A — Do nothing

- Pro: zero risk, zero work.
- Con: the Turn 4-style structural-edit bug is baked in forever. The topbar chip stays misleading.

### Option B — Keep `Sequence / Scene / Shot` but add stronger disambiguation

- Pro: no UI change, users already familiar.
- Con: the disambiguation rule lives in the prompt and has to fire every turn. Doesn't fix the underlying naming mismatch. Users who learned film structure elsewhere will keep getting confused.

### Option C — Rename to `Act / Scene / Panel` (RECOMMENDED)

- Pro: matches how people actually talk about stories and storyboards. The word "Sequence" no longer has two meanings. "Panel" is the exact right word for one storyboard frame.
- Con: touches a lot of files. If we rename JSON keys too, requires a migration for existing projects.

## Why `Act / Scene / Panel` specifically

1. **Act** is universally understood. Every kid learns "three-act structure" somewhere. Every screenwriting book, every story-beat framework (Save the Cat, Hero's Journey, Dan Harmon's Story Circle) references Acts.
2. **Scene** is the mid-level word people already use when they describe a moment ("the scene where she reads the letter"). It means exactly what our nested `sequence` currently means: one location, one continuous moment, one story beat.
3. **Panel** is the exact right word for "one storyboard frame." Comics use it. Disney/Pixar board rooms use it. It's unambiguous and it does NOT collide with "Shot" (which in film means one camera setup and can be multiple per Scene).
4. Dropping "Sequence" removes the word that caused the biggest confusion — no more ambiguity between UI-Sequence and film-theory-Sequence.

## Proposed definitions (for the LLM)

These are the definitions that should go into the system prompt so the model has crisp mental models for each layer.

### Act

- A top-level division of the story's arc.
- Has a **narrative function**, not a length requirement.
- Default three-act target for this tool:
  - **Act 1 — Setup.** Establish the world, the protagonist, the ordinary life. End with the inciting incident that commits them to the journey.
  - **Act 2 — Confrontation.** The protagonist faces escalating obstacles. Midpoint shift changes what they're fighting for. Ends at the crisis / all-is-lost moment.
  - **Act 3 — Resolution.** Climax and its immediate aftermath. The new normal.
- A story can adjust the count (2 / 3 / 4 / 5 acts all valid) but the defaults should pressure toward three.
- Acts have descriptive titles the user should edit (*"The Village and the Warning"* over *"Setup"*).

### Scene

- A single continuous chunk of story. One location, one uninterrupted moment in time.
- Every Scene has a **story function**: it establishes, shifts, reveals, or reverses something. If it doesn't, it's cuttable.
- Default skeleton within the 3 acts: 2 Scenes in Act 1, 4 in Act 2, 2 in Act 3 (total 8).
- Examples from the "Echoes from the Tower" experiment:
  - *"The Keeper's Ritual"* — establishes Elin's world
  - *"The Impossible Message"* — inciting incident
  - *"First Correspondence"* — revelation (midpoint)
  - *"A Warning From Herself"* — reversal

### Panel

- One storyboard frame. One moment, one camera angle.
- Carries the visual contract for that Scene: composition, blocking, landmark geography, key props, mood, emotional focal point.
- Has fields: `location`, `time`, `visualDescription`, `action`, `dialogue`, `mood`, `storyFunction`, `characterIds`, `locationIds`.
- **One Panel per Scene** in this tool. (Multi-panel Scenes would require relaxing Rule 17; that's a future decision.)
- The visualDescription should read like a director's frame brief, not lyrical prose.

## Disambiguation rule (for ambiguous user prompts)

Add to the system prompt:

```
When the user refers to a story level, interpret using these defaults:
- "Act N", "Sequence N", or the top-level block → JSON key `act` = N
- "Scene N", "SC N" → a Scene inside an Act (JSON key `sequence` = N)
- "Shot", "Panel", "Frame", "SH N" → one visual frame (JSON key `scene`)

If the user's meaning is truly ambiguous, ASK before mutating.
Include your interpretation in the chat reply (e.g. "I'll change Act 2
(Confrontation) — is that what you meant?"). Never silently reinterpret.
```

This is the single most important line for preventing Turn-4-style bugs.

## Migration plan

### Phase 1 — Prompt-only (this change)

- Update `SYSTEM_PROMPT_TEMPLATE` to use Act / Scene / Panel consistently
- Add elaborate definitions for each layer (as above)
- Add the disambiguation rule
- Add an explicit medium-change rule (ties to the Turn-6 bible-propagation bug)
- Leave JSON keys and UI labels unchanged

This gives us the biggest brain-quality bump with zero breaking changes. The model outputs improve immediately.

### Phase 2 — UI labels (next PR)

- `ActRow` header: "SEQUENCE 1: SETUP" → "ACT 1 · SETUP"
- `SceneCard` label: "Shot" pill → "Panel" pill
- Topbar counter: "SCENES" → "PANELS"
- Help / tutorial / placeholder text: replace "Sequence" → "Act", "Shot" → "Panel" everywhere user-visible

Risk: ~40 strings across ~12 files. Mechanical; can be done in half a day with careful grep.

### Phase 3 — JSON keys (optional migration PR)

Rename on disk:
- `act` → `act` (stays, it was right)
- `sequence` → `scene`
- `scene` → `panel`

Plus:
- `scenes_add` → `panels_add`
- `scenes_update` → `panels_update`
- `scenes_remove` → `panels_remove`

Add migration in `loadProject()` that detects old-shape files and translates in-memory (persists back on next save).

After Phase 3, the terminology-mapping block in the prompt disappears entirely — JSON and UI agree. Saves ~250 tokens per turn.

## Enhanced field schemas (future, not in this PR)

If story quality is still not at desired level after the rename, consider adding these fields:

**Scene-level:**
- `beat` — the dramatic beat, one of: `setup / incite / escalate / reveal / reverse / climax / resolve / release`
- `tension` — a 0-10 dramatic-tension level so the overall arc can be graphed
- `narrativeFunction` — short tag: what shifts in this Scene

**Panel-level:**
- `shotType` — `wide / medium / close / ECU / OTS / 2-shot / master / insert`
- `cameraMovement` — `static / pan / tilt / dolly / handheld / crane`
- `focalCharacter` — who the frame is *about*, as distinct from `characterIds` (who's IN the frame)
- `lightingKey` — `high-key / low-key / silhouette / practical / available`
- `colorPalette` — short phrase like "warm amber + deep blue"

These turn the Panel into a more-professional pre-pro tool. Each one is additive — we'd add them to `Shot schema` in the system prompt, the LLM starts emitting them, the UI progressively surfaces them in the Shot Inspector.

## What's NOT changing

- The "one Panel per Scene" constraint (Rule 17). Relaxing this is a separate design decision with UI consequences.
- The 3-act / 2-4-2 default skeleton. Still the right default.
- The `story_outline` top-level bootstrap shape. Still correct.
- Any existing project data. Phase 1 changes nothing on disk.
- The image-prompt pipeline. It reads Panel fields that already exist.

---

## Implementation note for Phase 1

What's being changed in this PR:

1. `src/prompts/system-prompt.js`:
   - Replace the terminology-mapping block (5 lines) with a fuller Act/Scene/Panel definition block (~30 lines).
   - Add the disambiguation rule (8 lines).
   - Rewrite Rule 25 (medium-change) to explicitly require updating `characters_update` and `locations_update`, not just shots — directly addressing the Turn 6 bug.
   - Rewrite Rules 16 and 18 with positive framing instead of "NEVER write X."
   - Consolidate Rules 20, 23, 24, 26 into a single "Continuity" rule.

2. Net effect: fewer rules, cleaner definitions, unambiguous user-intent handling, explicit bible-propagation on medium changes. JSON keys and UI remain unchanged.

After this lands, test with at least 2 fresh stories (same protocol as the 7-turn experiment) and compare Turn-4-style structural changes and Turn-6-style medium changes against the prior baseline.
