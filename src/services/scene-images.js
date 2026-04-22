import { generateImage } from './ai-client.js';
import { logger } from './logger.js';
import { saveImage, resolveImagePath } from './storage.js';

function makeRegenId() {
  return `rg-${Math.random().toString(36).slice(2, 8)}`;
}

const IMAGE_PROMPT_MAX_CHARS = 1200;
const IMAGE_PROMPT_TARGET_CHARS = 900;
const MAX_IMAGE_CHARACTERS = 2;
const MAX_IMAGE_LOCATIONS = 1;
const IMAGE_BATCH_CONCURRENCY = 2;
const IMAGE_MAX_ATTEMPTS = 3;
const IMAGE_RETRY_BASE_DELAY_MS = 1200;
const IMAGE_RATE_LIMIT_RETRY_BASE_MS = 5000;
const IMAGE_INTER_REQUEST_DELAY_MS = 1500;

export async function regenerateSceneImages(project, options = {}) {
  const nextProject = structuredClone(project);
  const imageModel = String(options.imageModel || '').trim();
  const fallbackImageModel = String(options.fallbackImageModel || '').trim();
  const generateImageImpl = typeof options.generateImageImpl === 'function'
    ? options.generateImageImpl
    : generateImage;
  const concurrency = normalizePositiveInt(options.concurrency, IMAGE_BATCH_CONCURRENCY);
  const maxAttempts = normalizePositiveInt(options.maxAttempts, IMAGE_MAX_ATTEMPTS);
  const interRequestDelayMs = normalizeNonNegativeInt(options.interRequestDelayMs, IMAGE_INTER_REQUEST_DELAY_MS);
  const candidateSceneIds = normalizeIdArray(options.candidateSceneIds);
  const candidateSet = candidateSceneIds.length > 0 ? new Set(candidateSceneIds) : null;
  const scenes = collectScenes(nextProject.storyboard);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (scenes.length === 0) {
    return {
      project: nextProject,
      imageModel,
      updatedSceneIds: [],
      generatedCount: 0,
      failedCount: 0,
    };
  }

  const queue = [];

  for (const scene of scenes) {
    if (candidateSet) {
      const sceneId = String(scene?.id || '').trim().toLowerCase();
      if (!sceneId || !candidateSet.has(sceneId)) {
        continue;
      }
    }

    const prompt = buildSceneImagePrompt(scene, nextProject.entities, nextProject.storyboard);
    if (!prompt) {
      continue;
    }

    const promptHash = hashString(`${imageModel}\n${prompt}`);
    if (!shouldRegenerate(scene, promptHash)) {
      continue;
    }

    queue.push({
      scene,
      prompt,
      promptHash,
    });
  }

  if (queue.length === 0) {
    return {
      project: nextProject,
      imageModel,
      updatedSceneIds: [],
      generatedCount: 0,
      failedCount: 0,
    };
  }

  const updatedSceneIds = [];
  let generatedCount = 0;
  let failedCount = 0;
  const totalCount = queue.length;
  let queueCursor = 0;
  let startedCount = 0;

  async function runQueueItem(item, index) {
    const { scene, prompt, promptHash } = item;
    startedCount += 1;
    const regenId = makeRegenId();
    const regenStartedAt = performance.now();

    logger.info('img.regen.start', {
      regenId,
      sceneId: scene.id,
      sceneTitle: scene.title,
      imageModel,
      fallbackImageModel: fallbackImageModel || null,
      maxAttempts,
      promptChars: String(prompt || '').length,
      promptPreview: String(prompt || '').slice(0, 160),
      queuePosition: `${index + 1}/${totalCount}`,
    });

    onProgress?.({
      stage: 'started',
      sceneId: scene.id,
      sceneTitle: scene.title,
      completedCount: generatedCount + failedCount,
      startedCount,
      activeCount: Math.max(0, startedCount - (generatedCount + failedCount)),
      totalCount,
      currentIndex: index,
    });

    try {
      const imageResult = await generateSceneImageWithRetries({
        scene,
        prompt,
        imageModel,
        fallbackImageModel,
        generateImageImpl,
        maxAttempts,
        regenId,
        onRetry: ({ attemptNumber, delayMs, error }) => {
          onProgress?.({
            stage: 'retrying',
            sceneId: scene.id,
            sceneTitle: scene.title,
            completedCount: generatedCount + failedCount,
            startedCount,
            activeCount: Math.max(0, startedCount - (generatedCount + failedCount)),
            totalCount,
            currentIndex: index,
            attemptNumber,
            maxAttempts,
            delayMs,
            diagnosticCode: String(error?.diagnosticCode || ''),
            diagnosticMessage: String(error?.diagnosticMessage || error?.message || ''),
          });
        },
      });

      applySuccessfulSceneImage(scene, {
        imageResult,
        prompt,
        promptHash,
        imageModel,
      });

      logger.info('img.regen.success', {
        regenId,
        sceneId: scene.id,
        sceneTitle: scene.title,
        attemptsUsed: imageResult?.attemptsUsed || null,
        usedFallbackModel: Boolean(imageResult?.usedFallbackModel),
        finalModel: imageResult?.model || imageModel,
        totalMs: Math.round(performance.now() - regenStartedAt),
        imageLatencyMs: imageResult?.latencyMs || null,
      });

      generatedCount += 1;
      updatedSceneIds.push(scene.id);
      onProgress?.({
        stage: 'completed',
        sceneId: scene.id,
        sceneTitle: scene.title,
        completedCount: generatedCount + failedCount,
        startedCount,
        activeCount: Math.max(0, startedCount - (generatedCount + failedCount)),
        totalCount,
        currentIndex: index,
        result: 'ready',
        scenePatch: buildSceneImagePatch(scene),
      });
    } catch (error) {
      logger.error('img.regen.fail', {
        regenId,
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        imageModel,
        fallbackImageModel: fallbackImageModel || null,
        totalMs: Math.round(performance.now() - regenStartedAt),
        diagnosticCode: String(error?.diagnosticCode || ''),
        diagnosticMessage: String(error?.diagnosticMessage || error?.message || ''),
        status: Number(error?.status || 0) || null,
        upstreamStatus: Number(error?.upstreamStatus || 0) || null,
        // Short stack so we can trace where the terminal error came from
        // when retry logic itself misbehaves.
        errorStack: String(error?.stack || '').split('\n').slice(0, 4).join('\n'),
      });
      applyFallbackSceneImage(scene, {
        error,
        prompt,
        promptHash,
        imageModel,
      });

      failedCount += 1;
      updatedSceneIds.push(scene.id);
      onProgress?.({
        stage: 'completed',
        sceneId: scene.id,
        sceneTitle: scene.title,
        completedCount: generatedCount + failedCount,
        startedCount,
        activeCount: Math.max(0, startedCount - (generatedCount + failedCount)),
        totalCount,
        currentIndex: index,
        result: 'fallback',
        scenePatch: buildSceneImagePatch(scene),
      });
    }
  }

  const workerCount = Math.min(queue.length, concurrency);
  await Promise.all(
    Array.from({ length: workerCount }, async (_, workerIndex) => {
      // Stagger worker start to avoid simultaneous first requests
      if (workerIndex > 0 && interRequestDelayMs > 0) {
        await wait(interRequestDelayMs * workerIndex);
      }
      while (queueCursor < queue.length) {
        const currentIndex = queueCursor;
        queueCursor += 1;
        await runQueueItem(queue[currentIndex], currentIndex);
        // Throttle between consecutive requests within each worker
        if (queueCursor < queue.length && interRequestDelayMs > 0) {
          await wait(interRequestDelayMs);
        }
      }
    })
  );

  if (updatedSceneIds.length > 0) {
    nextProject.updatedAt = new Date().toISOString();
  }

  return {
    project: nextProject,
    imageModel,
    updatedSceneIds,
    generatedCount,
    failedCount,
  };
}

async function generateSceneImageWithRetries({
  scene,
  prompt,
  imageModel,
  fallbackImageModel,
  generateImageImpl,
  maxAttempts,
  regenId,
  onRetry,
}) {
  let lastError = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      const attemptStartedAt = new Date().toISOString();
      const imageResult = await generateImageImpl({
        model: imageModel,
        prompt,
        regenId,
        attemptNumber,
      });

      return {
        ...imageResult,
        attemptStartedAt,
        attemptsUsed: attemptNumber,
      };
    } catch (error) {
      lastError = error;
      if (!shouldRetryImageError(error, attemptNumber, maxAttempts)) {
        logger.warn('img.regen.give_up', {
          regenId,
          sceneId: scene?.id,
          sceneTitle: scene?.title,
          imageModel,
          attemptNumber,
          maxAttempts,
          reason: 'non-retryable error or attempt cap reached',
          diagnosticCode: String(error?.diagnosticCode || ''),
          diagnosticMessage: String(error?.diagnosticMessage || error?.message || ''),
          status: Number(error?.status || 0) || null,
        });
        break;
      }

      const delayMs = getRetryDelayMs(attemptNumber, error);
      logger.warn('img.regen.retry', {
        regenId,
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        imageModel,
        fromAttempt: attemptNumber,
        toAttempt: attemptNumber + 1,
        maxAttempts,
        delayMs,
        reason: classifyRetryReason(error),
        diagnosticCode: String(error?.diagnosticCode || ''),
        diagnosticMessage: String(error?.diagnosticMessage || error?.message || ''),
        status: Number(error?.status || 0) || null,
        upstreamStatus: Number(error?.upstreamStatus || 0) || null,
        retryAfterSeconds: Number(error?.retryAfterSeconds || 0) || null,
      });
      onRetry?.({
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        attemptNumber: attemptNumber + 1,
        maxAttempts,
        delayMs,
        error,
      });
      await wait(delayMs);
    }
  }

  // If primary model exhausted retries due to rate limit, try the fallback model once
  if (lastError && fallbackImageModel && fallbackImageModel !== imageModel && isRateLimitError(lastError)) {
    logger.warn('img.regen.fallback_attempt', {
      regenId,
      sceneId: scene?.id,
      sceneTitle: scene?.title,
      primaryModel: imageModel,
      fallbackModel: fallbackImageModel,
      primaryError: String(lastError?.message || ''),
      primaryDiagnosticCode: String(lastError?.diagnosticCode || ''),
    });
    onRetry?.({
      sceneId: scene?.id,
      sceneTitle: scene?.title,
      attemptNumber: maxAttempts + 1,
      maxAttempts: maxAttempts + 1,
      delayMs: 0,
      error: lastError,
      fallbackModel: fallbackImageModel,
    });
    try {
      const attemptStartedAt = new Date().toISOString();
      const imageResult = await generateImageImpl({
        model: fallbackImageModel,
        prompt,
        regenId,
        attemptNumber: maxAttempts + 1,
      });
      logger.info('img.regen.fallback_ok', {
        regenId,
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        fallbackModel: fallbackImageModel,
        latencyMs: imageResult?.latencyMs || null,
      });
      return {
        ...imageResult,
        attemptStartedAt,
        attemptsUsed: maxAttempts + 1,
        usedFallbackModel: true,
      };
    } catch (fallbackError) {
      logger.error('img.regen.fallback_fail', {
        regenId,
        sceneId: scene?.id,
        sceneTitle: scene?.title,
        fallbackModel: fallbackImageModel,
        diagnosticCode: String(fallbackError?.diagnosticCode || ''),
        diagnosticMessage: String(fallbackError?.diagnosticMessage || fallbackError?.message || ''),
        status: Number(fallbackError?.status || 0) || null,
      });
      // Fall through — throw the primary error below (it's usually more
      // informative than "fallback also failed").
    }
  }

  throw lastError || new Error('Image generation failed.');
}

/**
 * Classify why we're retrying — fed into the img.regen.retry log so a
 * reader can tell rate-limit runs apart from timeout runs apart from
 * content-filter bounce runs at a glance.
 */
function classifyRetryReason(error) {
  const status = Number(error?.status || error?.upstreamStatus || 0) || 0;
  const code = String(error?.diagnosticCode || '').toLowerCase();
  if (status === 429 || code === 'rate_limited') return 'rate_limited';
  if (code === 'timeout') return 'timeout';
  if (code === 'no_image_text_only') return 'content_filter_refusal';
  if (code === 'no_image_empty_response') return 'empty_response';
  if (status >= 500) return 'upstream_5xx';
  if (code === 'transport_error') return 'transport_error';
  if (code === 'parse_error') return 'parse_error';
  return 'other';
}

async function applySuccessfulSceneImage(scene, { imageResult, prompt, promptHash, imageModel }) {
  let resolvedUrl = imageResult.imageUrl;
  if (resolvedUrl.startsWith('data:image/') && !resolvedUrl.startsWith('data:image/svg')) {
    try {
      resolvedUrl = await compressToWebP(resolvedUrl);
    } catch (compressErr) {
      console.warn('Failed to compress image to WebP, using original:', compressErr);
    }
  }

  if (!resolvedUrl.startsWith('data:image/svg+xml')) {
    try {
      const localPath = await saveImage(scene.id, resolvedUrl);
      if (localPath) {
        const absUrl = await resolveImagePath(localPath);
        if (absUrl) {
          resolvedUrl = absUrl;
        }
      }
    } catch {
      // Fall back to raw image data/URL if save fails
    }
  }

  scene.imageUrl = resolvedUrl;
  scene.imagePrompt = prompt;
  scene.imagePromptHash = promptHash;
  scene.imageStatus = 'ready';
  scene.imageError = '';
  scene.imageUpdatedAt = new Date().toISOString();
  scene.imageProvider = String(imageResult.provider || 'openrouter');
  scene.imageModelResolved = String(imageResult.model || imageModel);
  scene.imageAttemptedAt = imageResult.attemptStartedAt || new Date().toISOString();
  scene.imageLatencyMs = Number(imageResult.latencyMs || 0) || null;
  scene.imageDiagnosticCode = String(imageResult.diagnosticCode || 'success');
  scene.imageDiagnosticMessage = String(imageResult.diagnosticMessage || '');
  scene.imagePromptPreview = clipText(prompt, 220);
}

function applyFallbackSceneImage(scene, { error, prompt, promptHash, imageModel }) {
  scene.imageUrl = buildFallbackStoryboardFrame(scene, promptHash);
  scene.imagePrompt = prompt;
  scene.imagePromptHash = promptHash;
  scene.imageStatus = 'fallback';
  scene.imageError = String(error?.message || 'Image generation failed.');
  scene.imageUpdatedAt = new Date().toISOString();
  scene.imageProvider = 'openrouter';
  scene.imageModelResolved = String(error?.model || imageModel);
  scene.imageAttemptedAt = new Date().toISOString();
  scene.imageLatencyMs = Number(error?.latencyMs || 0) || null;
  scene.imageDiagnosticCode = String(error?.diagnosticCode || 'fallback_used');
  scene.imageDiagnosticMessage = String(
    error?.diagnosticMessage || error?.message || 'Hosted image generation failed.'
  );
  scene.imagePromptPreview = clipText(prompt, 220);
}

function buildSceneImagePatch(scene) {
  return {
    imageUrl: scene.imageUrl,
    imagePrompt: scene.imagePrompt,
    imagePromptHash: scene.imagePromptHash,
    imageStatus: scene.imageStatus,
    imageError: scene.imageError,
    imageUpdatedAt: scene.imageUpdatedAt,
    imageProvider: scene.imageProvider,
    imageModelResolved: scene.imageModelResolved,
    imageAttemptedAt: scene.imageAttemptedAt,
    imageLatencyMs: scene.imageLatencyMs,
    imageDiagnosticCode: scene.imageDiagnosticCode,
    imageDiagnosticMessage: scene.imageDiagnosticMessage,
    imagePromptPreview: scene.imagePromptPreview,
  };
}

function normalizePositiveInt(value, fallback) {
  const numeric = Math.floor(Number(value || 0));
  return numeric > 0 ? numeric : fallback;
}

function normalizeNonNegativeInt(value, fallback) {
  if (value === 0) return 0;
  const numeric = Math.floor(Number(value || 0));
  return numeric > 0 ? numeric : fallback;
}

function isRateLimitError(error) {
  const status = Number(error?.status || 0) || 0;
  const upstreamStatus = Number(error?.upstreamStatus || 0) || 0;
  if (status === 429 || upstreamStatus === 429) return true;
  const msg = String(error?.message || '').toLowerCase();
  const diag = String(error?.diagnosticMessage || '').toLowerCase();
  return /(quota|rate limit|429|too many requests)/i.test(`${msg} ${diag}`);
}

function shouldRetryImageError(error, attemptNumber, maxAttempts) {
  if (attemptNumber >= maxAttempts) {
    return false;
  }

  const diagnosticCode = String(error?.diagnosticCode || '').trim().toLowerCase();
  const diagnosticMessage = String(error?.diagnosticMessage || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();
  const status = Number(error?.status || 0) || 0;
  const upstreamStatus = Number(error?.upstreamStatus || 0) || 0;
  const combined = `${message} ${diagnosticMessage}`;

  if (status === 429 || upstreamStatus === 429 || status >= 500) {
    return true;
  }

  if (
    diagnosticCode === 'timeout' ||
    diagnosticCode === 'transport_error' ||
    diagnosticCode === 'upstream_http_error' ||
    diagnosticCode === 'no_image_empty_response' ||
    diagnosticCode === 'no_image_text_only'
  ) {
    return true;
  }

  return /(quota|rate limit|429|too many requests|busy|temporarily|overloaded|timed out|did not return an image|no image)/i.test(combined);
}

function getRetryDelayMs(attemptNumber, error) {
  const jitter = Math.floor(Math.random() * 500);

  // If OpenRouter told us how long to wait, use that (with a floor)
  const retryAfterSeconds = Number(error?.retryAfterSeconds || 0);
  if (retryAfterSeconds > 0) {
    return Math.max(retryAfterSeconds * 1000, 2000) + jitter;
  }

  // Use a longer base delay for rate-limit / 429 errors
  const status = Number(error?.status || error?.upstreamStatus || 0) || 0;
  const isRateLimit = status === 429 ||
    /(quota|rate limit|429|too many requests)/i.test(String(error?.message || ''));

  const baseMs = isRateLimit ? IMAGE_RATE_LIMIT_RETRY_BASE_MS : IMAGE_RETRY_BASE_DELAY_MS;
  return (baseMs * 2 ** Math.max(0, attemptNumber - 1)) + jitter;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

function shouldRegenerate(scene, promptHash) {
  const currentHash = String(scene?.imagePromptHash || '');
  const currentUrl = String(scene?.imageUrl || '').trim();
  const status = String(scene?.imageStatus || '');

  if (!currentUrl) {
    return true;
  }
  if (currentHash !== promptHash) {
    return true;
  }
  return status === 'error' || status === 'fallback';
}

/**
 * Compresses a dataURI image into a highly optimized WebP dataURI.
 * Crucial to keep the project JSON size well under Firestore's 1MB limit.
 */
async function compressToWebP(dataUri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // Scale down image to a reasonable thumbnail size (e.g., max 512px width)
      const MAX_WIDTH = 512;
      let width = img.width;
      let height = img.height;
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      // Compress to WebP at 0.5 quality
      resolve(canvas.toDataURL('image/webp', 0.5));
    };
    img.onerror = reject;
    img.src = dataUri;
  });
}

function collectScenes(storyboard) {
  const all = [];
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of scenes) {
        all.push(scene);
      }
    }
  }
  return all;
}

export function buildSceneImagePrompt(scene, entities, storyboard) {
  const input = buildSceneImageInput(scene, entities, storyboard);
  if (!input) {
    return '';
  }

  return renderSceneImagePrompt(input);
}

function buildSceneImageInput(scene, entities, storyboard) {
  const sceneContext = resolveSceneContext(storyboard, scene);
  const shotTitle = clipText(scene?.title, 90);
  const location = clipText(scene?.location, 120);
  const time = clipText(scene?.time, 40);
  const visualCore = compactSentence(
    scene?.visualDescription || scene?.storyFunction || scene?.title,
    280
  );
  const actionCore = compactSentence(scene?.action, 220);
  const mood = clipText(scene?.mood, 70);

  if (!shotTitle && !visualCore && !actionCore) {
    return null;
  }

  const sceneTextBlob = [
    sceneContext.actTitle,
    sceneContext.sequenceTitle,
    sceneContext.previousShotTitle,
    sceneContext.nextShotTitle,
    shotTitle,
    location,
    time,
    visualCore,
    actionCore,
    mood,
  ]
    .join('\n')
    .toLowerCase();

  const matching = collectMatchingEntities(scene, entities, sceneTextBlob);
  const characterVisuals = matching.characters
    .slice(0, MAX_IMAGE_CHARACTERS)
    .map((character) => ({
      name: clipText(character?.name, 40),
      detail: compactEntityDescription(
        character?.visualPromptDescription || character?.description,
        120
      ),
    }))
    .filter((item) => item.name && item.detail);

  const locationVisuals = matching.locations
    .slice(0, MAX_IMAGE_LOCATIONS)
    .map((locationItem) => compactEntityDescription(
      locationItem?.visualPromptDescription || locationItem?.description || locationItem?.name,
      140
    ))
    .filter(Boolean);

  const visualMedium = inferVisualMedium(
    [
      sceneContext.actTitle,
      sceneContext.sequenceTitle,
      shotTitle,
      location,
      time,
      visualCore,
      actionCore,
      mood,
      ...characterVisuals.map((item) => item.detail),
      ...locationVisuals,
    ].join('\n')
  );

  const continuityNotes = [
    `Match the established ${visualMedium}.`,
    'Preserve character species/forms, silhouette, wardrobe logic, and environment design language from the rest of the storyboard.',
    sceneContext.previousShotTitle
      ? `This beat follows "${clipText(sceneContext.previousShotTitle, 50)}".`
      : '',
    sceneContext.nextShotTitle
      ? `It should still feel compatible with the next beat "${clipText(sceneContext.nextShotTitle, 50)}".`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    shotTitle,
    location,
    time,
    visualCore,
    actionCore,
    mood,
    actTitle: clipText(sceneContext.actTitle, 70),
    sequenceTitle: clipText(sceneContext.sequenceTitle, 70),
    visualMedium,
    continuityNotes,
    characterVisuals,
    locationVisuals,
    styleDirectives: [
      visualMedium,
      'director blocking reference',
      'project continuity match',
      'film still composition',
      'clear staging',
      'readable eyelines',
      'landmark and prop emphasis',
      'believable anatomy',
      'cinematic lighting',
      'no text',
      '16:9',
    ],
  };
}

function renderSceneImagePrompt(input) {
  const fullPrompt = renderSceneImagePromptWithCaps(input, {
    visualMax: 280,
    actionMax: 220,
    characterMax: 120,
    locationMax: 140,
    includeLocationDetails: true,
    includeMood: true,
  });

  if (fullPrompt.length <= IMAGE_PROMPT_TARGET_CHARS) {
    return fullPrompt;
  }

  const compactPrompt = renderSceneImagePromptWithCaps(input, {
    visualMax: 210,
    actionMax: 150,
    characterMax: 90,
    locationMax: 90,
    includeLocationDetails: false,
    includeMood: Boolean(input.mood),
  });

  if (compactPrompt.length <= IMAGE_PROMPT_TARGET_CHARS) {
    return compactPrompt;
  }

  return clipText(compactPrompt, IMAGE_PROMPT_TARGET_CHARS);
}

function renderSceneImagePromptWithCaps(input, caps) {
  const lines = [
    'Create one cinematic storyboard frame that matches the established project continuity.',
    `Medium: ${clipText(input.visualMedium, 70)}`,
    'Emphasize framing, blocking, landmark geography, key props, and the main focal point.',
  ];
  const shotTitle = clipText(input.shotTitle, 80);
  const location = clipText(input.location, 90);
  const time = clipText(input.time, 28);
  const actTitle = clipText(input.actTitle, 60);
  const sequenceTitle = clipText(input.sequenceTitle, 60);
  const continuityNotes = compactSentence(input.continuityNotes, 180);
  const visualCore = compactSentence(input.visualCore, caps.visualMax);
  const actionCore = compactSentence(input.actionCore, caps.actionMax);
  const mood = clipText(input.mood, 50);
  const characterVisuals = input.characterVisuals
    .map((character) => ({
      name: clipText(character.name, 32),
      detail: compactEntityDescription(character.detail, caps.characterMax),
    }))
    .filter((character) => character.name && character.detail);
  const locationVisuals = input.locationVisuals
    .map((detail) => compactEntityDescription(detail, caps.locationMax))
    .filter(Boolean);

  if (shotTitle) {
    lines.push(`Scene: ${shotTitle}`);
  }
  const storyContext = [actTitle, sequenceTitle].filter(Boolean).join(' -> ');
  if (storyContext) {
    lines.push(`Story context: ${storyContext}`);
  }

  const setting = [location, time].filter(Boolean).join(', ');
  if (setting) {
    lines.push(`Setting: ${setting}`);
  }
  if (continuityNotes) {
    lines.push(`Continuity: ${continuityNotes}`);
  }
  if (visualCore) {
    lines.push(`Composition: ${visualCore}`);
  }
  if (actionCore) {
    lines.push(`Action: ${actionCore}`);
  }
  if (caps.includeMood && mood) {
    lines.push(`Mood: ${mood}`);
  }
  if (characterVisuals.length > 0) {
    lines.push('Characters:');
    for (const character of characterVisuals) {
      lines.push(`- ${character.name}: ${character.detail}`);
    }
  }
  if (caps.includeLocationDetails && locationVisuals.length > 0) {
    lines.push('Location details:');
    for (const detail of locationVisuals) {
      lines.push(`- ${detail}`);
    }
  }
  lines.push(`Style: ${input.styleDirectives.join(', ')}`);
  return lines.join('\n');
}

function resolveSceneContext(storyboard, scene) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  const targetSceneId = String(scene?.id || '').trim();

  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const shots = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      const index = shots.findIndex((item) => String(item?.id || '').trim() === targetSceneId);
      if (index < 0) {
        continue;
      }
      return {
        actTitle: String(act?.title || '').trim(),
        sequenceTitle: String(sequence?.title || '').trim(),
        previousShotTitle: String(shots[index - 1]?.title || '').trim(),
        nextShotTitle: String(shots[index + 1]?.title || '').trim(),
      };
    }
  }

  return {
    actTitle: '',
    sequenceTitle: '',
    previousShotTitle: '',
    nextShotTitle: '',
  };
}

function collectMatchingEntities(scene, entities, sceneTextBlob) {
  const characters = Array.isArray(entities?.characters) ? entities.characters : [];
  const locations = Array.isArray(entities?.locations) ? entities.locations : [];

  const sceneCharacterIds = new Set(normalizeIdArray(scene?.characterIds));
  const sceneLocationIds = new Set(normalizeIdArray(scene?.locationIds));

  const matchedCharacters = [];
  for (const character of characters) {
    const id = String(character?.id || '').trim().toLowerCase();
    const name = String(character?.name || '').trim().toLowerCase();
    if (!id && !name) {
      continue;
    }

    const byId = id ? sceneCharacterIds.has(id) : false;
    const byName = name ? includesToken(sceneTextBlob, name) : false;
    const bySlug = id ? includesToken(sceneTextBlob, id.replaceAll('_', ' ')) : false;
    if (byId || byName || bySlug) {
      matchedCharacters.push(character);
    }
  }

  const matchedLocations = [];
  for (const location of locations) {
    const id = String(location?.id || '').trim().toLowerCase();
    const name = String(location?.name || '').trim().toLowerCase();
    if (!id && !name) {
      continue;
    }

    const byId = id ? sceneLocationIds.has(id) : false;
    const byName = name ? includesToken(sceneTextBlob, name) : false;
    const bySlug = id ? includesToken(sceneTextBlob, id.replaceAll('_', ' ')) : false;
    if (byId || byName || bySlug) {
      matchedLocations.push(location);
    }
  }

  return {
    characters: uniqById(matchedCharacters),
    locations: uniqById(matchedLocations),
  };
}

function uniqById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const id = String(item?.id || '').trim().toLowerCase();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(item);
  }
  return out;
}

function normalizeIdArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function includesToken(haystack, needle) {
  const candidate = String(needle || '').trim().toLowerCase();
  if (!candidate || candidate.length < 3) {
    return false;
  }
  if (candidate.includes(' ')) {
    return haystack.includes(candidate);
  }

  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

function compactSentence(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return '';
  }

  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return clipText(firstSentence, maxLength);
}

function compactEntityDescription(value, maxLength) {
  const text = compactSentence(value, maxLength);
  if (!text) {
    return '';
  }
  return text.replace(/^[-:,\s]+/, '');
}

function inferVisualMedium(text) {
  const source = String(text || '').toLowerCase();

  if (/(stop[\s-]?motion|claymation|felt puppet|miniature world)/.test(source)) {
    return 'stop-motion storyboard frame';
  }
  if (/(anime|manga|ghibli)/.test(source)) {
    return 'anime-inspired animated storyboard frame';
  }
  if (/(3d animated|cg animated|animated movie|animated feature|pixar|dreamworks)/.test(source)) {
    return 'stylized 3D animated storyboard frame';
  }
  if (/(2d animated|2d animation|hand-drawn|storybook|illustrated|cartoon)/.test(source)) {
    return 'stylized 2D animated storyboard frame';
  }
  if (/(live[- ]action|photoreal|practical set|on location)/.test(source)) {
    return 'live-action storyboard frame';
  }

  return 'cinematic storyboard frame';
}

function clipText(value, maxLength = 400) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function hashString(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function buildFallbackStoryboardFrame(scene, promptHash) {
  const seed = parseInt(hashString(`${promptHash}:${scene?.title || ''}`), 16) || 1;
  const palettes = [
    ['#dff3ff', '#c9e7ff', '#7bb3d6', '#20445e'],
    ['#f8ecdd', '#f5d4b2', '#d29f72', '#4f3526'],
    ['#e6f6ea', '#cae6d1', '#83b39a', '#264336'],
    ['#efe8ff', '#dbd1ff', '#9989d8', '#302749'],
  ];
  const palette = palettes[seed % palettes.length];
  const horizonY = 86 + (seed % 38);
  const subjectCount = Math.max(1, Math.min(3, scene?.characterIds?.length || ((seed % 2) + 1)));
  const shapes = [];

  for (let index = 0; index < subjectCount; index += 1) {
    const offset = seed + index * 29;
    const x = 56 + (offset % 178);
    const bodyWidth = 20 + (offset % 16);
    const bodyHeight = 52 + (offset % 22);
    const headRadius = Math.max(7, Math.floor(bodyWidth / 3));
    const y = horizonY - bodyHeight + 10 - (offset % 18);
    shapes.push(
      `<circle cx="${x + Math.floor(bodyWidth / 2)}" cy="${y}" r="${headRadius}" fill="${palette[3]}" fill-opacity="0.9" />`
    );
    shapes.push(
      `<rect x="${x}" y="${y + headRadius - 2}" width="${bodyWidth}" height="${bodyHeight}" rx="9" fill="${palette[3]}" fill-opacity="0.82" />`
    );
  }

  const sunX = 396 - (seed % 84);
  const sunY = 58 + (seed % 28);
  const accentX = 28 + (seed % 182);
  const accentWidth = 70 + (seed % 78);
  const accentHeight = 14 + (seed % 28);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="320" viewBox="0 0 512 320" fill="none">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${palette[0]}" />
          <stop offset="100%" stop-color="${palette[1]}" />
        </linearGradient>
        <linearGradient id="ground" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${palette[2]}" stop-opacity="0.78" />
          <stop offset="100%" stop-color="${palette[3]}" stop-opacity="0.9" />
        </linearGradient>
      </defs>
      <rect width="512" height="320" rx="18" fill="url(#sky)" />
      <rect x="12" y="12" width="488" height="296" rx="14" stroke="${palette[3]}" stroke-opacity="0.18" />
      <circle cx="${sunX}" cy="${sunY}" r="${26 + (seed % 14)}" fill="#ffffff" fill-opacity="0.55" />
      <rect x="0" y="${horizonY}" width="512" height="${320 - horizonY}" fill="url(#ground)" />
      <path d="M0 ${horizonY + 22} C 118 ${horizonY - 10}, 250 ${horizonY + 34}, 512 ${horizonY + 6}" stroke="${palette[0]}" stroke-width="8" stroke-opacity="0.42" fill="none" />
      <rect x="${accentX}" y="${horizonY - accentHeight}" width="${accentWidth}" height="${accentHeight}" rx="8" fill="${palette[2]}" fill-opacity="0.74" />
      ${shapes.join('\n')}
      <path d="M30 30h52" stroke="${palette[3]}" stroke-opacity="0.22" stroke-width="5" stroke-linecap="round" />
      <path d="M430 290h52" stroke="${palette[3]}" stroke-opacity="0.22" stroke-width="5" stroke-linecap="round" />
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export { buildFallbackStoryboardFrame };

export const __sceneImagesTestUtils = {
  buildSceneImageInput,
  buildSceneImagePrompt,
};
