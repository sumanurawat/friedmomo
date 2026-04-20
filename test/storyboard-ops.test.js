import test from 'node:test';
import assert from 'node:assert/strict';

import { moveActInPlace, moveSceneInPlace } from '../src/utils/storyboard-ops.js';

function buildActs() {
  return [
    { number: 1, title: 'A1', sequences: [] },
    { number: 2, title: 'A2', sequences: [] },
    { number: 3, title: 'A3', sequences: [] },
  ];
}

function buildStoryboard() {
  return {
    acts: [
      {
        number: 1,
        sequences: [
          {
            number: 1,
            scenes: [
              { id: 's1', title: 'Shot 1' },
              { id: 's2', title: 'Shot 2' },
              { id: 's3', title: 'Shot 3' },
            ],
          },
        ],
      },
      {
        number: 2,
        sequences: [
          {
            number: 1,
            scenes: [{ id: 's4', title: 'Shot 4' }],
          },
        ],
      },
      {
        number: 3,
        sequences: [
          {
            number: 1,
            scenes: [{ id: 's5', title: 'Shot 5' }],
          },
        ],
      },
    ],
  };
}

test('moveActInPlace supports adjacent and long jumps', () => {
  const acts = buildActs();

  const swapped = moveActInPlace(acts, {
    sourceActNumber: 1,
    targetActNumber: 2,
    placeAfter: false,
  });
  assert.equal(swapped, true);
  assert.deepEqual(
    acts.map((act) => act.number),
    [2, 1, 3]
  );

  const longJump = moveActInPlace(acts, {
    sourceActNumber: 3,
    targetActNumber: 2,
    placeAfter: false,
  });
  assert.equal(longJump, true);
  assert.deepEqual(
    acts.map((act) => act.number),
    [3, 2, 1]
  );

  const toEnd = moveActInPlace(acts, {
    sourceActNumber: 3,
    toEnd: true,
  });
  assert.equal(toEnd, true);
  assert.deepEqual(
    acts.map((act) => act.number),
    [2, 1, 3]
  );
});

test('moveSceneInPlace supports forward/backward and cross-act moves', () => {
  const storyboard = buildStoryboard();

  const forward = moveSceneInPlace(storyboard, {
    sceneId: 's1',
    targetActNumber: 1,
    targetSequenceNumber: 1,
    targetIndex: 3,
  });
  assert.equal(forward, true);
  assert.deepEqual(
    storyboard.acts[0].sequences[0].scenes.map((scene) => scene.id),
    ['s2', 's3', 's1']
  );

  const backwardCross = moveSceneInPlace(storyboard, {
    sceneId: 's5',
    targetActNumber: 1,
    targetSequenceNumber: 1,
    targetIndex: 0,
  });
  assert.equal(backwardCross, true);
  assert.deepEqual(
    storyboard.acts[0].sequences[0].scenes.map((scene) => scene.id),
    ['s5', 's2', 's3', 's1']
  );
  assert.deepEqual(
    storyboard.acts[2].sequences[0].scenes.map((scene) => scene.id),
    []
  );

  const intoOtherAct = moveSceneInPlace(storyboard, {
    sceneId: 's2',
    targetActNumber: 2,
    targetSequenceNumber: 1,
    targetIndex: 1,
  });
  assert.equal(intoOtherAct, true);
  assert.deepEqual(
    storyboard.acts[1].sequences[0].scenes.map((scene) => scene.id),
    ['s4', 's2']
  );
});

test('moveSceneInPlace returns false for invalid payloads', () => {
  const storyboard = buildStoryboard();
  const before = structuredClone(storyboard);

  const result = moveSceneInPlace(storyboard, {
    sceneId: 'missing',
    targetActNumber: 1,
    targetSequenceNumber: 1,
    targetIndex: 0,
  });

  assert.equal(result, false);
  assert.deepEqual(storyboard, before);
});
