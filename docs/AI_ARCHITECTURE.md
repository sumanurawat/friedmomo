# Storyboarder — AI Brain & Prompt Architecture

Last updated: 2026-04-17
Source of truth: `src/prompts/system-prompt.js`, `src/services/ai-client.js`, `server/routes/ai.js`, `src/services/scene-images.js`, `src/store/project-store.js`, `src/utils/storyboard-ops.js`

---

## TL;DR

There are **three distinct AI calls** in this app, each with its own prompt and its own model:

| # | Call | Model used | Where the prompt is built | Purpose |
|---|---|---|---|---|
| 1 | **Planner chat** (the "brain") | `settings.planningModel` (user-selectable, e.g. `anthropic/claude-opus-4`) | `buildSystemPrompt()` in `src/prompts/system-prompt.js` | Reads the entire storyboard state + user message, returns a chat reply **+ a structured JSON patch** that mutates the project. |
| 2 | **Title generator** | **Hard-locked** to `google/gemini-2.5-flash-lite` — cheap/fast. Server ignores any client-sent model override. | Inline in `server/routes/ai.js`, `handleAI` `/api/ai/title` | Produces a 2–5 word title for a brand-new story from the user's first message. |
| 3 | **Shot image generator** | `settings.imageModel` (e.g. `google/gemini-2.5-flash-preview-image`) | `buildSceneImagePrompt()` in `src/services/scene-images.js` | Produces a natural-language frame description → sent to the multimodal model to render a single cinematic storyboard image. |

Only call #1 is "the brain". Calls #2 and #3 are small, stateless utilities. Everything else in the app (rename, delete, collapse, add-shot manually, PDF export, etc.) is deterministic JavaScript — no AI involved.

Only provider currently wired: **OpenRouter**. Ollama has been removed.

---

## End-to-end flow diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                       │
│                                                                               │
│  ┌────────────────┐    user types in Chat    ┌──────────────────────────┐     │
│  │  ChatPanel.jsx │─────────────────────────▶│ project-store            │     │
│  │                │                          │   .sendUserMessage()     │     │
│  └────────────────┘                          │                          │     │
│                                              │  1. append user msg      │     │
│                                              │  2. buildSystemPrompt(   │     │
│                                              │       storyboard,        │     │
│                                              │       entities,          │     │
│                                              │       chatMode)          │     │
│                                              │  3. buildApiMessages(…)  │     │
│                                              │  4. sendMessage(…)  ─┐   │     │
│                                              └──────────────────────┼───┘     │
│                                                                     │         │
│                               (1) Planner chat                      ▼         │
│                                              ┌───────────────────────────┐    │
│                                              │ ai-client.js              │    │
│                                              │   POST /api/ai/chat       │    │
│                                              │   SSE stream reader       │    │
│                                              │   idle/cap/connect timers │    │
│                                              └───────────────────────────┘    │
│                                                                               │
│                               (3) Image gen (per-shot, on click / autogen)    │
│                                              ┌───────────────────────────┐    │
│                                              │ scene-images.js           │    │
│                                              │   buildSceneImagePrompt() │    │
│                                              │   generateImage()         │    │
│                                              │   → POST /api/ai/image    │    │
│                                              └───────────────────────────┘    │
│                                                                               │
│                               (2) Title (once, on first message of new story) │
│                                              ┌───────────────────────────┐    │
│                                              │ ai-client.js              │    │
│                                              │   generateTitle()         │    │
│                                              │   → POST /api/ai/title    │    │
│                                              └───────────────────────────┘    │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │  localhost:3001  (Vite proxy /api → :3001)
┌───────────────────────────────────▼──────────────────────────────────────────┐
│ LOCAL BACKEND (server/routes/ai.js)                                          │
│                                                                              │
│   /api/ai/chat   ── attaches user's OpenRouter/Ollama key → streams SSE      │
│   /api/ai/title  ── one-shot call with a hardcoded "generate a title" prompt │
│   /api/ai/image  ── one-shot call with modalities:['image','text'], 16:9     │
│                                                                              │
│   Logs every call (requestId, ttfb, bytes, chunks, upstream status, errors)  │
│   into <workspace>/logs/storyboarder.jsonl                                   │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │ HTTPS + Bearer <apiKey>
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ UPSTREAM AI PROVIDER                                                         │
│   openrouter.ai  (or  api.cloud.ollama.com)                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Planner response round-trip

When the planner reply lands, the frontend does NOT display the raw JSON. It goes through a parser + enforcer pipeline:

```
 streamed SSE tokens
        │
        ▼
 extractStreamingChat(fullText)   ← shows only the `chat` field while streaming
        │
        ▼
 parseAIResponse(fullText)        ← JSON.parse, with fence stripping + recovery
        │
        ▼
 harmonizeStoryOutlineWithChat()  ← reconcile story_outline vs scenes_add
        │
        ▼
 enrichShotUpdatesFromChat()      ← fill missing IDs / defaults
        │
        ▼
 enforceSceneMutationPolicy()     ← hard rules: no dup shots, respect focus,
                                    no reordering on manual edits, etc.
        │
        ▼
 applyUpdatesToProject()          ← mutates Zustand store
        │
        ▼
 saveProject()                    ← PUT /api/projects/:id
```

If the model violates a rule (tries to add a 2nd shot to an already-filled scene, tries to recreate a shot instead of using `scenes_update`, invents a scene ID, etc.), `enforceSceneMutationPolicy` silently rejects or remaps that update. This is the safety net that keeps the user's board from drifting.

---

## (1) Planner chat prompt — the brain

**File:** `src/prompts/system-prompt.js`
**Function:** `buildSystemPrompt(storyboard, entities, chatMode)`

The final system prompt is assembled at send-time from **four blocks** stitched in order:

```
┌─────────────────────────────────────────────────┐
│ A. SYSTEM_PROMPT_TEMPLATE   (static, ~130 lines)│  ← identity + JSON schema + 26 rules
├─────────────────────────────────────────────────┤
│ B. CURRENT STATE             (dynamic)          │  ← full structure + shots + characters
├─────────────────────────────────────────────────┤                + continuity bible
│ C. INTERACTION MODE          (dynamic)          │  ← plan OR lucky (auto-generate)
├─────────────────────────────────────────────────┤
│ D. STORY ONBOARDING          (only if empty)    │  ← fires only when storyboard has 0 shots
└─────────────────────────────────────────────────┘
```

### Block A — static template (verbatim)

```text
You are Storyboarder AI — a creative collaborator that helps users develop
stories through natural conversation.

Return valid JSON ONLY in this exact shape:
{
  "chat": "Your natural-language response",
  "updates": {
    "story_outline": { "acts": [] },
    "acts_update": [],
    "sequences_add": [],
    "sequences_update": [],
    "scenes_add": [],
    "scenes_update": [],
    "scenes_remove": [],
    "characters_add": [],
    "characters_update": [],
    "locations_add": [],
    "locations_update": []
  }
}

Terminology mapping for this app:
- JSON key `act` (and `story_outline.acts`) is shown in UI as a Sequence.
- JSON key `sequence` (and `act.sequences`) is shown in UI as a Scene.
- Each item in `scenes_add` / `scenes_update` is a Shot card.
- In chat text, prefer Sequence / Scene / Shot terms.

Story outline schema (use this for initial structuring or major restructuring):
{ "acts": [{ "act": 1, "title": "Setup / Ordinary World",
             "sequences": [{"title": "Inciting Incident"},
                           {"title": "Debate / Commitment"}] }] }

Sequence update schema (JSON key still `act`):
{ "act": 1, "changes": { "title": "New Sequence Title" } }

Scene add schema (JSON key still `sequences_add`):
{ "act": 1, "title": "New Scene", "afterSequence": 2 }

Scene update schema (JSON key still `sequences_update`):
{ "act": 1, "sequence": 2, "changes": { "title": "Refined Scene Title" } }

Shot schema for scenes_add:
{ "act": 1, "sequence": 1, "title": "The Empty Apartment",
  "location": "INT. APARTMENT - NIGHT", "time": "Late evening",
  "visualDescription": "Storyboard-ready camera-visible frame description…",
  "action": "Present-tense physical action…",
  "dialogue": [{"character": "Maya", "line": "Where are they..."}],
  "mood": "Unsettled, quiet tension",
  "storyFunction": "Why this shot exists",
  "characterIds": ["maya"],
  "locationIds": ["mayas_apartment"] }

Shot update schema (JSON key `scenes_update`):
{ "sceneId": "scene_ff29ee9a",
  "changes": { "visualDescription": "…", "action": "…" } }

Character schema for characters_add:
{ "name": "Maya",
  "description": "30s, tired eyes, paint-stained fingers",
  "visualPromptDescription": "Highly detailed reusable visual identity",
  "role": "Protagonist" }

Location schema for locations_add:
{ "name": "Maya's Apartment",
  "description": "Small studio with bare walls",
  "visualPromptDescription": "Highly detailed reusable location description",
  "mood": "lonely, recently abandoned" }

Story structure target:
- Sequence 1 / scenes 1-2 (setup)
- Sequence 2 / scenes 1-4 (confrontation)
- Sequence 3 / scenes 1-2 (resolution)

Rules:
 1. JSON only, no markdown fences.
 2. Keep chat concise, warm, and forward-moving.
 3. In guided planning mode, add 1 shot per turn unless user explicitly asks for
    multiple. In autonomous mode, you may add multiple shots when bootstrapping
    or restructuring the board.
 4. Visual descriptions must be vivid, specific, and storyboard-ready for future
    image generation. Write them like a director-facing frame brief…
 5. Reuse consistent character/location IDs when possible.
 6. User direction always wins.
 7. If this is an early-stage story request, set/adjust sequence and scene
    structure using story_outline first, then add shots.
 8. If user asks to change or edit an EXISTING shot, you MUST use `scenes_update`
    with its `sceneId`. DO NOT recreate it using `scenes_add`.
 9. Do not create nested or sub-sequences.
10. Never create duplicate shots in the same Sequence/Scene with the same intent/title.
11. If user gives "focus scene" context, prioritize updates for that scene.
12. If user sends "Edit shot context ID", update only that shot.
13. If no explicit focus target, add shots only to the next ordered Scene slot.
14. Do not skip earlier scenes; fill coverage in order before deepening later.
15. Keep chat responses to 1–2 sentences. Summarize WHAT changed.
16. DO NOT include conversational filler or action prefixes in JSON fields.
17. NEVER add more than 1 shot per SC (Scene) slot. Exactly ONE shot per SC.
18. Shot Titles must be concise and standalone. Never prepend Sequence or Scene
    context to the shot title.
19. On the FIRST substantive user prompt in autonomous mode, create a usable
    foundation in one pass: full `story_outline`, core characters, core
    locations, and at least the first 4 ordered shot slots.
20. Prefer updating existing storyboard state rather than restating unchanged
    material.
21. In autonomous mode, the board should feel alive immediately.
22. Every shot should help a director visualize production choices.
23. Treat the project like a continuity bible.
24. Use characters' and locations' `visualPromptDescription` fields as reusable
    continuity anchors.
25. If the user changes the medium or world style, update affected characters,
    locations, and upcoming shots so the whole board stays coherent.
26. New shots must fit the already established visual world.
```

### Block B — `## CURRENT STATE` (dynamic)

Rebuilt on every turn. Example (after user has 2 shots written):

```text
## CURRENT STATE

Structure:
- Sequence 1: The Obedient Daughter -> SC1 [index 1] Ophelia in the Court
                                     | SC2 [index 2] Polonius's Warning
- Sequence 2: Love, Madness & Betrayal -> SC1 [index 1] Hamlet's Affection Turns Cold
                                        | SC2 [index 2] The Nunnery Scene
                                        | SC3 [index 3] The Play & Polonius's Death
                                        | SC4 [index 4] Ophelia's Descent into Madness
- Sequence 3: Drowning / Funeral -> SC1 [index 1] The Drowning
                                  | SC2 [index 2] The Funeral

Next ordered shot target: Sequence 2, Scene 1.

Continuity bible:
- Established visual medium/style: cinematic storyboard world with strong visual continuity.
- Preserve existing character design, species/form, wardrobe logic, environment language,
  and tone unless the user explicitly changes them.

Character anchors:
- Ophelia: Young noblewoman, pale, red-gold hair, eyes downcast; wears pastel dresses…
- Polonius: Older man, close-cropped grey hair, heavy dark court robes with fur collar…

Location anchors:
- Elsinore Great Hall: Stone floors, tall leaded windows, long tables, cold morning light…

Shots (2):
- [SQ1.SC1] A Girl at the Edge of the Room (scene_ff29…):
    Establishes Ophelia as peripheral to power — obedient, observant…
    | INT. ELSINORE GREAT HALL - DAY
    | cast: Ophelia
    | frame: Wide shot of the hall, Ophelia small in the lower-right third…
- [SQ1.SC2] A Father's Command (scene_54b1…):
    The inciting lock-in: Ophelia is ordered to sever her connection to Hamlet…
    | INT. POLONIUS'S CHAMBERS - EVENING
    | cast: Ophelia, Polonius, Laertes
    | frame: Medium two-shot in a cramped, richly furnished chamber…

Characters:
- Ophelia (ophelia) — Protagonist: …
- Polonius (polonius) — Supporting: …
- Laertes (laertes) — Supporting: …

Locations:
- Elsinore Great Hall (elsinore_hall) — cold, formal: …
- Polonius's Chambers (polonius_chambers) — paternal, oppressive: …
```

This block gives the model **full memory of what's already on the board** so it can update instead of duplicate, and keep visual continuity across shots.

### Block C — `## INTERACTION MODE` (dynamic)

Two variants, selected by the **General → Chat Mode** toggle:

**"Auto-Generate" (default, `mode: 'lucky'`):**
```text
## INTERACTION MODE: Autonomous Creative

You are in autonomous mode. The user wants you to proactively build and refine
the storyboard.
- Freely add, update, and remove shots based on the conversation.
- Proactively improve existing shots when you see opportunities.
- Restructure sequences/scenes if it serves the story.
- Create characters and locations as needed without asking permission.
- On the first real story prompt, create the full story spine and fill at least
  the first 4 ordered shot slots so the board feels alive immediately.
- Use the user prompt to map the full story arc quickly, but spend the most
  detail on the near-term shots the user will see first.
- Write every visual as if it is guiding a director and storyboard artist
  toward a shootable frame.
- Be bold and creative — the user trusts your judgment.
- Still explain what you changed in the chat response so the user can follow along.
```

**"I know what I'm doing" (`mode: 'plan'`):**
```text
## INTERACTION MODE: Guided Planning

You are in planning mode. The user wants to drive the creative process.
- Focus on discussion, suggestions, and asking clarifying questions.
- Only add new shots when the user explicitly asks for them.
- Do NOT update or remove existing shots unless the user specifically requests it.
- Keep updates.scenes_update and updates.scenes_remove empty unless directly asked.
- Propose structural changes in chat text first, then implement only after user confirms.
- Ask "Would you like me to add that?" before making storyboard changes.
```

### Block D — `## STORY ONBOARDING` (only for empty stories)

Fires **only when the storyboard has 0 shots**. Disappears as soon as any shot exists.

```text
## STORY ONBOARDING

This is a new story with no shots yet. Your first job is to establish the foundation.

1. If the user describes a well-known story (fairy tale, classic, etc.), recognize
   it and propose a logline, main characters (with descriptions, roles, visual
   details), and a 3-sequence structure.
2. If the user has an original idea, ask about:
   - Genre and tone/vibe
   - Main characters
   - Core conflict or premise
3. Capture EVERYTHING in updates immediately:
   - characters_add with rich descriptions and visualPromptDescription
   - locations_add for any mentioned settings
   - story_outline with sequence/scene structure
   - initial shots to flesh out the opening
4. Be professional — treat this like a real pre-production breakdown.

(if mode == 'lucky')
Build immediately from whatever the user gives you. Create characters, locations,
and an initial sequence structure in your very first response.
Fill the first 4 available shot slots in order, not just one or two, so the user
sees a real storyboard forming immediately.
If the story premise is a known tale, myth, fairy tale, or adaptation, confidently
map the complete sequence/scene spine in this first pass.

(if mode == 'plan')
Ask clarifying questions before building. Propose the structure in chat text,
then create it after confirmation.

In this response, include updates.story_outline with sequence+scene titles
before shot additions.
```

---

## (2) Title generator prompt

**File:** `server/routes/ai.js`, handler for `POST /api/ai/title`
**Model:** same as planner (`settings.planningModel`)

Called **once**, from `project-store.sendUserMessage()`, the very first time the user sends a message in a new story (before the system still has the default title "My First Story").

The request body sent to OpenRouter is literally:

```json
{
  "model": "<planning model>",
  "messages": [
    { "role": "system",
      "content": "Generate a concise, creative story title (2-5 words) based on this message. Return only the title — no quotes, no punctuation at the end, no explanation." },
    { "role": "user", "content": "<the user's first chat message, verbatim>" }
  ]
}
```

Non-streaming. Returns plain text; failure silently falls back to `"Untitled Story"`.

---

## (3) Shot image generator prompt

**File:** `src/services/scene-images.js`
**Function:** `buildSceneImagePrompt(scene, entities, storyboard)`
**Model:** `settings.imageModel` (e.g. `google/gemini-2.5-flash-image`)
**Transport:** `POST /api/ai/image` on the local backend → OpenRouter `/chat/completions` with `modalities: ['image', 'text']` and `image_config: { aspect_ratio: '16:9' }`.

This is NOT a fixed system prompt — it's a prose prompt assembled from the shot's data plus the continuity anchors. Example output for one shot:

```text
Create one cinematic storyboard frame that matches the established project continuity.
Medium: cinematic storyboard world with strong visual continuity
Emphasize framing, blocking, landmark geography, key props, and the main focal point.
Scene: A Father's Command
Story context: The Obedient Daughter -> Love, Madness & Betrayal
Setting: INT. POLONIUS'S CHAMBERS - EVENING, Dusk, candlelight
Continuity: Match the established cinematic storyboard world with strong visual continuity.
            Preserve character species/forms, silhouette, wardrobe logic, and environment
            design language from the rest of the storyboard. This beat follows "A Girl at
            the Edge of the Room".
Composition: Medium two-shot in a cramped, richly furnished chamber. Polonius stands
             frame left, a stout older man in heavy dark robes with a fur-trimmed collar…
Action: Polonius is lecturing; Ophelia sits on a low stool frame right with the
        surrendered letters in her lap; Laertes lingers in the doorway behind them…
Mood: tense, paternal, oppressive
Characters:
- Ophelia: Young noblewoman, pale, red-gold hair, pastel dresses, muted silhouette…
- Polonius: Older man, grey hair, heavy dark court robes with fur collar…
Location details:
- Stone walls, heavy oak desk with candelabra, ribbon-tied letters as key prop…
Style: cinematic composition, cohesive production design, storyboard-quality staging
```

All fields come from the scene/shot object and the entity stores — the image model never sees the planner's system prompt.

---

## Quick reference — where to edit what

| If you want to change… | Edit this file | Function |
|---|---|---|
| The core "who is Storyboarder AI" + rules + JSON schema | `src/prompts/system-prompt.js` | `SYSTEM_PROMPT_TEMPLATE` (lines 1–135) |
| How current state is summarized to the model | `src/prompts/system-prompt.js` | `stateBlock` assembly (~line 217) |
| Autonomous-vs-planning mode wording | `src/prompts/system-prompt.js` | `modeBlock` ternary (~line 233) |
| First-run onboarding behavior | `src/prompts/system-prompt.js` | `bootstrapBlock` (~line 258) |
| Continuity bible / medium inference | `src/prompts/system-prompt.js` | `buildContinuityBlock` / `inferVisualMedium` |
| Title generator phrasing | `server/routes/ai.js` | `'system'` message inside the `/api/ai/title` handler |
| Image prompt structure | `src/services/scene-images.js` | `renderSceneImagePromptWithCaps()` |
| Which model handles which call | `Settings → Models` (runtime) | — |

---

## What gets logged

Every AI call is logged end-to-end. Tail the logs during development to see exactly what prompt was sent and what came back:

```sh
tail -f ~/Storyboarder/logs/storyboarder.jsonl | jq 'select(.event | startswith("ai."))'
```

Events in chronological order for one chat turn:

| Event | Side | Key fields |
|---|---|---|
| `ai.chat.send` | client | clientRequestId, provider, model, messageCount, systemPromptChars |
| `ai.chat.start` | server | requestId, clientRequestId, provider, model, messageCount, endpoint |
| `ai.chat.upstream_headers` | server | status, ttfbMs |
| `ai.chat.headers` | client | serverRequestId, status, ttfbMs |
| `ai.chat.done` | server | bytes, chunks, durationMs |
| `ai.chat.done` | client | responseChars, durationMs, chunks |

Client and server are correlated via `X-Client-Request-Id` / `X-Request-Id` headers so you can trace a single user action across both processes.

---

# Part II — The text-modelling layer

> The planner model is powerful but undisciplined. The *text-modelling layer* is everything the app does around that model to keep its output consistent, on-schema, and respectful of the user's existing work. This is where the real product logic lives.

This section documents the **skeleton** (what a story looks like in this app), the **schema** (what the model is required to emit), the **state summary** (what we feed back to the model on every turn), the **enforcement** (what we silently reject or rewrite from the model's output), and the **image pipeline** (how shots become images).

## 1. The story skeleton — three nested levels

```
Project                         ← one project = one story
└── Sequence (aka "act")        ← top-level narrative chunk; 3 by default
    └── Scene (aka "sequence")  ← a beat/location inside the sequence
        └── Shot (aka "scene")  ← one camera setup / storyboard panel
```

**Historical note about the names.** Internally, the JSON keys are `act / sequence / scene` (inherited from an earlier data model). The UI and prompt both rename them to **Sequence / Scene / Shot** because that terminology matches how filmmakers talk. Every prompt includes this mapping so the model knows what to call things in chat *and* what key to write in JSON:

```text
Terminology mapping for this app:
- JSON key `act`       (and `story_outline.acts`)  → UI "Sequence"
- JSON key `sequence`  (and `act.sequences`)        → UI "Scene"
- Each item in `scenes_add` / `scenes_update`       → UI "Shot"
```

This mismatch is a known source of confusion. If you ever rename the JSON keys, you'd need to migrate every existing `project.json` file on disk too.

**Default skeleton target** (the prompt tells the model to aim for this shape):

```
Sequence 1 (Setup)         → Scene 1, Scene 2                         → 1 Shot each
Sequence 2 (Confrontation) → Scene 1, Scene 2, Scene 3, Scene 4       → 1 Shot each
Sequence 3 (Resolution)    → Scene 1, Scene 2                         → 1 Shot each
```

That's the default 8-shot seed. The stats chip at the top of the UI shows `N/8 scenes filled`; the `8` is this skeleton's shot-slot count. The model can add or restructure sequences/scenes, but this is the starting skeleton.

**The one-shot-per-scene rule.** Rule 17 of the system prompt is strict: each Scene (SC slot) contains **exactly one Shot**. If the user asks to "add another shot to SC1", the model should either:
- Update the existing SC1 Shot via `scenes_update`, or
- Add a new Shot to the next empty SC slot.

This keeps the board a clean grid of named beats instead of a stack of variations on the same frame. The enforcement layer re-checks this server-side — see §4.

## 2. The JSON contract — what the model MUST emit

The planner model is told to reply with this exact top-level shape (and nothing else — no prose, no markdown fences):

```json
{
  "chat": "Your natural-language response",
  "updates": {
    "story_outline":     { "acts": [] },
    "acts_update":       [],
    "sequences_add":     [],
    "sequences_update":  [],
    "scenes_add":        [],
    "scenes_update":     [],
    "scenes_remove":     [],
    "characters_add":    [],
    "characters_update": [],
    "locations_add":     [],
    "locations_update":  []
  }
}
```

| Key | Shape | Purpose |
|---|---|---|
| `chat` | string | The human-readable reply shown in the chat panel. 1–2 sentences. |
| `story_outline` | `{ acts: [] }` | Whole-story restructure. Used on day-1 bootstrap or major pivots. Creates/replaces the 3-Sequence spine with all Scene titles in one pass. |
| `acts_update` | `[{ act, changes }]` | Rename a Sequence. |
| `sequences_add` | `[{ act, title, afterSequence? }]` | Add a Scene to a Sequence. |
| `sequences_update` | `[{ act, sequence, changes }]` | Rename or edit a Scene. |
| `scenes_add` | `[{ act, sequence, title, location, time, visualDescription, action, dialogue, mood, storyFunction, characterIds, locationIds }]` | Add a Shot. |
| `scenes_update` | `[{ sceneId, changes }]` | Edit an existing Shot. Must use `sceneId`, NOT title+act+sequence. |
| `scenes_remove` | `[{ sceneId }]` | Delete a Shot. |
| `characters_add` / `_update` | `[{ name, description, visualPromptDescription, role }]` | Story-level character bible entries. |
| `locations_add` / `_update` | `[{ name, description, visualPromptDescription, mood }]` | Story-level location bible entries. |

### 2.1 Shot schema, field by field

A single Shot object in `scenes_add`:

```jsonc
{
  "act": 1,                     // which Sequence (int)
  "sequence": 1,                 // which Scene inside that Sequence (int)
  "title": "The Empty Apartment",// short standalone name (no "Seq/Scene: …" prefix)
  "location": "INT. APARTMENT - NIGHT",       // screenplay-style slug
  "time": "Late evening",                     // time-of-day / lighting hint
  "visualDescription": "Wide shot…",          // director-facing frame brief
  "action": "Maya walks in and stops.",       // present-tense on-screen beat
  "dialogue": [{ "character": "Maya", "line": "Where are they..." }],
  "mood": "Unsettled, quiet tension",
  "storyFunction": "Establishes her isolation at the inciting moment",
  "characterIds": ["maya"],                   // references characters bible
  "locationIds":  ["mayas_apartment"]         // references locations bible
}
```

- **`visualDescription` vs `action`:** `visualDescription` describes what the camera *sees* (framing, composition, landmarks); `action` describes what *happens* (motion, beat). Both feed the image prompt.
- **`characterIds` / `locationIds`:** references into the story's `entities.characters[]` and `entities.locations[]` arrays. Reusing the same `id` across shots is how continuity is enforced — the image prompt pulls that entity's `visualPromptDescription` whenever the id shows up.
- **IDs are slugs, not UUIDs** for entities (e.g. `"maya"`, `"polonius"`). For Shots, IDs ARE generated internally (`scene_<8-hex>`). The model only emits shot IDs when updating existing shots (`scenes_update`).

### 2.2 Entity schemas — the continuity bible

**Character** (`characters_add`):
```jsonc
{
  "name": "Maya",
  "description":             "30s, tired eyes, paint-stained fingers",          // short pitch
  "visualPromptDescription": "Highly detailed reusable visual identity string", // used in image prompts
  "role": "Protagonist"      // Protagonist | Antagonist | Supporting | Cameo | custom
}
```

**Location** (`locations_add`):
```jsonc
{
  "name": "Maya's Apartment",
  "description":             "Small studio with bare walls, peeling paint",
  "visualPromptDescription": "Highly detailed reusable location description",
  "mood": "lonely, recently abandoned"
}
```

The `visualPromptDescription` fields are the **continuity anchors**. Whenever a Shot references a character or location by id, the image pipeline injects that anchor into the image prompt so the same character/place looks the same across shots. If the user says "make her costume red now", the model is expected to update the anchor *and* the affected upcoming shots so the change propagates.

### 2.3 Story-outline schema (day-1 bootstrap)

```jsonc
{
  "acts": [
    {
      "act": 1,
      "title": "Setup / Ordinary World",
      "sequences": [
        { "title": "Inciting Incident" },
        { "title": "Debate / Commitment" }
      ]
    },
    {
      "act": 2,
      "title": "Confrontation",
      "sequences": [
        { "title": "New World / First Attempts" },
        { "title": "Midpoint Shift / Revelation" },
        { "title": "Rising Stakes" },
        { "title": "All Is Lost" }
      ]
    },
    {
      "act": 3,
      "title": "Resolution",
      "sequences": [
        { "title": "Climax" },
        { "title": "Aftermath" }
      ]
    }
  ]
}
```

Only emitted when the story is empty (or during a major restructure). Creates the full 3-Sequence / 8-Scene spine in one pass before any Shots exist.

## 3. The state summary — how we re-hydrate the model each turn

Every time the user sends a message, the frontend rebuilds the system prompt from scratch. There is **no conversation-level state retention** beyond what we re-serialize into the prompt. The rebuilt prompt is glued in front of the OpenAI-style `messages` array like this:

```
┌─ SYSTEM MESSAGE ────────────────────────────────────────┐
│ [ Static template (rules, schemas) ]                    │
│ [ CURRENT STATE — see below ]                           │
│ [ INTERACTION MODE — plan or lucky ]                    │
│ [ STORY ONBOARDING (only if empty) ]                    │
└─────────────────────────────────────────────────────────┘
┌─ USER ──────────────────────────────────────────────────┐
│ (previous visible user message)                         │
└─────────────────────────────────────────────────────────┘
┌─ ASSISTANT ─────────────────────────────────────────────┐
│ (previous reply — just the `chat` field, not the JSON)  │
└─────────────────────────────────────────────────────────┘
… (paired user/assistant turns, up to the history limit)
┌─ USER ──────────────────────────────────────────────────┐
│ (NEW user message, possibly with hidden "focus" context │
│  like "[Edit shot scene_abc]")                          │
└─────────────────────────────────────────────────────────┘
```

The server then forwards this to OpenRouter as a normal `chat/completions` streaming request.

### 3.1 The `## CURRENT STATE` block — what the model sees about your board

Rebuilt from `storyboard` + `entities` on every turn. Its sections, in order:

**Structure.** One line per Sequence with its Scene titles listed inline. Compact because it's shown on every turn:
```
- Sequence 1: The Obedient Daughter -> SC1 [index 1] Ophelia in the Court
                                     | SC2 [index 2] Polonius's Warning
- Sequence 2: Love, Madness & Betrayal -> SC1 [index 1] Hamlet's Affection Turns Cold
                                        | …
```

**Next ordered shot target.** Single line that tells the model which (Sequence, Scene) is the next empty slot. Rule 13 of the system prompt says "only add shots to the next ordered Scene slot from the state summary" unless the user explicitly points elsewhere:
```
Next ordered shot target: Sequence 2, Scene 1.
```
This target is computed by `getNextSceneGenerationTarget()` in `system-prompt.js`: it walks the tree, finds the first empty scene slot, and if none are empty, picks the one with the fewest shots.

**Continuity bible.** This is the key block for visual consistency. Inferred every turn:
- An inferred **visual medium** label (e.g. "stop-motion / miniature practical fantasy world", "stylized animated world with anime-inspired continuity", "cinematic storyboard world with strong visual continuity"). Chosen by regexing the aggregated text of all shots/characters/locations for keywords. Default is "cinematic storyboard world with strong visual continuity" if nothing matches.
- **Character anchors** — up to 8, each one `name: visualPromptDescription (or description)`, truncated to 110 chars.
- **Location anchors** — up to 6, same format.
- **Visual motifs already on the board** — inferred by scanning shot text for pattern groups (`whimsical`, `surreal`, `dark fantasy`, `bright pastoral`, `urban city energy`, `animated animal cast`) and listing up to 4 that match.

Example:
```
Continuity bible:
- Established visual medium/style: cinematic storyboard world with strong visual continuity.
- Preserve existing character design, species/form, wardrobe logic, environment design language,
  and tone unless the user explicitly changes them.
Character anchors:
- Ophelia: Young noblewoman, pale, red-gold hair, pastel gown, eyes downcast…
- Polonius: Older man, close-cropped grey hair, heavy dark court robes with fur collar…
Location anchors:
- Elsinore Great Hall: Stone floors, tall leaded windows, long tables, cold morning light…
```

**Shots.** One dense line per existing Shot, so the model can see what's already on the board without getting overwhelmed:
```
- [SQ1.SC1] A Girl at the Edge of the Room (scene_ff29…):
    Establishes Ophelia as peripheral to power — obedient, observant…
    | INT. ELSINORE GREAT HALL - DAY
    | cast: Ophelia
    | frame: Wide shot of the hall, Ophelia small in the lower-right third…
```
Fields are clipped: `storyFunction` 90 chars, `visualDescription` 140 chars. Full values never leave the local machine.

**Characters / Locations.** One line per entity, same density, also truncated.

### 3.2 Interaction mode block — "plan" vs "lucky"

Selected by the user in **Settings → General → Chat Mode** (stored as `settings.chatMode`). Two variants (see full text in Part I):

- **`lucky`** (Auto-Generate) — the model is told to build aggressively, restructure freely, and on the first real prompt fill the spine and at least 4 ordered shot slots.
- **`plan`** (I know what I'm doing) — the model is told to discuss first, add only what the user explicitly asks for, and never rewrite existing shots.

This block is the smallest and cheapest lever you have to change the assistant's "personality" without touching code. Mess with the wording in `buildSystemPrompt()` if you want to tune the agent's proactivity.

### 3.3 Story onboarding block — day-1 only

Appears **only when `storyboard.acts[].sequences[].scenes.length === 0` everywhere** (i.e. the story has no Shots yet). As soon as any Shot exists, this block disappears from all future turns. It tells the model:
- Recognize well-known stories and map them out confidently
- For original ideas, probe for genre/tone/characters/logline
- Emit `story_outline` + `characters_add` + `locations_add` + initial Shots in the same first response
- Treat the first reply like a pre-production breakdown

In `lucky` mode it also says "fill the first 4 shot slots in your first response so the user sees something real immediately". That's what makes the very first AI reply feel so rich.

### 3.4 Conversation history — what goes into `messages`

Assembled by `buildApiMessages()` in `project-store.js`. Rules:

- Takes the visible message log for this project (`project.messages`).
- For each assistant message, only the `chat` field (human-readable summary) is kept — **the JSON `updates` are stripped** before re-sending. This keeps prior responses short and prevents the model from "replaying" updates.
- For each user message, the visible content is kept. For the most recent user turn, we may swap in a `transientUserContent` that includes hidden focus context (e.g. `[Edit shot scene_abc123]`) so the model knows which Shot you're editing *without* that tag showing up in the chat UI.
- Internal/system messages (tutorial nudges, focus prompts) are tagged and excluded from the API-facing history.

Note: there is no sliding-window truncation yet. If your chat gets very long, the messages array grows unbounded. The `## CURRENT STATE` block is the *real* memory — prior turns mostly provide tone continuity.

## 4. The enforcement layer — what we silently do to the model's output

The model's reply is *not* trusted as-is. After streaming completes, the raw text goes through a 5-stage pipeline in `project-store.sendUserMessage()` before any state mutation:

```
 raw SSE stream
      │
      ▼
┌──────────────────────────────────┐
│ extractStreamingChat(fullText)   │  ← shown live in UI as the model types
└──────────────────────────────────┘  (strips JSON, shows only `chat`)
      │
      ▼
┌──────────────────────────────────┐
│ parseAIResponse(fullText)        │  ← JSON.parse with fence stripping
└──────────────────────────────────┘  (tolerates ```json fences, trailing prose)
      │
      ▼
┌──────────────────────────────────┐
│ harmonizeStoryOutlineWithChat()  │  ← if chat mentions a structure but
└──────────────────────────────────┘    updates.story_outline is empty,
      │                                 parse outline from the chat text
      ▼
┌──────────────────────────────────┐
│ enrichShotUpdatesFromChat()      │  ← fill in missing shot fields (title,
└──────────────────────────────────┘    location, mood) by parsing them
      │                                 out of the chat narrative
      ▼
┌──────────────────────────────────┐
│ enforceSceneMutationPolicy()     │  ← the safety net — see below
└──────────────────────────────────┘
      │
      ▼
 applyUpdatesToProject()  ← actually mutates the Zustand store
      │
      ▼
 saveProject()             ← PUT /api/projects/:id
```

### 4.1 `extractStreamingChat()` — live rendering

While tokens are still streaming, the full text isn't valid JSON yet. This helper scans the partial string for the opening `"chat": "` and shows everything from there until either the closing `"` or the end of buffer. That's what produces the real-time typing animation in the chat panel — without ever showing the user the `"updates":{…}` JSON.

### 4.2 `parseAIResponse()` — tolerant JSON parse

In `src/services/prompt-builder.js`. Even though the system prompt says "no markdown fences", models do occasionally wrap the JSON in ```` ```json ```` blocks or emit trailing prose. This parser:
1. Strips fenced code block markers.
2. Finds the first `{` and the last `}` and slices between them.
3. `JSON.parse` the slice. On failure, returns `{ chat: '<raw text>', updates: {} }` so the reply still renders as a chat message, even if the mutations were lost.

### 4.3 `harmonizeStoryOutlineWithChat()` — recover missing structure

If the chat text clearly describes a structure ("Sequence 1 — Setup: Inciting Incident, Debate/Commitment…") but `updates.story_outline` is empty, this helper parses the outline out of the chat and fills it in. Catches the case where the model described the story in English but forgot to put it in JSON.

### 4.4 `enrichShotUpdatesFromChat()` — fill missing shot fields

Same idea for individual Shots. If `scenes_add` has a Shot with only a title, the helper scans the chat text for "Shot 1 — <title>: <location>. <visual>. Mood: <mood>." and fills in the missing fields. This keeps the storyboard-card UI populated even when the model only half-answered in JSON.

### 4.5 `enforceSceneMutationPolicy()` — the hard-rules gate

This is the key safety net. Called in `project-store.js:1766` (approximately) with the following options:

```js
enforceSceneMutationPolicy(storyboard, parsed.updates, {
  editSceneId: extractSceneEditId(apiContent),  // set if user was editing a Shot
  chatMode,                                      // 'plan' | 'lucky'
  userPrompt: apiContent,                        // original user text
});
```

What it actually does:

| Condition | Behavior |
|---|---|
| `editSceneId` is set (user was editing Shot X) | Force `scenes_update` to only touch that one Shot. Clear `scenes_add` and `scenes_remove`. If the model accidentally sent a new `scenes_add` instead of updating, convert it into a `scenes_update` against the edited Shot. |
| `chatMode === 'lucky'` (autonomous) | Let the model do whatever, but `dedupeSceneAdds()` still removes duplicates. |
| `chatMode === 'plan'` (guided) | **Clear** `scenes_update` and `scenes_remove` entirely (plan mode never rewrites existing shots). Run `enforceOrderedSceneAdds()` to re-point all adds at the next empty slot. Run `dedupeSceneAdds()` and `preventGlobalShotDuplicates()` to kill duplicates. |

**`enforceOrderedSceneAdds()`** is particularly strict: even if the model decided to put a new Shot in `SQ3.SC2`, this helper overrides the `act` and `sequence` fields on every addition to force them into the next empty slot in order. Rule 13 of the system prompt is re-checked in code. The only exception: if the user's prompt explicitly names a scene (e.g. "add to sequence 2 scene 1"), `resolvePromptSceneTarget()` picks up that intent and uses it as the target instead.

**`preventGlobalShotDuplicates()`** — if a pending Shot addition's title collides with an existing Shot (case-insensitive) anywhere on the board, it gets rewritten with a suffix so you don't end up with two Shots named "The Drowning" in different scenes. This is what prevents the model from producing recursive near-duplicates when you ask for several shots in a row.

### 4.6 `applyUpdatesToProject()` and ID generation

After enforcement, updates are applied:
- `scenes_add` → new Shot objects are given `id = scene_<8-hex>` (crypto-random; see `src/utils/storyboard-ops.js`).
- `scenes_update` → shallow-merge `changes` into the existing Shot matched by `sceneId`.
- `scenes_remove` → filter by `sceneId`.
- `characters_add` → if a character with the same slugified name already exists, merge instead of duplicate; otherwise insert with a slug id.
- `locations_add` → same slug-or-insert pattern.
- `story_outline` / `acts_update` / `sequences_add` / `sequences_update` → mutate the tree structure.

## 5. The title generator — small, cheap, locked

**Endpoint:** `POST /api/ai/title`
**Model:** hard-locked to `google/gemini-2.5-flash-lite` in `server/routes/ai.js`. The server **ignores any `provider` / `model` fields in the request body**. This is intentional so no client can accidentally opt the title call into the flagship planner.
**Prompt:** exactly two messages:

```jsonc
{
  "model": "google/gemini-2.5-flash-lite",
  "messages": [
    { "role": "system", "content":
      "Generate a concise, creative story title (2-5 words) based on this message. Return only the title — no quotes, no punctuation at the end, no explanation." },
    { "role": "user", "content": "<first user message verbatim>" }
  ]
}
```

Non-streaming. Returns plain text. Failure → `"Untitled Story"`. Logs `ai.title.start` / `ai.title.done` / `ai.title.upstream_error` with `requestId` for tracing.

Called only **once**, from `project-store.sendUserMessage()` the first time the user messages a new project, so the story's display name gets upgraded from "My First Story" to something meaningful. After that it never runs again for this project.

## 6. The image prompt — how Shots become images

**Entry point:** `buildSceneImagePrompt(scene, entities, storyboard)` in `src/services/scene-images.js`.
**NOT a static system prompt.** It's a prose paragraph assembled at call-time from the Shot's own data + the Sequence / Scene context + the continuity bible. Generated every time the user clicks "Generate image" on a Shot card (or when autogen runs after a planner turn).

Assembly steps:
1. **Resolve scene context.** Look up the Shot's Sequence title, Scene title, and adjacent Shots (previous/next) so the image model can smooth transitions.
2. **Match entities.** For each `characterIds` and `locationIds` on the Shot, pull their `visualPromptDescription` from the bible, up to `MAX_IMAGE_CHARACTERS` / `MAX_IMAGE_LOCATIONS`.
3. **Infer visual medium.** Same regex-based `inferVisualMedium()` used in the system prompt. Keeps the art style consistent.
4. **Build continuity notes.** A 1–3 sentence blurb telling the model to match the medium, preserve character/location design, and (if present) bridge from the previous Shot.
5. **Render via `renderSceneImagePrompt(input)`.** Emits a newline-delimited prose prompt like:

```
Create one cinematic storyboard frame that matches the established project continuity.
Medium: cinematic storyboard world with strong visual continuity
Emphasize framing, blocking, landmark geography, key props, and the main focal point.
Scene: A Father's Command
Story context: The Obedient Daughter -> Love, Madness & Betrayal
Setting: INT. POLONIUS'S CHAMBERS - EVENING, Dusk, candlelight
Continuity: Match the established cinematic storyboard world with strong visual continuity.
            Preserve character species/forms, silhouette, wardrobe logic, and environment
            design language from the rest of the storyboard. This beat follows "A Girl at
            the Edge of the Room".
Composition: Medium two-shot in a cramped, richly furnished chamber. Polonius stands
             frame left, a stout older man in heavy dark robes with a fur-trimmed collar…
Action: Polonius is lecturing; Ophelia sits on a low stool frame right with the
        surrendered letters in her lap; Laertes lingers in the doorway behind them…
Mood: tense, paternal, oppressive
Characters:
- Ophelia: Young noblewoman, pale, red-gold hair, pastel dresses, muted silhouette…
- Polonius: Older man, grey hair, heavy dark court robes with fur collar…
Location details:
- Stone walls, heavy oak desk with candelabra, ribbon-tied letters as key prop…
Style: cinematic composition, cohesive production design, storyboard-quality staging
```

Two rendering caps exist:
- **Full prompt** — sent first. Uses large field caps (visual 260 chars, action 220, etc.).
- **Compact prompt** — fallback if the full prompt fails (usually because the image model rejected the length). Tighter caps (visual 180, action 150), drops mood and location details.

The server proxy at `POST /api/ai/image` forwards the prompt to OpenRouter with:

```jsonc
{
  "model":       "google/gemini-2.5-flash-preview-image",
  "messages":    [{ "role": "user", "content": "<prompt above>" }],
  "modalities":  ["image", "text"],
  "image_config": { "aspect_ratio": "16:9" },
  "stream":      false
}
```

The image URL comes back in `choices[0].message.images[0].image_url.url`. The backend downloads it to the local workspace and stores a relative path on the Shot object. Image files never leave the user's machine after download.

**No system prompt is involved in image generation.** The multimodal model sees only the assembled prose. The planner's `SYSTEM_PROMPT_TEMPLATE` is irrelevant here. If you want to change the art direction, edit `renderSceneImagePromptWithCaps()` and `inferVisualMedium()`.

## 7. How the pieces talk to each other — concrete timeline

Here's exactly what happens when a user types "let's write the complete story of ophelia" into an empty project, in `lucky` (auto-generate) mode:

```
t=0      User hits Send.
t+1ms    ChatPanel.submit() → project-store.sendUserMessage(userText)
t+2ms    append userMessage to project.messages
t+5ms    buildApiMessages(project.messages, null) → [ oldUser, oldAssistant, newUser ]
t+6ms    buildSystemPrompt(storyboard={empty}, entities={empty}, chatMode='lucky')
           ├── TEMPLATE (static)
           ├── CURRENT STATE: "Structure: none yet / Shots: none yet / …"
           ├── INTERACTION MODE: lucky
           └── STORY ONBOARDING: yes (because empty)
t+10ms   POST /api/ai/chat  { provider: 'openrouter',
                              model:    <user's planning model>,
                              systemPrompt: ^^^  ,
                              messages: [...] }
t+10ms   Parallel: if this is the first user turn of a new project,
         POST /api/ai/title { userMessage } (title model hard-locked)
t+800ms  First SSE chunk arrives → extractStreamingChat populates the
         processing banner: "Drafting response..."
t+1.5s   Title call completes: "Ophelia's Watery Grave" → project renamed
t+…      Planner stream completes after N seconds
t+N      parseAIResponse → harmonizeStoryOutlineWithChat →
         enrichShotUpdatesFromChat → enforceSceneMutationPolicy →
         applyUpdatesToProject
t+N+5ms  saveProject() → PUT /api/projects/:id
t+N+50ms UI re-renders with: 3 Sequences, 8 Scene slots, first 4 Shots filled
t+N+50ms if auto-image-generation is on, for each new Shot:
           buildSceneImagePrompt → POST /api/ai/image → download → Shot.imagePath
```

## 8. Where to edit what — quick table

| If you want to change… | Edit this file | Function/constant |
|---|---|---|
| Assistant identity, core rules, schema | `src/prompts/system-prompt.js` | `SYSTEM_PROMPT_TEMPLATE` |
| Default skeleton (3 / 2-4-2) | `src/prompts/system-prompt.js` | Rule text inside `SYSTEM_PROMPT_TEMPLATE` |
| How current state is summarized | `src/prompts/system-prompt.js` | `stateBlock` assembly + `buildContinuityBlock()` |
| Auto-Generate vs Planning mode wording | `src/prompts/system-prompt.js` | `modeBlock` ternary |
| First-run onboarding flow | `src/prompts/system-prompt.js` | `bootstrapBlock` |
| Visual medium inference rules | `src/prompts/system-prompt.js` + `src/services/scene-images.js` | `inferVisualMedium()` (two copies — keep in sync) |
| JSON recovery from malformed model output | `src/services/prompt-builder.js` | `parseAIResponse()` |
| Rescue outline from chat text | `src/store/project-store.js` | `harmonizeStoryOutlineWithChat()` |
| Rescue shot fields from chat text | `src/store/project-store.js` | `enrichShotUpdatesFromChat()` |
| Hard rules (dedupe, order, mode limits) | `src/store/project-store.js` | `enforceSceneMutationPolicy()` + `enforceOrderedSceneAdds()` + `preventGlobalShotDuplicates()` |
| Title model (locked, cheap) | `server/routes/ai.js` | `TITLE_MODEL` constant at top |
| Title generator phrasing | `server/routes/ai.js` | `'system'` message inside `/api/ai/title` handler |
| Image prompt structure | `src/services/scene-images.js` | `renderSceneImagePromptWithCaps()` |
| Which model handles which call (planner/image) | Settings UI → Models | — |
| Providers exposed to the user | `src/config/providers.js` | `PROVIDERS` + `SUGGESTED_MODELS` |

## 9. Anti-patterns this architecture prevents

| Failure mode | Prevention mechanism |
|---|---|
| Model fabricates a new shot while "editing" an existing one | `enforceSceneMutationPolicy` converts stray `scenes_add` → `scenes_update` when `editSceneId` is set |
| Model tries to stack 5 shots in the same scene | Rule 17 in prompt + `enforceOrderedSceneAdds` forces them into the next empty slot instead |
| Model duplicates a shot title | `preventGlobalShotDuplicates` + `dedupeSceneAdds` |
| Model forgets a character's look between shots | `visualPromptDescription` anchors are re-injected into every state summary AND every image prompt |
| Model drifts visual style (suddenly live-action in a cartoon world) | `inferVisualMedium` pins the medium in the continuity bible on every turn |
| User's "edit this shot" intent gets lost in chat history | Hidden `[Edit shot scene_abc]` marker appended to the API message, read by `extractSceneEditId` |
| Model answers in prose instead of JSON | `parseAIResponse` recovers; `harmonize…` and `enrich…` helpers salvage structure from chat text |
| Model wraps JSON in markdown fences | `parseAIResponse` strips them |
| Plan mode user has their scenes silently rewritten | `enforceSceneMutationPolicy` hard-clears `scenes_update` + `scenes_remove` in plan mode |
| Title generator runs up a bill on Opus | Server hard-locks `TITLE_MODEL`; client override is ignored |

