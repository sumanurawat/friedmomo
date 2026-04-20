import test from 'node:test';
import assert from 'node:assert/strict';

import { applyUpdates, parseAIResponse } from '../src/services/prompt-builder.js';
import { buildStoryboardPdfHtml } from '../src/services/pdf-export.js';
import { buildSystemPrompt } from '../src/prompts/system-prompt.js';

function buildProject() {
  return {
    id: 'proj_1',
    name: 'My Story',
    updatedAt: new Date().toISOString(),
    messages: [],
    entities: {
      characters: [
        {
          id: 'maya',
          name: 'Maya',
          description: 'Restless protagonist',
          visualPromptDescription: 'Young woman with a red raincoat, dark bob haircut, and observant eyes.',
          role: 'Lead',
        },
      ],
      locations: [
        {
          id: 'station',
          name: 'Train Station',
          description: 'Open-air station platform',
          visualPromptDescription: 'Steel canopy, rainy platform lights, and long wet reflections.',
          mood: 'restless',
        },
      ],
    },
    storyboard: {
      acts: [
        {
          number: 1,
          title: 'Setup',
          sequences: [
            {
              number: 1,
              title: 'Inciting',
              scenes: [
                {
                  id: 's1',
                  sceneNumber: '1.1.1',
                  title: 'Opening',
                  location: 'INT. ROOM',
                  time: 'Night',
                  visualDescription: 'A dim room.',
                  action: 'Maya waits.',
                  dialogue: [],
                  mood: 'Tense',
                  storyFunction: 'Introduce the lead.',
                  characterIds: ['maya'],
                  locationIds: ['station'],
                  imageUrl: null,
                  imagePrompt: '',
                  imagePromptHash: '',
                  imageStatus: 'idle',
                  imageError: '',
                  imageUpdatedAt: null,
                },
              ],
            },
          ],
        },
      ],
      storyBeats: {},
    },
  };
}

test('applyUpdates does not overwrite existing shot when scenes_add repeats existing title', () => {
  const project = buildProject();

  const next = applyUpdates(project, {
    scenes_add: [
      {
        act: 1,
        sequence: 1,
        title: 'Opening',
        storyFunction: 'This should not overwrite.',
      },
    ],
  });

  const shots = next.storyboard.acts[0].sequences[0].scenes;
  assert.equal(shots.length, 1);
  assert.equal(shots[0].storyFunction, 'Introduce the lead.');
});

test('applyUpdates allows same title only when content differs and auto-renames title', () => {
  const project = buildProject();

  const next = applyUpdates(project, {
    scenes_add: [
      {
        act: 1,
        sequence: 1,
        title: 'Opening',
        location: 'INT. STAGE',
        time: 'Night',
        visualDescription: 'A bright spotlight.',
        action: 'Maya starts to sing.',
        storyFunction: 'Escalate performance pressure.',
      },
    ],
  });

  const shots = next.storyboard.acts[0].sequences[0].scenes;
  assert.equal(shots.length, 2);
  assert.equal(shots[0].title, 'Opening');
  assert.equal(shots[1].title, 'Opening (2)');
  assert.equal(shots[1].storyFunction, 'Escalate performance pressure.');
});

test('applyUpdates fills safe context defaults for sparse scenes_add payloads', () => {
  const project = buildProject();
  const next = applyUpdates(project, {
    scenes_add: [
      {
        act: 1,
        sequence: 1,
        title: 'Sparse Shot',
      },
    ],
  });

  const added = next.storyboard.acts[0].sequences[0].scenes.find((scene) => scene.title === 'Sparse Shot');
  assert.ok(added);
  assert.ok(String(added.storyFunction || '').trim().length > 0);
  assert.ok(String(added.visualDescription || '').trim().length > 0);
  assert.ok(String(added.action || '').trim().length > 0);
});

test('applyUpdates ignores empty string scene updates so context is not wiped', () => {
  const project = buildProject();

  const next = applyUpdates(project, {
    scenes_update: [
      {
        sceneId: 's1',
        changes: {
          title: '',
          storyFunction: '   ',
          visualDescription: '',
        },
      },
    ],
  });

  const shot = next.storyboard.acts[0].sequences[0].scenes[0];
  assert.equal(shot.title, 'Opening');
  assert.equal(shot.storyFunction, 'Introduce the lead.');
  assert.equal(shot.visualDescription, 'A dim room.');
});

test('buildStoryboardPdfHtml includes storyboard content safely', () => {
  const project = buildProject();
  const html = buildStoryboardPdfHtml(project);

  assert.match(html, /My Story/);
  assert.match(html, /Opening/);
  assert.match(html, /SQ1 \/ SC1/);
  assert.match(html, /Maya/);
  assert.doesNotMatch(html, /<script>alert\(/);
});

test('parseAIResponse extracts chat and updates from clipped structured output', () => {
  const raw = `": "A brilliant crossover idea.", "updates": {"story_outline":{"acts":[{"act":1,"title":"SETUP","sequences":[{"title":"The Flight and the Fall"}]}]},"scenes_add":[{"act":1,"sequence":1,"title":"The Descent"}]}}`;

  const parsed = parseAIResponse(raw);

  assert.equal(parsed.chat, 'A brilliant crossover idea.');
  assert.equal(parsed.updates.story_outline.acts[0].title, 'SETUP');
  assert.equal(parsed.updates.scenes_add[0].title, 'The Descent');
});

test('parseAIResponse does not leak raw structured payload as visible chat fallback', () => {
  const raw = `"updates": {"scenes_add":[{"act":1,"sequence":1,"title":"Opening"}]}`;

  const parsed = parseAIResponse(raw);

  assert.equal(parsed.chat, 'Updated storyboard.');
  assert.equal(parsed.updates.scenes_add[0].title, 'Opening');
});

test('buildSystemPrompt includes continuity bible anchors and rich entity visuals', () => {
  const project = buildProject();
  const prompt = buildSystemPrompt(project.storyboard, project.entities, 'lucky');

  assert.match(prompt, /Continuity bible:/);
  assert.match(prompt, /Established visual medium\/style:/);
  assert.match(prompt, /Maya \(maya\) — Lead/);
  assert.match(prompt, /look: Young woman with a red raincoat/);
  assert.match(prompt, /Train Station \(station\)/);
  assert.match(prompt, /frame: A dim room\./);
});
