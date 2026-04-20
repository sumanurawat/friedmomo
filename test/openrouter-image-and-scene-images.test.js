import test from 'node:test';
import assert from 'node:assert/strict';

import { FIXED_IMAGE_MODEL } from '../src/config/models.js';
import { regenerateSceneImages, __sceneImagesTestUtils } from '../src/services/scene-images.js';

function buildProject() {
  return {
    id: 'proj_test',
    updatedAt: new Date().toISOString(),
    entities: {
      characters: [
        {
          id: 'snow_white',
          name: 'Snow White',
          description: 'Princess protagonist',
          visualPromptDescription:
            'Pale young woman with dark bobbed hair, torn blue and yellow dress, determined expression, windblown sleeves.',
        },
        {
          id: 'queen_of_mirrors',
          name: 'Queen of Mirrors',
          description: 'Antagonist',
          visualPromptDescription:
            'Regal sorceress in an angular black crown and sharp violet robes, carrying a warped mirror.',
        },
        {
          id: 'hatter_doc',
          name: 'Hatter-Doc',
          description: 'Wonderland dwarf mentor',
          visualPromptDescription:
            'Short bearded dwarf in a stitched top hat, tea-stained coat, and tiny teacups braided into his beard.',
        },
      ],
      locations: [
        {
          id: 'rabbit_hole',
          name: 'Rabbit Hole',
          description: 'Surreal tunnel',
          visualPromptDescription:
            'Vortex of roots, floating mirrors, red apples, pocket watches, and checkerboard splinters in black space.',
        },
      ],
    },
    storyboard: {
      acts: [
        {
          number: 1,
          title: 'SETUP',
          sequences: [
            {
              number: 1,
              title: 'The Flight and the Fall',
              scenes: [
                {
                  id: 'scene_1',
                  sceneNumber: '1.1.1',
                  title: 'The Long Fall',
                  location: 'INT. RABBIT HOLE - DAY',
                  time: 'Timeless',
                  visualDescription:
                    'Snow White tumbles backward through a swirling vortex of roots, mirrors, apples, watches, checkerboards, glowing spores, and impossible gravity while the Queen of Mirrors watches from a shattered reflection high above her.',
                  action:
                    'She claws toward a floating clock face and twists in zero gravity as pages, cards, and tiny teacups whip past her face.',
                  dialogue: [
                    { character: 'Snow White', line: 'Help! What kind of magic is this?!' },
                  ],
                  mood: 'Psychedelic, dizzying, dark fantasy',
                  storyFunction:
                    'Establish the crossover and make the plunge feel like a violent entry into Wonderland nonsense.',
                  characterIds: ['snow_white', 'queen_of_mirrors', 'hatter_doc'],
                  locationIds: ['rabbit_hole'],
                  imageUrl: null,
                  imagePrompt: '',
                  imagePromptHash: '',
                  imageStatus: 'idle',
                  imageError: '',
                  imageUpdatedAt: null,
                  imageProvider: '',
                  imageModelResolved: '',
                  imageAttemptedAt: null,
                  imageLatencyMs: null,
                  imageDiagnosticCode: '',
                  imageDiagnosticMessage: '',
                  imagePromptPreview: '',
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function buildProjectWithSceneCount(count) {
  const project = buildProject();
  const sequence = project.storyboard.acts[0].sequences[0];
  const baseScene = sequence.scenes[0];
  sequence.scenes = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(baseScene),
    id: `scene_${index + 1}`,
    sceneNumber: `1.1.${index + 1}`,
    title: `Shot ${index + 1}`,
    visualDescription: `${baseScene.visualDescription} Variant ${index + 1}.`,
    action: `${baseScene.action} Variant ${index + 1}.`,
    imageUrl: null,
    imagePrompt: '',
    imagePromptHash: '',
    imageStatus: 'idle',
    imageError: '',
    imageUpdatedAt: null,
    imageProvider: '',
    imageModelResolved: '',
    imageAttemptedAt: null,
    imageLatencyMs: null,
    imageDiagnosticCode: '',
    imageDiagnosticMessage: '',
    imagePromptPreview: '',
  }));
  return project;
}

test('buildSceneImagePrompt compacts long storyboard scenes into image-native prompts', () => {
  const project = buildProject();
  const scene = project.storyboard.acts[0].sequences[0].scenes[0];
  const prompt = __sceneImagesTestUtils.buildSceneImagePrompt(scene, project.entities, project.storyboard);

  assert.ok(prompt.length <= 900, `expected compact prompt <= 900 chars, got ${prompt.length}`);
  assert.match(prompt, /Create one cinematic storyboard frame that matches the established project continuity/i);
  assert.match(prompt, /Scene: The Long Fall/);
  assert.match(prompt, /Continuity:/);
  assert.match(prompt, /Characters:/);
  assert.match(prompt, /Snow White/);
  assert.doesNotMatch(prompt, /live-action pre-production/i);
  assert.doesNotMatch(prompt, /Help! What kind of magic is this/i);
  assert.doesNotMatch(prompt, /Establish the crossover/i);
  assert.equal((prompt.match(/^- /gm) || []).length <= 3, true);
});

test('buildSceneImagePrompt respects animated project medium and continuity anchors', () => {
  const project = buildProject();
  const scene = project.storyboard.acts[0].sequences[0].scenes[0];
  project.storyboard.acts[0].title = 'Animated Meadow Race';
  project.storyboard.acts[0].sequences[0].title = 'Sunny Cartoon Chase';
  scene.visualDescription =
    'A sleek animated hare and a steady animated tortoise burst through rolling candy-green hills under a bright toy-like sky.';
  scene.action =
    'The hare launches forward in exaggerated animation arcs while the tortoise plants himself with calm cartoon determination.';

  const prompt = __sceneImagesTestUtils.buildSceneImagePrompt(scene, project.entities, project.storyboard);

  assert.match(prompt, /stylized 3D animated storyboard frame|stylized 2D animated storyboard frame|animated storyboard frame/i);
  assert.match(prompt, /Match the established .*animated storyboard frame/i);
  assert.doesNotMatch(prompt, /live-action storyboard frame/i);
});

test('regenerateSceneImages persists fallback diagnostics when render fails', async () => {
  const project = buildProject();

  const result = await regenerateSceneImages(project, {
    imageModel: FIXED_IMAGE_MODEL,
    generateImageImpl: async () => {
      const error = new Error('Hosted image generation did not return an image.');
      error.diagnosticCode = 'no_image_empty_response';
      error.diagnosticMessage = 'The model completed without returning an image.';
      error.model = FIXED_IMAGE_MODEL;
      error.latencyMs = 3210;
      throw error;
    },
  });

  const scene = result.project.storyboard.acts[0].sequences[0].scenes[0];
  assert.equal(scene.imageStatus, 'fallback');
  assert.match(scene.imageUrl, /^data:image\/svg\+xml/);
  assert.equal(scene.imageProvider, 'openrouter');
  assert.equal(scene.imageModelResolved, FIXED_IMAGE_MODEL);
  assert.equal(scene.imageDiagnosticCode, 'no_image_empty_response');
  assert.equal(scene.imageDiagnosticMessage, 'The model completed without returning an image.');
  assert.equal(scene.imageLatencyMs, 3210);
  assert.ok(scene.imagePromptPreview.length > 0);
});

test('regenerateSceneImages skips unchanged ready scenes', async () => {
  const project = buildProject();
  let calls = 0;

  const first = await regenerateSceneImages(project, {
    imageModel: FIXED_IMAGE_MODEL,
    generateImageImpl: async () => {
      calls += 1;
      return {
        imageUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
        model: FIXED_IMAGE_MODEL,
        provider: 'openrouter',
        diagnosticCode: 'success',
        diagnosticMessage: '',
        latencyMs: 1200,
      };
    },
  });

  const second = await regenerateSceneImages(first.project, {
    imageModel: FIXED_IMAGE_MODEL,
    generateImageImpl: async () => {
      calls += 1;
      return {
        imageUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
        model: FIXED_IMAGE_MODEL,
        provider: 'openrouter',
        diagnosticCode: 'success',
        diagnosticMessage: '',
        latencyMs: 900,
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(second.generatedCount, 0);
  assert.equal(second.failedCount, 0);
});

test('regenerateSceneImages retries transient failures and runs with bounded concurrency', async () => {
  const project = buildProjectWithSceneCount(3);
  let inFlight = 0;
  let maxInFlight = 0;
  let totalCalls = 0;
  let firstSceneAttempts = 0;
  const progressStages = [];

  const result = await regenerateSceneImages(project, {
    imageModel: FIXED_IMAGE_MODEL,
    concurrency: 2,
    maxAttempts: 3,
    interRequestDelayMs: 0,
    onProgress: (progress) => {
      progressStages.push(progress.stage);
    },
    generateImageImpl: async ({ prompt }) => {
      totalCalls += 1;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));

      try {
        if (prompt.includes('Shot 1')) {
          firstSceneAttempts += 1;
          if (firstSceneAttempts === 1) {
            const error = new Error('Hosted image generation did not return an image.');
            error.diagnosticCode = 'no_image_empty_response';
            error.diagnosticMessage = 'The model completed without returning an image.';
            error.model = FIXED_IMAGE_MODEL;
            throw error;
          }
        }

        return {
          imageUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E',
          model: FIXED_IMAGE_MODEL,
          provider: 'openrouter',
          diagnosticCode: 'success',
          diagnosticMessage: '',
          latencyMs: 900,
        };
      } finally {
        inFlight -= 1;
      }
    },
  });

  assert.equal(result.generatedCount, 3);
  assert.equal(result.failedCount, 0);
  assert.equal(firstSceneAttempts, 2);
  assert.equal(totalCalls, 4);
  assert.equal(maxInFlight, 2);
  assert.match(progressStages.join(','), /retrying/);
  for (const scene of result.project.storyboard.acts[0].sequences[0].scenes) {
    assert.equal(scene.imageStatus, 'ready');
  }
});
