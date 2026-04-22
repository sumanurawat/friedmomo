# Story structure

This is the brain of Storyboarder. Every screen, every AI response, every image prompt assumes this hierarchy. If the vocabulary ever feels confusing, the right mental model is the one below — not whatever label happens to be in the current UI.

## The three layers

```
Project
 └─ Act         (dramatic movement — 2-5 per story)
     └─ Sequence   (continuous story beat — 1-6 per Act)
         └─ Shot    (one drawn frame — exactly 1 per Sequence)
```

Three layers. No more, no fewer. Every concept in the app maps to one of them.

### Act

A top-level dramatic movement. This is where a classical story makes its big turns: the Setup, the Confrontation, the Resolution. A three-act arc is the most common, but there's nothing sacred about the number:

- A **fable or nursery story** might need 2 Acts.
- A **feature-style arc** is typically 3 Acts.
- A **TV episode or long-form piece** might have 4 or 5 Acts.

Acts have descriptive narrative titles — "The Village and the Warning", "The Last Hunt" — not generic labels like "ACT 1" or "Setup". The title names the movement's dramatic job.

### Sequence

A continuous story beat: one location, one uninterrupted moment in time. Sequences are the middle layer — the dramatic bricks an Act is built from. Each Sequence has a specific job in the story: it **establishes**, **shifts**, **reveals**, or **reverses** something. If you can't name the Sequence's job in one phrase, it's probably cuttable.

Sequence counts scale with the story:

- A short fable might have 1–2 Sequences per Act (total 4–6).
- A short film or commercial has 2–3 per Act (total 6–10).
- A feature-length arc has 2–3 in Act 1 and Act 3, and 3–5 in Act 2 (total 10–15).
- An epic or long-form piece has 3–5 per Act (total 15+).

In the UI, each Sequence is one of the horizontal orange bars. In the data, it's `act.sequences[]`.

### Shot

One drawn storyboard frame. One moment from one camera angle. The Shot carries the **visual contract** for its Sequence: composition, blocking, landmark geography, key props, mood, the emotional focal point.

> **Exactly one Shot per Sequence in Storyboarder.** If a Sequence needs more visual coverage than one frame can hold, split it into two adjacent Sequences, each with their own Shot. This keeps shot-size rhythm readable across the board and is the rule we use to size storyboards honestly.

Shots are what the AI image model renders. Each Shot's `visualDescription` is written as a director-facing frame brief — it starts with the shot size (wide / medium / close-up / ECU / OTS / 2-shot), the angle (eye-level / low / high / dutch / POV), and the camera movement (static / push-in / pull-back / handheld / crane). Then the composition, blocking, and emotional focal point.

In the UI, each Shot is a card inside a Sequence. In the data, it's `sequence.scenes[]` (the JSON key name is historical — each entry in that array is a Shot, not a Sequence).

## Project-level style

Alongside the hierarchy, each project has one more piece of metadata:

- **storyStyle** — a single sentence that describes the visual style applied to every Shot. Set on the first user turn by a small model, editable via the badge next to the List/Grid toggle. Example: *"Monochrome pencil storyboard, rough crosshatching, gritty noir mood, 16:9 letterbox, no text overlays."*

This is what makes every Shot in a given project look like part of the same board. Change it once, and the next round of image regeneration picks up the new style.

## Why this hierarchy

This three-level model (Act → Sequence → Shot) comes from film practice. It's what working showrunners, screenwriters, and storyboard artists use day-to-day. Every layer has a distinct job:

- **Acts** organize the **dramatic arc** — big turns and reversals.
- **Sequences** organize **continuous action** — one place, one moment, one beat.
- **Shots** organize **visual language** — what the camera sees first, at what size, from what angle.

When you mix these up — trying to stuff a scene change into a single shot, or treating a Sequence as if it can hold six frames — the storyboard stops communicating to the director and the artist.

## Glossary — what to use, what to avoid

| Use | Avoid | Why |
|---|---|---|
| **Act** | "chapter", "part" | Act is the industry term. Readers of a storyboard expect it. |
| **Sequence** | "scene", "block", "beat" | Sequence is unambiguous; "Scene" in everyday usage can mean any of our three layers. |
| **Shot** | "panel", "frame", "card" | Shot is what the camera captures; it's the word an AD or a DP uses on set. |
| **storyStyle** | "tone", "mood", "look" | "Style" specifically refers to the visual treatment: medium, line quality, palette. Tone and mood are *per-Shot*, not project-wide. |

If a user says "Scene 3", assume they mean the third **Sequence** unless the context clearly implies a Shot.

## JSON keys (for contributors)

The internal JSON keys are historical and don't match the user-facing vocabulary one-for-one. When editing the system prompt or the store, remember:

| Layer | JSON key | User-facing name |
|---|---|---|
| 1 | `act` / `story_outline.acts[]` | Act |
| 2 | `sequence` / `act.sequences[]` | Sequence |
| 3 | `scene` / `sequence.scenes[]` / `scenes_add[]` | Shot |

The keys are stable and must not be renamed without a full data migration. User-facing strings are free to evolve.

## Seeing this live

- The **top counter** shows the number of Shots, Characters, and Locations in the current project.
- The **horizontal orange bars** are Acts (not Sequences — the label "SEQUENCE" in an older version of the UI was the source of confusion this doc was written to fix).
- The **Sequence bar breadcrumb** inside a Shot's inspector (e.g. *"Act 1, Sequence 2"*) tells you where that Shot lives in the hierarchy.
- The **storyStyle badge** next to the List/Grid toggle shows the project's current visual style.
