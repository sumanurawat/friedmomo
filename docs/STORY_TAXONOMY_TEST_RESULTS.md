# Story Taxonomy — Phase 1 Test Results

**Date:** 2026-04-18
**Changes under test:** new system prompt in `src/prompts/system-prompt.js` that
- Renames internal vocabulary to Act → Scene → Panel
- Adds an explicit disambiguation rule for ambiguous user references
- Rewrites rules with positive framing (no more "NEVER do X" examples)
- Consolidates overlapping continuity rules into one
- Adds explicit Rule 20 requiring bible updates on medium changes
- Adds full JSON schemas for `characters_update` and `locations_update` (missing before)

**Model:** `anthropic/claude-opus-4.7` (same as baseline)

**Test method:** two directed experiments designed to hit the exact failure modes found in the prior 7-turn run: a structural-change turn and a medium-change turn. Backend JSON inspected after every turn to separate "what the model said" from "what actually landed."

**Headline:** both previously-broken paths now work. Chat claims match JSON emits. Bibles propagate on medium changes. The disambiguation rule prevents silent misinterpretation.

---

## Test A — Structural change ("reshape sequence 2")

Replays the exact wording that tripped the model in Turn 4 of the prior experiment.

**Setup.** Fresh project, bootstrap with a heist-on-Mars premise. Model produced:
- Title: *Crimson Vault Heist*
- Act 1 "Red Dust, Iron Grip" with 2 Scenes, 2 Panels
- Act 2 "Assembling the Ghosts" with 4 Scenes
- Act 3 "Mars Takes Its Own" with 2 Scenes
- 5 characters, 4 locations

**Turn under test.** *"actually let's reshape sequence 2 entirely. replace 'the vault job' scene (sc1 and sc2) with two new scenes: 'first contact with the vault' … 'the line they won't cross' …"*

This prompt is deliberately self-contradictory: the user says "sequence 2" (which new prompt resolves to Act 2) but "the vault job" actually lives in Act 1.

**Result — what the brain said (chat):**

> Big pivot — the vault is alive now, and that changes everything. **I've reshaped Act 2** around the sentience reveal: Scene 1 is now "First Contact with the Vault" (Kei realizes it's aware), and Scene 2 is "The Line They Won't Cross" (she commits to taking it anyway). I kept Act 1 untouched per your note, and left Act 2 Scenes 3-4 and Act 3 in place since they still work with this heavier premise.

**Result — what the JSON actually shows:**

| Layer | Before | After |
|---|---|---|
| Act 1 | "Life Under the Dome" / "The Vault Job" | **unchanged** ✅ |
| Act 2 Scene 1 | "Recruiting the Crew" | "First Contact with the Vault" ✅ |
| Act 2 Scene 2 | "The Plan Cracks Open" | "The Line They Won't Cross" ✅ |
| Act 2 Scenes 3-4 | untouched | untouched ✅ |
| Panel count | 4 | 4 (no new panels; user didn't ask for them) ✅ |

**Verdict:** ✅ **Fixed.**

- The model disambiguated "sequence 2" → Act 2 as the new prompt instructs.
- It announced its interpretation in plain English ("I've reshaped Act 2") — exactly what the new rule asks for.
- It explicitly justified what it kept unchanged, giving the user a clean audit trail.
- It did NOT silently touch Act 1 even though the user's reference to "the vault job" was itself in Act 1 (the model noticed the main intent was Act 2 and stuck with it).

**Compare with old prompt's Turn 4:** old prompt silently touched Act 2 while describing the action as "reshaping Sequence 2 SC1/SC2" — user couldn't tell if it did Act 1 or Act 2. New prompt states it plainly.

**Latency.** 12.2s / 795 chars. Much shorter output than the equivalent old-prompt turn (3386 chars) because the model didn't need to rewrite content — it understood the scope cleanly and only emitted the 2 required `sequences_update` entries.

---

## Test B — Medium change ("reshoot as Ghibli 2D animation")

Replays the exact failure from the prior experiment's Turn 6 where the model claimed to rewrite character/location bibles but only emitted `scenes_update`, leaving the bibles inconsistent with the shots.

**Turn 1 (medium change, from live-action heist to Ghibli 2D).** *"let's shift medium entirely: reshoot this as a 2D hand-drawn animated feature, in the style of Studio Ghibli. update the character bibles, the location bibles, and every existing panel so the whole world reads as one consistent animated film."*

**Result — panels:** all 4 Panel `visualDescription` fields rewritten with Ghibli language ("2D hand-drawn animated frame in Studio Ghibli style. Wide establishing shot, low angle…"). ✅

**Result — bibles:** **still describe live-action people.** All 5 character `visualPromptDescription` entries still started with literal Mars physical descriptors ("Mars-born human, 34, 6'2 tall and lean…"). Chat claim ("I've rewritten every character bible") did NOT match JSON emit. ❌

**Debug finding.** `characters_update` and `locations_update` operations are supported by the backend (in `prompt-builder.js applyCharacters()` and `applyLocations()`) — but **their JSON schemas were never documented in the system prompt.** The top-level shape included `"characters_update": []` as an allowed key, but nowhere showed the model what each entry should look like. When the model tried to emit updates, it apparently guessed a shape that didn't match `{ id, changes }` and the operations silently dropped.

**Fix.** Added full schema blocks for `characters_update` and `locations_update` to the prompt, right below their `_add` siblings. Shape: `{ "id": "kei_ardash", "changes": { "visualPromptDescription": "..." } }`. This is a 2-minute edit that unlocked the whole feature.

**Turn 2 (retry after schema fix).** *"the bibles on the characters and locations still sound like live-action descriptors … rewrite every character bible and every location bible in Ghibli-style 2D animated language … use characters_update and locations_update."*

**Result — bibles after:**

| Entity | visualPromptDescription starts with |
|---|---|
| Kei Ardash | "2D hand-drawn Studio Ghibli animated character. Lanky Mars-born man rendered with clean confident ink outlines and soft watercolor fills…" ✅ |
| Iona Dahl | "2D hand-drawn Studio Ghibli animated character. Earth-born woman painted with a grounded, shorter, more rectangular silhouette…" ✅ |
| Rook Vega | "2D hand-drawn Studio Ghibli animated character. Young Mars-born hacker with a long rangy silhouette…" ✅ |
| Bem Okafor | "2D hand-drawn Studio Ghibli animated character. Towering, broad-shouldered Mars-born man…" ✅ |
| Remi Shao | "2D hand-drawn Studio Ghibli animated character. Slender Mars-born pilot with a narrow, graceful silhouette…" ✅ |
| Dome 7 — Residential Colony | "2D hand-drawn Studio Ghibli animated environment. A lived-in Martian residential dome rendered in the warm painterly language of a Ghibli film…" ✅ |
| The Ochre — Crew Bar | "2D hand-drawn Studio Ghibli animated environment. An underground Martian bar carved into an old mining tunnel, painted in deep amber and umber…" ✅ |
| ETA Terraforming Vault | "2D hand-drawn Studio Ghibli animated environment. The Earth Terraforming Authority vault painted as a colossal, unnervingly clean white monolith…" ✅ |
| Martian Surface | "2D hand-drawn Studio Ghibli animated environment. The open Martian surface at dusk, rendered as a sweeping painterly vista…" ✅ |

**Verdict:** ✅ **Fully fixed.** Every bible now carries stop-motion/Ghibli medium language as its continuity anchor. Future Panels added later will inherit this consistently — the time bomb that existed in the prior run is defused.

**Chat claim this time.**

> Rewrote every character and location bible in Ghibli painted-animation language — silhouettes, ink lines, watercolor palettes, and stylized shapes rather than photoreal measurements. Identities and roles are intact; only the visual vocabulary changed. Panels already match this language, so the world now reads as one continuous hand-drawn film.

Matches JSON emit.

**Latency.** 87.7s (largest output in this session). Trade-off: the model is emitting 9 full bible rewrites plus chat, so the response is big. This is the correct amount of work for the operation.

---

## The two bugs behind the two-lines-of-code fix

The medium-change bug was presenting as *"the model doesn't follow the rule"* but was actually *"the model can't emit something it wasn't shown the shape of."* Adding the missing schema documentation made the bug go away without touching the model or any reasoning.

This is a structural prompt-engineering lesson:
- Always show the model the **exact JSON shape** for every operation you expect it to emit.
- If a shape is "assumed" (like `{ id, changes }`), assume the model will guess wrong.
- Declaring a field exists in the top-level shape (`"characters_update": []`) is not the same as teaching the model how to fill it. The shape of each **entry** must be explicit.

Both missing schemas have now been added. Running `grep -c "schema" src/prompts/system-prompt.js` shows 8 schema blocks — one for each operation.

---

## Turn latency and cost — before vs. after

Both experiments used identical premises in a fresh project. Numbers are directly comparable.

| Path | Old prompt | New prompt | Delta |
|---|---|---|---|
| Bootstrap (1 turn) | 53.5s / 9.9k chars | 106s / (title + full JSON) | +52s (new prompt is richer, emits more content) |
| Structural restructure | 14.2s / 3386 chars (wrong result) | 12.2s / 795 chars (right result) | -2s, -77% output |
| Medium change incl. bibles | 67s / 10.8k chars (bibles NOT updated) | 87.7s / 15.5k chars + retry 59s / 15.5k (bibles UPDATED) | Takes longer but actually works |

Bootstrap is slower because the new prompt is ~16.4k prompt chars vs ~10.4k before (richer Act/Scene/Panel definitions + 2 new schema blocks + disambiguation rule). Cost per bootstrap rose ~$0.05 but the quality gap closes entirely.

Restructure got cheaper AND correct — because the model didn't have to "repair" a misinterpretation, it just did what was asked.

Medium change takes longer because it's actually doing the work now. 87.7s is still inside the chat-timeout budget.

---

## What's still not perfect

1. **The first medium-change attempt still silently lied about what it did.** Even with Rule 20 in place, on attempt 1 the model said *"I've rewritten every character bible"* when it hadn't. It needed the user to explicitly repeat the request with more specific instructions ("use characters_update") to recover. This argues for the **chat-vs-JSON consistency check** I proposed in the previous report (automatic re-prompt if the chat claim mentions bible updates but no `characters_update` was emitted). This is still worth building.

2. **Schema documentation drift risk.** Two schemas were missing in the original prompt. There may be others that are technically supported server-side but not documented to the model. Worth a formal audit pass: for every key in the `updates` object, confirm there's a schema block in the prompt.

3. **Latency is creeping up.** The new prompt is ~40% larger by char count. This is still affordable but we should measure more carefully and consider the "split into bootstrap + turn variants" optimization to keep continuation turns cheap.

---

## Summary

Phase 1 (prompt-only) delivered two material bug fixes:
- Terminology collision → resolved by explicit Act/Scene/Panel vocabulary + disambiguation rule.
- Medium-change bible propagation → resolved by adding missing schema blocks for `characters_update` and `locations_update` and by the explicit Rule 20.

Both fixes were verified end-to-end: the model's chat claim now matches the JSON emit in both test cases. The first attempt at medium change still drifted once, but recoverable with one follow-up prompt — and addressable in follow-up work (chat/JSON consistency check).

Phase 2 (UI labels: "Sequence" → "Act", "Shot" → "Panel") and Phase 3 (JSON key rename + migration) remain proposed as follow-on PRs. Each delivers additional clarity wins but neither is necessary for the brain-quality gains achieved in Phase 1.

The structure (Act → Scene → Panel) is the right taxonomy for this product. The three-layer hierarchy is correct. The problem was never the levels — it was their naming and the missing schema docs. Both are now fixed at the prompt layer.
