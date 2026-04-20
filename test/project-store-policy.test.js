import test from 'node:test';
import assert from 'node:assert/strict';

import { __projectStoreTestUtils } from '../src/store/project-store.js';

const {
  enforceSceneMutationPolicy,
  getNextSceneGenerationTarget,
  extractRequestedShotCount,
  resolvePromptSceneTarget,
  harmonizeStoryOutlineWithChat,
  parseStoryOutlineFromChat,
  parseShotSpecFromChat,
  enrichShotUpdatesFromChat,
} = __projectStoreTestUtils;

function buildStoryboard() {
  return {
    acts: [
      {
        number: 1,
        title: 'Setup',
        sequences: [
          {
            number: 1,
            title: 'Scene 1',
            scenes: [{ id: 'a1s1_1', title: 'Opening' }],
          },
          {
            number: 2,
            title: 'Scene 2',
            scenes: [],
          },
        ],
      },
      {
        number: 2,
        title: 'Confrontation',
        sequences: [
          {
            number: 1,
            title: 'Scene 1',
            scenes: [],
          },
        ],
      },
    ],
  };
}

test('getNextSceneGenerationTarget picks first missing scene in order', () => {
  const target = getNextSceneGenerationTarget(buildStoryboard());
  assert.deepEqual(target, { actNumber: 1, sequenceNumber: 2 });
});

test('extractRequestedShotCount defaults to one without explicit count', () => {
  assert.equal(extractRequestedShotCount('continue the story'), 1);
  assert.equal(extractRequestedShotCount('add 4 shots here'), 4);
  assert.equal(extractRequestedShotCount('generate 12 shots now'), 5);
});

test('resolvePromptSceneTarget respects focused scene context', () => {
  const storyboard = buildStoryboard();
  const target = resolvePromptSceneTarget(
    storyboard,
    '[FOCUS_SCENE] Sequence 2, Scene 1: Escalation'
  );
  assert.deepEqual(target, { actNumber: 2, sequenceNumber: 1 });
});

test('non-edit mutation policy enforces strict next-scene target and one-shot default', () => {
  const storyboard = buildStoryboard();
  const updates = {
    scenes_add: [
      { act: 2, sequence: 1, title: 'Wrong target 1' },
      { act: 2, sequence: 1, title: 'Wrong target 2' },
    ],
    scenes_update: [{ sceneId: 'a1s1_1', changes: { title: 'Mutate existing' } }],
    scenes_remove: ['a1s1_1'],
  };

  const result = enforceSceneMutationPolicy(storyboard, updates, {
    userPrompt: 'keep going',
  });

  assert.equal(result.scenes_add.length, 1);
  assert.equal(result.scenes_add[0].act, 1);
  assert.equal(result.scenes_add[0].sequence, 2);
  assert.deepEqual(result.scenes_update, []);
  assert.deepEqual(result.scenes_remove, []);
});

test('explicit generation target and count are respected', () => {
  const storyboard = buildStoryboard();
  const updates = {
    scenes_add: [
      { act: 1, sequence: 1, title: 'A' },
      { act: 1, sequence: 1, title: 'B' },
      { act: 1, sequence: 1, title: 'C' },
      { act: 1, sequence: 1, title: 'D' },
    ],
  };

  const result = enforceSceneMutationPolicy(storyboard, updates, {
    userPrompt: 'Generate 3 shots for Sequence 2, Scene 1.',
  });

  assert.equal(result.scenes_add.length, 3);
  assert.deepEqual(
    result.scenes_add.map((item) => [item.act, item.sequence]),
    [
      [2, 1],
      [2, 1],
      [2, 1],
    ]
  );
});

test('edit context never creates new scenes and falls back to update from add payload', () => {
  const storyboard = buildStoryboard();
  const updates = {
    scenes_add: [
      {
        act: 1,
        sequence: 1,
        title: 'Opening (edited)',
        storyFunction: 'Refined beat',
      },
    ],
  };

  const result = enforceSceneMutationPolicy(storyboard, updates, {
    editSceneId: 'a1s1_1',
    userPrompt: 'Edit shot context ID: a1s1_1',
  });

  assert.deepEqual(result.scenes_add, []);
  assert.deepEqual(result.scenes_remove, []);
  assert.equal(result.scenes_update.length, 1);
  assert.equal(result.scenes_update[0].sceneId, 'a1s1_1');
  assert.equal(result.scenes_update[0].changes.title, 'Opening (edited)');
});

test('non-edit policy rewrites duplicate shot from previous scene into unique target-scene beat', () => {
  const storyboard = {
    acts: [
      {
        number: 1,
        title: 'Setup',
        sequences: [
          {
            number: 1,
            title: "Adele's Lament",
            scenes: [
              {
                id: 'shot_1',
                title: 'Opening Performance',
                location: 'INT. THE VELVET LOUNGE - NIGHT',
                time: 'Late evening',
                action: 'Adele sings with sorrow',
                visualDescription: 'Close-up on Adele under warm spotlight',
                storyFunction: "Establish Adele's emotional state",
              },
            ],
          },
          {
            number: 2,
            title: 'Fleeting Memories',
            scenes: [],
          },
        ],
      },
    ],
  };

  const updates = {
    scenes_add: [
      {
        act: 1,
        sequence: 1,
        title: 'Opening Performance',
        location: 'INT. THE VELVET LOUNGE - NIGHT',
        time: 'Late evening',
        action: 'Adele sings with sorrow',
        visualDescription: 'Close-up on Adele under warm spotlight',
        storyFunction: "Establish Adele's emotional state",
      },
    ],
  };

  const result = enforceSceneMutationPolicy(storyboard, updates, { userPrompt: 'next shot' });
  assert.equal(result.scenes_add.length, 1);
  assert.equal(result.scenes_add[0].act, 1);
  assert.equal(result.scenes_add[0].sequence, 2);
  assert.notEqual(result.scenes_add[0].title, 'Opening Performance');
  assert.match(String(result.scenes_add[0].title || ''), /Fleeting Memories/i);
});

test('parseStoryOutlineFromChat parses sequence/scene outline from assistant text', () => {
  const chat = [
    "Here's the initial structure:",
    "Sequence 1: Adele's Performance",
    'Scene 1: The Empty Stage',
    'Scene 2: A Glimmer of the Past',
    'Sequence 2: Lingering Regret',
    'Scene 1: A Shared Moment',
    'Scene 2: An Unexpected Offer',
    'Sequence 3: Moving On?',
    'Scene 1: A New Beginning',
    "Scene 2: The Ex's Sorrow",
  ].join('\n');

  const parsed = parseStoryOutlineFromChat(chat);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].title, "Adele's Performance");
  assert.equal(parsed[0].sequences.length, 2);
  assert.equal(parsed[1].title, 'Lingering Regret');
  assert.equal(parsed[2].sequences[1].title, "The Ex's Sorrow");
});

test('harmonizeStoryOutlineWithChat upgrades collapsed single-outline act', () => {
  const chat = [
    "Sequence 1: Adele's Performance",
    'Scene 1: The Empty Stage',
    'Scene 2: A Glimmer of the Past',
    'Sequence 2: Lingering Regret',
    'Scene 1: A Shared Moment',
    'Scene 2: An Unexpected Offer',
    'Sequence 3: Moving On?',
    'Scene 1: A New Beginning',
    "Scene 2: The Ex's Sorrow",
  ].join('\n');

  const parsed = {
    chat,
    updates: {
      story_outline: {
        acts: [
          {
            act: 1,
            title: 'Setup',
            sequences: [{ title: "Adele's Performance" }, { title: 'Lingering Regret' }],
          },
        ],
      },
    },
  };

  const result = harmonizeStoryOutlineWithChat(parsed, 'create three sequences for this story');
  const acts = result.updates.story_outline.acts;
  assert.equal(acts.length, 3);
  assert.equal(acts[0].sequences.length, 2);
  assert.equal(acts[1].title, 'Lingering Regret');
  assert.equal(acts[2].sequences[0].title, 'A New Beginning');
});

test('harmonizeStoryOutlineWithChat prefers structured chat outline over JSON mismatch', () => {
  const chat = [
    '**Sequence 1: Performance**',
    '- Scene 1: Empty Stage',
    '- Scene 2: Glimmer of the Past',
    '**Sequence 2: Regret**',
    '- Scene 1: Shared Moment',
    '- Scene 2: Unexpected Offer',
    '**Sequence 3: Moving On**',
    '- Scene 1: New Beginning',
    '- Scene 2: Ex Sorrow',
  ].join('\n');

  const parsed = {
    chat,
    updates: {
      story_outline: {
        acts: [
          {
            act: 1,
            title: 'Setup',
            sequences: [{ title: 'Performance' }, { title: 'Regret' }, { title: 'Resolution' }],
          },
        ],
      },
    },
  };

  const result = harmonizeStoryOutlineWithChat(parsed, '');
  const acts = result.updates.story_outline.acts;
  assert.equal(acts.length, 3);
  assert.equal(acts[0].title, 'Performance');
  assert.equal(acts[1].title, 'Regret');
  assert.equal(acts[2].sequences.length, 2);
});

test('parseShotSpecFromChat extracts detailed shot fields from assistant prose', () => {
  const chat = [
    "Here's the next shot: SC1.SC2 A Glimpse of the Past.",
    '',
    'Shot 1: The Lingering Note',
    '- Location: INT. THE VELVET LOUNGE - NIGHT',
    "- Time: Late evening, during Adele's performance.",
    "- Visual Description: Close on Adele's face in warm light.",
    '- Action: Adele holds a long, mournful note.',
    '- Dialogue: (Singing) "Send my love..."',
    '- Mood: Melancholy and nostalgic.',
    '- Story Function: Establish sadness and memory bleed.',
    '- Characters: Adele (adele)',
    '- Locations: The Velvet Lounge (the_velvet_lounge)',
  ].join('\n');

  const shot = parseShotSpecFromChat(chat, {
    characters: [{ id: 'adele', name: 'Adele' }],
    locations: [{ id: 'the_velvet_lounge', name: 'The Velvet Lounge' }],
  });

  assert.ok(shot);
  assert.equal(shot.actNumber, 1);
  assert.equal(shot.sequenceNumber, 2);
  assert.equal(shot.title, 'The Lingering Note');
  assert.equal(shot.location, 'INT. THE VELVET LOUNGE - NIGHT');
  assert.match(shot.visualDescription, /Close on Adele/i);
  assert.equal(shot.characterIds[0], 'adele');
  assert.equal(shot.locationIds[0], 'the_velvet_lounge');
});

test('enrichShotUpdatesFromChat injects prose shot details into sparse scenes_add', () => {
  const parsed = {
    chat: [
      "Here's the next shot: SC1.SC2 A Glimpse of the Past.",
      'Shot 1: The Lingering Note',
      '- Location: INT. THE VELVET LOUNGE - NIGHT',
      "- Visual Description: Close on Adele's face in warm light.",
      '- Action: Adele holds a long, mournful note.',
      '- Story Function: Establish sadness and memory bleed.',
      '- Characters: Adele (adele)',
    ].join('\n'),
    updates: {
      scenes_add: [
        {
          act: 1,
          sequence: 2,
          title: 'A Glimpse of the Past',
        },
      ],
    },
  };

  const storyboard = {
    acts: [
      { number: 1, sequences: [{ number: 1, scenes: [] }, { number: 2, scenes: [] }] },
    ],
  };

  const result = enrichShotUpdatesFromChat(parsed, storyboard, {
    characters: [{ id: 'adele', name: 'Adele' }],
    locations: [],
  });

  const enriched = result.updates.scenes_add[0];
  assert.equal(enriched.title, 'The Lingering Note');
  assert.equal(enriched.location, 'INT. THE VELVET LOUNGE - NIGHT');
  assert.match(String(enriched.visualDescription || ''), /Close on Adele/i);
  assert.match(String(enriched.action || ''), /mournful note/i);
  assert.match(String(enriched.storyFunction || ''), /memory bleed/i);
  assert.deepEqual(enriched.characterIds, ['adele']);
});
