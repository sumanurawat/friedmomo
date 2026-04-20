import { create } from 'zustand';

import { sendMessage, generateTitle } from '../services/ai-client.js';

import {
  applyUpdates,
  buildSystemPrompt,
  parseAIResponse,
} from '../services/prompt-builder.js';
import {
  createProject,
  createEmptyEntities,
  createEmptyStoryboard,
} from '../types/storyboard.js';
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  getActiveUserId,
} from '../services/storage.js';
import { regenerateSceneImages } from '../services/scene-images.js';
import { useSettingsStore } from './settings-store.js';

import {
  buildSceneFingerprint,
  findSceneById,
  findSequence as findSequenceByNumbers,
  normalizeKeyPart,
} from '../utils/storyboard-ops.js';

function createAssistantMessage(content, extras = {}) {
  return {
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

function createUserMessage(content, opts = {}) {
  return {
    role: 'user',
    content,
    isSystem: Boolean(opts.isSystem),
    hidden: Boolean(opts.hidden),
    timestamp: new Date().toISOString(),
  };
}

function isInternalFocusPrompt(content) {
  return /^\s*\[FOCUS_(SCENE|SEQUENCE)\]/i.test(String(content || ''));
}

function extractEmbeddedUserRequest(content) {
  const match = String(content || '').match(/User request:\s*([\s\S]+)$/i);
  if (!match) {
    return '';
  }
  return String(match[1] || '').trim();
}

function isVisibleMessage(message) {
  return !message?.hidden;
}

function buildApiMessages(messages, transientUserContent = '') {
  const history = Array.isArray(messages) ? messages : [];
  const apiMessages = history
    .filter((message) => isVisibleMessage(message) && !message?.isSystem)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const transient = String(transientUserContent || '').trim();
  if (transient) {
    apiMessages.push({
      role: 'user',
      content: transient,
    });
  }

  return apiMessages;
}

function resolveLiveProjectBase(getState, fallbackProject) {
  const current = getState?.().activeProject;
  if (!current || String(current?.id || '') !== String(fallbackProject?.id || '')) {
    return fallbackProject;
  }
  return current;
}

function appendAssistantReply(project, replyText, extras = {}) {
  const messages = Array.isArray(project?.messages) ? project.messages : [];
  return {
    ...project,
    messages: [...messages, createAssistantMessage(replyText, extras)],
  };
}

function attachPreviewToLastAssistantMessage(project, scenePreview) {
  if (!scenePreview) {
    return project;
  }

  const messages = Array.isArray(project?.messages) ? [...project.messages] : [];
  const lastIndex = messages.length - 1;
  if (lastIndex < 0 || messages[lastIndex]?.role !== 'assistant') {
    return project;
  }

  messages[lastIndex] = {
    ...messages[lastIndex],
    scenePreview,
  };

  return {
    ...project,
    messages,
  };
}

function buildRenderingDetail({
  totalCount,
  completedCount,
  sceneTitle,
  stage,
  result,
  activeCount,
  startedCount,
  attemptNumber,
  maxAttempts,
}) {
  const total = Number(totalCount || 0);
  if (total <= 0) {
    return 'Rendering updated scene previews in the background.';
  }

  const completed = Math.max(0, Number(completedCount || 0));
  const cleanTitle = String(sceneTitle || '').trim();
  const active = Math.max(0, Number(activeCount || 0));
  const started = Math.max(0, Number(startedCount || 0));

  if (stage === 'started') {
    const nextIndex = Math.min(total, Math.max(started, completed + 1));
    const suffix = active > 1 ? ` ${active} previews in flight.` : '';
    return cleanTitle
      ? `Rendering preview ${nextIndex} of ${total}: ${cleanTitle}.${suffix}`.trim()
      : `Rendering preview ${nextIndex} of ${total}.${suffix}`.trim();
  }

  if (stage === 'retrying') {
    const safeAttempt = Math.max(0, Number(attemptNumber || 0));
    const safeMaxAttempts = Math.max(0, Number(maxAttempts || 0));
    const label = cleanTitle ? ` for ${cleanTitle}` : '';
    return `Retrying preview${label} (attempt ${safeAttempt} of ${safeMaxAttempts})...`;
  }

  if (completed >= total) {
    return result === 'fallback'
      ? `Preview rendering finished with a fallback frame for the last scene.`
      : 'Preview rendering finished. Finalizing storyboard update...';
  }

  const suffix = result === 'fallback' ? ' Used a fallback frame for the last scene.' : '';
  const inflight = active > 0 ? ` ${active} still rendering.` : '';
  return `Rendered ${completed} of ${total} previews.${inflight}${suffix}`.trim();
}

function sortByUpdatedDesc(projects) {
  return [...projects].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function collectSceneIds(storyboard) {
  const ids = [];
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of scenes) {
        const sceneId = String(scene?.id || '').trim();
        if (sceneId) {
          ids.push(sceneId);
        }
      }
    }
  }
  return ids;
}

function uniqueStrings(values) {
  const set = new Set();
  for (const value of values || []) {
    const clean = String(value || '').trim();
    if (clean) {
      set.add(clean);
    }
  }
  return [...set];
}

function markSceneImagesGenerating(project, candidateSceneIds) {
  const nextProject = structuredClone(project);
  const candidateSet = new Set(normalizeStringArray(candidateSceneIds).map((id) => id.toLowerCase()));
  if (candidateSet.size === 0) {
    return nextProject;
  }

  const acts = Array.isArray(nextProject?.storyboard?.acts) ? nextProject.storyboard.acts : [];
  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of scenes) {
        const sceneId = String(scene?.id || '').trim().toLowerCase();
        if (!sceneId || !candidateSet.has(sceneId)) {
          continue;
        }

        scene.imageStatus = 'generating';
        scene.imageError = '';
        scene.imageUpdatedAt = new Date().toISOString();
        scene.imageDiagnosticCode = '';
        scene.imageDiagnosticMessage = '';
      }
    }
  }

  return nextProject;
}

/**
 * After image generation completes, some scenes may still be stuck at
 * 'generating' if their prompt hash didn't change (only non-visual fields
 * were modified). Reset those to 'ready' (if they have an image) or 'idle'.
 */
function resetStuckGeneratingScenes(project) {
  const acts = Array.isArray(project?.storyboard?.acts) ? project.storyboard.acts : [];
  for (const act of acts) {
    for (const seq of (act?.sequences || [])) {
      for (const scene of (seq?.scenes || [])) {
        if (scene.imageStatus === 'generating') {
          scene.imageStatus = scene.imageUrl ? 'ready' : 'idle';
        }
      }
    }
  }
}

function buildScenePreview(project, preferredSceneIds = []) {
  const orderedSceneIds = normalizeStringArray(preferredSceneIds);
  const fallbackSceneIds = collectSceneIds(project?.storyboard);
  const searchList = uniqueStrings([...orderedSceneIds, ...fallbackSceneIds]);

  for (const sceneId of searchList) {
    const lookup = findSceneById(project?.storyboard, sceneId);
    const scene = lookup?.scene;
    if (!scene) {
      continue;
    }

    const imageUrl = String(scene?.imageUrl || '').trim();
    if (!imageUrl) {
      continue;
    }

    return {
      sceneId: scene.id,
      sceneNumber: scene.sceneNumber,
      title: String(scene.title || '').trim() || 'Untitled Shot',
      contextLabel: `Sequence ${lookup.act.number} / Scene ${lookup.sequence.number}`,
      location: String(scene.location || '').trim(),
      mood: String(scene.mood || '').trim(),
      storyFunction: String(scene.storyFunction || '').trim(),
      imageUrl,
      imageStatus: String(scene.imageStatus || 'ready'),
    };
  }

  return null;
}

function applySceneImagePatch(project, sceneId, patch) {
  const nextProject = structuredClone(project);
  const targetScene = findSceneById(nextProject?.storyboard, sceneId)?.scene;
  if (!targetScene || !patch || typeof patch !== 'object') {
    return nextProject;
  }

  Object.assign(targetScene, patch);
  nextProject.updatedAt = new Date().toISOString();
  return nextProject;
}

function collectSceneIdSet(storyboard) {
  const ids = new Set();
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of scenes) {
        const sceneId = String(scene?.id || '').trim().toLowerCase();
        if (sceneId) {
          ids.add(sceneId);
        }
      }
    }
  }
  return ids;
}

function collectChangedSceneIds(beforeStoryboard, afterStoryboard, updates) {
  const ids = new Set();
  const updateList = Array.isArray(updates?.scenes_update) ? updates.scenes_update : [];
  for (const item of updateList) {
    const sceneId = String(item?.sceneId || '').trim().toLowerCase();
    if (sceneId) {
      ids.add(sceneId);
    }
  }

  const addList = Array.isArray(updates?.scenes_add) ? updates.scenes_add : [];
  if (addList.length > 0) {
    const beforeSet = collectSceneIdSet(beforeStoryboard);
    const afterSet = collectSceneIdSet(afterStoryboard);
    for (const sceneId of afterSet) {
      if (!beforeSet.has(sceneId)) {
        ids.add(sceneId);
      }
    }
  }

  return [...ids];
}

function buildAiUpdateSummary(parsed, beforeStoryboard, afterStoryboard) {
  const safeUpdates = parsed?.updates && typeof parsed.updates === 'object' ? parsed.updates : {};

  const beforeIds = collectSceneIds(beforeStoryboard);
  const afterIds = collectSceneIds(afterStoryboard);
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);

  const addedSceneIds = afterIds.filter((id) => !beforeSet.has(id));
  const removedSceneIds = beforeIds.filter((id) => !afterSet.has(id));
  const updatedSceneIds = uniqueStrings(
    (Array.isArray(safeUpdates.scenes_update) ? safeUpdates.scenes_update : []).map(
      (item) => item?.sceneId
    )
  ).filter((id) => afterSet.has(id) && !addedSceneIds.includes(id));

  const sceneDiffById = {};
  for (const sceneId of addedSceneIds) {
    sceneDiffById[sceneId] = 'added';
  }
  for (const sceneId of updatedSceneIds) {
    if (!sceneDiffById[sceneId]) {
      sceneDiffById[sceneId] = 'updated';
    }
  }

  const charactersAdded = Array.isArray(safeUpdates.characters_add) ? safeUpdates.characters_add.length : 0;
  const charactersUpdated = Array.isArray(safeUpdates.characters_update) ? safeUpdates.characters_update.length : 0;
  const locationsAdded = Array.isArray(safeUpdates.locations_add) ? safeUpdates.locations_add.length : 0;
  const locationsUpdated = Array.isArray(safeUpdates.locations_update) ? safeUpdates.locations_update.length : 0;

  return {
    sceneDiffById,
    lastAiUpdate: {
      at: new Date().toISOString(),
      chat: String(parsed?.chat || '').trim(),
      counts: {
        addedScenes: addedSceneIds.length,
        updatedScenes: updatedSceneIds.length,
        removedScenes: removedSceneIds.length,
        charactersAdded,
        charactersUpdated,
        locationsAdded,
        locationsUpdated,
      },
      scenes: {
        added: addedSceneIds,
        updated: updatedSceneIds,
        removed: removedSceneIds,
      },
    },
  };
}



function collectMissingSequences(storyboard) {
  const missing = [];
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      if (scenes.length === 0) {
        missing.push({
          actNumber: act.number,
          number: sequence.number,
          title: sequence.title || `Scene ${sequence.number}`,
        });
      }
    }
  }
  return missing;
}

function enforceSceneMutationPolicy(storyboard, updates, options = {}) {
  const safeUpdates = updates && typeof updates === 'object' ? updates : {};
  const nextUpdates = { ...safeUpdates };
  const editSceneId = String(options?.editSceneId || '').trim();
  const userPrompt = String(options?.userPrompt || '');
  const sceneAdds = Array.isArray(nextUpdates.scenes_add) ? nextUpdates.scenes_add : [];
  const sceneUpdates = Array.isArray(nextUpdates.scenes_update) ? nextUpdates.scenes_update : [];

  if (editSceneId) {
    const targetLookup = findSceneById(storyboard, editSceneId);
    const targetedUpdates = sceneUpdates.filter(
      (entry) => String(entry?.sceneId || '').trim() === editSceneId
    );

    if (targetLookup && targetedUpdates.length === 0 && sceneAdds.length > 0) {
      const fallbackChanges = buildSceneChangesFromAdd(sceneAdds[0], targetLookup.scene);
      if (Object.keys(fallbackChanges).length > 0) {
        targetedUpdates.push({ sceneId: editSceneId, changes: fallbackChanges });
      }
    }

    nextUpdates.scenes_add = [];
    nextUpdates.scenes_remove = [];
    nextUpdates.scenes_update = targetedUpdates;
    return nextUpdates;
  }

  const chatMode = String(options?.chatMode || '').trim();

  if (chatMode === 'lucky') {
    // Autonomous mode: allow all mutations, only dedupe adds.
    nextUpdates.scenes_add = dedupeSceneAdds(sceneAdds, storyboard);
    return nextUpdates;
  }

  // Plan mode (default): chat can add new shots but cannot rewrite/remove existing ones.
  nextUpdates.scenes_update = [];
  nextUpdates.scenes_remove = [];
  const orderedAdds = enforceOrderedSceneAdds(sceneAdds, storyboard, {
    userPrompt,
  });
  const dedupedByTarget = dedupeSceneAdds(orderedAdds, storyboard);
  nextUpdates.scenes_add = preventGlobalShotDuplicates(dedupedByTarget, storyboard, { userPrompt });
  return nextUpdates;
}

function enforceOrderedSceneAdds(additions, storyboard, options = {}) {
  const input = Array.isArray(additions) ? additions : [];
  if (input.length === 0) {
    return [];
  }

  const userPrompt = String(options?.userPrompt || '');
  const maxAdds = extractRequestedShotCount(userPrompt);
  const limited = input.slice(0, maxAdds);
  if (limited.length === 0) {
    return [];
  }

  const explicitTarget = resolvePromptSceneTarget(storyboard, userPrompt);
  const fallbackTarget = getNextSceneGenerationTarget(storyboard);
  const target = explicitTarget || fallbackTarget;
  if (!target) {
    return limited;
  }

  return limited.map((entry) => ({
    ...entry,
    act: target.actNumber,
    sequence: target.sequenceNumber,
  }));
}

function harmonizeStoryOutlineWithChat(parsed) {
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : { chat: '', updates: {} };
  const safeUpdates =
    safeParsed?.updates && typeof safeParsed.updates === 'object' ? safeParsed.updates : {};
  const chatActs = parseStoryOutlineFromChat(safeParsed?.chat);

  if (chatActs.length === 0) {
    return safeParsed;
  }

  return {
    ...safeParsed,
    updates: {
      ...safeUpdates,
      story_outline: { acts: chatActs },
    },
  };
}

function enrichShotUpdatesFromChat(parsed, storyboard, entities) {
  const safeParsed = parsed && typeof parsed === 'object' ? parsed : { chat: '', updates: {} };
  const safeUpdates =
    safeParsed?.updates && typeof safeParsed.updates === 'object' ? safeParsed.updates : {};
  const shotSpec = parseShotSpecFromChat(safeParsed?.chat, entities);
  if (!shotSpec) {
    return safeParsed;
  }

  const sceneAdds = Array.isArray(safeUpdates?.scenes_add) ? safeUpdates.scenes_add : [];
  const sceneUpdates = Array.isArray(safeUpdates?.scenes_update) ? safeUpdates.scenes_update : [];

  if (sceneAdds.length > 0) {
    const nextAdds = sceneAdds.map((item) => ({ ...item }));
    let targetIndex = -1;

    if (shotSpec.actNumber && shotSpec.sequenceNumber) {
      targetIndex = nextAdds.findIndex(
        (item) =>
          Number(item?.act || 0) === Number(shotSpec.actNumber) &&
          Number(item?.sequence || 0) === Number(shotSpec.sequenceNumber)
      );
    }

    if (targetIndex < 0 && shotSpec.title) {
      const targetTitle = String(shotSpec.title || '').trim().toLowerCase();
      targetIndex = nextAdds.findIndex(
        (item) => String(item?.title || '').trim().toLowerCase() === targetTitle
      );
    }

    if (targetIndex < 0) {
      targetIndex = 0;
    }

    nextAdds[targetIndex] = mergeShotSpecIntoSceneAdd(nextAdds[targetIndex], shotSpec);
    return {
      ...safeParsed,
      updates: {
        ...safeUpdates,
        scenes_add: nextAdds,
      },
    };
  }

  if (sceneUpdates.length === 0 && shotSpec.actNumber && shotSpec.sequenceNumber) {
    const targetSequence = findSequenceByNumbers(storyboard, shotSpec.actNumber, shotSpec.sequenceNumber);
    if (!targetSequence) {
      return safeParsed;
    }

    const syntheticAdd = mergeShotSpecIntoSceneAdd(
      {
        act: shotSpec.actNumber,
        sequence: shotSpec.sequenceNumber,
      },
      shotSpec
    );

    return {
      ...safeParsed,
      updates: {
        ...safeUpdates,
        scenes_add: [...sceneAdds, syntheticAdd],
      },
    };
  }

  return safeParsed;
}

function mergeShotSpecIntoSceneAdd(sceneAdd, shotSpec) {
  const next = { ...(sceneAdd && typeof sceneAdd === 'object' ? sceneAdd : {}) };

  if (shotSpec.actNumber) {
    next.act = shotSpec.actNumber;
  }
  if (shotSpec.sequenceNumber) {
    next.sequence = shotSpec.sequenceNumber;
  }
  if (shotSpec.title) {
    next.title = shotSpec.title;
  }
  if (shotSpec.location) {
    next.location = shotSpec.location;
  }
  if (shotSpec.time) {
    next.time = shotSpec.time;
  }
  if (shotSpec.visualDescription) {
    next.visualDescription = shotSpec.visualDescription;
  }
  if (shotSpec.action) {
    next.action = shotSpec.action;
  }
  if (shotSpec.dialogue.length > 0) {
    next.dialogue = shotSpec.dialogue;
  }
  if (shotSpec.mood) {
    next.mood = shotSpec.mood;
  }
  if (shotSpec.storyFunction) {
    next.storyFunction = shotSpec.storyFunction;
  }
  if (shotSpec.characterIds.length > 0) {
    next.characterIds = shotSpec.characterIds;
  }
  if (shotSpec.locationIds.length > 0) {
    next.locationIds = shotSpec.locationIds;
  }

  return next;
}

function parseStoryOutlineFromChat(chatText) {
  const text = String(chatText || '');
  if (!text) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map(cleanOutlineLine)
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const acts = [];
  let currentAct = null;

  for (const line of lines) {
    const sequenceMatch = line.match(/^Sequence\s+(\d+)\s*[:\-–—]\s*(.+)$/i);
    if (sequenceMatch) {
      const actNumber = Number(sequenceMatch[1] || 0);
      const title = String(sequenceMatch[2] || '').trim();
      if (!actNumber || !title) {
        currentAct = null;
        continue;
      }

      currentAct = {
        act: actNumber,
        title,
        sequences: [],
      };
      acts.push(currentAct);
      continue;
    }

    const sceneMatch = line.match(/^Scene\s+(\d+)\s*[:\-–—]\s*(.+)$/i);
    if (!sceneMatch || !currentAct) {
      continue;
    }

    const sceneTitle = String(sceneMatch[2] || '').trim();
    if (!sceneTitle) {
      continue;
    }

    currentAct.sequences.push({
      title: sceneTitle,
    });
  }

  const normalizedActs = acts
    .map((act, index) => ({
      ...act,
      act: Number(act?.act || index + 1),
      title: String(act?.title || '').trim() || `Sequence ${index + 1}`,
      sequences:
        Array.isArray(act?.sequences) && act.sequences.length > 0
          ? act.sequences
          : [{ title: 'New Scene' }],
    }))
    .sort((a, b) => Number(a.act) - Number(b.act));

  return normalizedActs;
}

function cleanOutlineLine(line) {
  return String(line || '')
    .replace(/^\s*[-*•]+\s*/, '')
    .replace(/^#+\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/[`*]/g, '')
    .trim();
}

function parseShotSpecFromChat(chatText, entities) {
  const text = String(chatText || '');
  if (!text) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map(cleanOutlineLine)
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const scRefMatch = text.match(/\bSC\s*(\d+)\s*[.\-/]\s*SC\s*(\d+)\b/i);
  const wordRefMatch = text.match(/\bSequence\s+(\d+)\s*,?\s*Scene\s+(\d+)\b/i);
  const actNumber = Number(scRefMatch?.[1] || wordRefMatch?.[1] || 0);
  const sequenceNumber = Number(scRefMatch?.[2] || wordRefMatch?.[2] || 0);

  const fields = parseShotSpecFields(lines);
  let title = String(fields.title || '').trim();
  if (!title) {
    const byShotLine = lines.find((line) => /^Shot\s*\d+\s*[:\-–—]\s*/i.test(line));
    if (byShotLine) {
      title = byShotLine.replace(/^Shot\s*\d+\s*[:\-–—]\s*/i, '').trim();
    }
  }
  if (!title) {
    const targetLine = lines.find(
      (line) =>
        /\bSC\s*\d+\s*[.\-/]\s*SC\s*\d+\b/i.test(line) ||
        /\bSequence\s+\d+\s*,?\s*Scene\s+\d+\b/i.test(line)
    );
    if (targetLine) {
      const tail = targetLine
        .replace(
          /^.*?\b(?:SC\s*\d+\s*[.\-/]\s*SC\s*\d+|Sequence\s+\d+\s*,?\s*Scene\s+\d+)\b\s*[:\-–—]?\s*/i,
          ''
        )
        .trim();
      title = firstSentence(tail);
    }
  }

  const dialogueLine = String(fields.dialogue || '').trim();
  const characterIds = resolveEntityIds(fields.characters, entities?.characters);
  const locationIds = resolveEntityIds(fields.locations, entities?.locations);

  const shot = {
    actNumber: Number.isFinite(actNumber) && actNumber > 0 ? actNumber : 0,
    sequenceNumber: Number.isFinite(sequenceNumber) && sequenceNumber > 0 ? sequenceNumber : 0,
    title: title || '',
    location: String(fields.location || '').trim(),
    time: String(fields.time || '').trim(),
    visualDescription: String(fields.visualDescription || '').trim(),
    action: String(fields.action || '').trim(),
    dialogue: dialogueLine ? [{ character: '', line: dialogueLine }] : [],
    mood: String(fields.mood || '').trim(),
    storyFunction: String(fields.storyFunction || '').trim(),
    characterIds,
    locationIds,
  };

  const hasPayload = Boolean(
    shot.actNumber ||
    shot.sequenceNumber ||
    shot.title ||
    shot.location ||
    shot.visualDescription ||
    shot.action ||
    shot.storyFunction
  );
  return hasPayload ? shot : null;
}

function parseShotSpecFields(lines) {
  const input = Array.isArray(lines) ? lines : [];
  const labelMap = {
    title: 'title',
    location: 'location',
    time: 'time',
    'visual description': 'visualDescription',
    action: 'action',
    dialogue: 'dialogue',
    mood: 'mood',
    'story function': 'storyFunction',
    characters: 'characters',
    locations: 'locations',
  };

  const fields = {};
  let currentKey = '';

  for (const line of input) {
    const labelMatch = line.match(
      /^(title|location|time|visual description|action|dialogue|mood|story function|characters|locations)\s*[:\-–—]\s*(.*)$/i
    );
    if (labelMatch) {
      const rawLabel = String(labelMatch[1] || '').trim().toLowerCase();
      const mapped = labelMap[rawLabel] || '';
      currentKey = mapped;
      if (currentKey) {
        fields[currentKey] = String(labelMatch[2] || '').trim();
      }
      continue;
    }

    if (!currentKey) {
      continue;
    }

    if (/^Shot\s*\d+\s*[:\-–—]/i.test(line) || /^Sequence\s+\d+\s*[:\-–—]/i.test(line)) {
      currentKey = '';
      continue;
    }

    fields[currentKey] = `${fields[currentKey] || ''} ${line}`.trim();
  }

  return fields;
}

function resolveEntityIds(rawValue, list) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return [];
  }

  const ids = [];
  const parenMatches = value.matchAll(/\(([^)]+)\)/g);
  for (const match of parenMatches) {
    const group = String(match?.[1] || '').trim();
    if (!group) {
      continue;
    }
    for (const token of group.split(/[;,]/g)) {
      const clean = String(token || '').trim();
      if (clean) {
        ids.push(clean);
      }
    }
  }

  if (ids.length > 0) {
    return uniqueStrings(ids);
  }

  const entities = Array.isArray(list) ? list : [];
  const normalized = value.toLowerCase();
  const resolved = [];
  for (const entry of entities) {
    const id = String(entry?.id || '').trim();
    const name = String(entry?.name || '').trim();
    if (!id || !name) {
      continue;
    }
    const needle = name.toLowerCase();
    if (needle && normalized.includes(needle)) {
      resolved.push(id);
    }
  }

  return uniqueStrings(resolved);
}

function firstSentence(text) {
  const value = String(text || '').trim();
  if (!value) {
    return '';
  }
  const [first] = value.split(/[.!?]/);
  return String(first || '').trim();
}

function dedupeSceneAdds(additions, storyboard) {
  const input = Array.isArray(additions) ? additions : [];
  const seen = new Set();
  const filtered = [];

  for (const entry of input) {
    const actNumber = Number(entry?.act || 0);
    const sequenceNumber = Number(entry?.sequence || 0);
    const identity = getSceneIdentity(entry);
    if (!actNumber || !sequenceNumber || !identity) {
      filtered.push(entry);
      continue;
    }

    const signature = `${actNumber}:${sequenceNumber}:${identity}`;
    if (seen.has(signature)) {
      continue;
    }

    const targetSequence = findSequenceByNumbers(storyboard, actNumber, sequenceNumber);
    const existsAlready = Array.isArray(targetSequence?.scenes)
      ? targetSequence.scenes.some((scene) => getSceneIdentity(scene) === identity)
      : false;
    if (existsAlready) {
      continue;
    }

    seen.add(signature);
    filtered.push(entry);
  }

  return filtered;
}

function preventGlobalShotDuplicates(additions, storyboard, options = {}) {
  const input = Array.isArray(additions) ? additions : [];
  if (input.length === 0) {
    return [];
  }

  const userPrompt = String(options?.userPrompt || '').trim();
  const existing = collectStoryboardShotMetadata(storyboard);
  const pendingIdentities = new Set();
  const pendingTitles = new Set();
  const result = [];

  for (const [index, rawEntry] of input.entries()) {
    let entry = rawEntry && typeof rawEntry === 'object' ? { ...rawEntry } : {};
    const actNumber = Number(entry?.act || 0);
    const sequenceNumber = Number(entry?.sequence || 0);
    const targetSequence =
      actNumber && sequenceNumber ? findSequenceByNumbers(storyboard, actNumber, sequenceNumber) : null;

    const identity = normalizeSceneIdentityKey(getSceneIdentity(entry));
    const isKnownDuplicate = Boolean(
      identity && (existing.identities.has(identity) || pendingIdentities.has(identity))
    );
    if (isKnownDuplicate) {
      entry = rewriteDuplicateShotFromContext(entry, targetSequence, userPrompt, index + 1);
    }

    const baseTitle =
      String(entry?.title || '').trim() || deriveSceneTitleFromTargetSequence(targetSequence, index + 1);
    entry.title = makeUniqueShotTitleFromSets(baseTitle, existing.titles, pendingTitles);

    const repairedIdentity = normalizeSceneIdentityKey(getSceneIdentity(entry));
    if (
      repairedIdentity &&
      (existing.identities.has(repairedIdentity) || pendingIdentities.has(repairedIdentity))
    ) {
      continue;
    }

    if (repairedIdentity) {
      pendingIdentities.add(repairedIdentity);
    }
    if (entry.title) {
      pendingTitles.add(String(entry.title).toLowerCase());
    }

    result.push(entry);
  }

  return result;
}

function collectStoryboardShotMetadata(storyboard) {
  const identities = new Set();
  const titles = new Set();
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];

  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
      for (const scene of scenes) {
        const identity = normalizeSceneIdentityKey(getSceneIdentity(scene));
        if (identity) {
          identities.add(identity);
        }
        const title = String(scene?.title || '').trim().toLowerCase();
        if (title) {
          titles.add(title);
        }
      }
    }
  }

  return { identities, titles };
}

function normalizeSceneIdentityKey(identity) {
  return String(identity || '').trim().toLowerCase();
}

function rewriteDuplicateShotFromContext(entry, targetSequence, userPrompt, index) {
  const next = { ...(entry && typeof entry === 'object' ? entry : {}) };
  const sceneTitle = deriveSceneTitleFromTargetSequence(targetSequence, index);

  next.title = sceneTitle;
  next.storyFunction = `Advance "${sceneTitle}" with a distinct new beat.`;
  if (!String(next?.action || '').trim()) {
    next.action = `Show a fresh moment that moves "${sceneTitle}" forward.`;
  }
  if (!String(next?.visualDescription || '').trim()) {
    next.visualDescription = `Cinematic storyboard frame centered on ${sceneTitle}.`;
  }

  const promptHint = firstSentence(userPrompt);
  if (promptHint && promptHint.length > 0 && !String(next?.mood || '').trim()) {
    next.mood = promptHint;
  }

  return next;
}

function deriveSceneTitleFromTargetSequence(targetSequence, fallbackIndex = 1) {
  const title = String(targetSequence?.title || '').trim();
  if (title) {
    return title;
  }
  const seqNumber = Number(targetSequence?.number || 0);
  if (seqNumber) {
    return `Scene ${seqNumber} Beat`;
  }
  return `New Shot ${Math.max(1, Number(fallbackIndex) || 1)}`;
}

function makeUniqueShotTitleFromSets(baseTitle, existingTitles, pendingTitles) {
  const root = String(baseTitle || '').trim() || 'New Shot';
  const existing = existingTitles instanceof Set ? existingTitles : new Set();
  const pending = pendingTitles instanceof Set ? pendingTitles : new Set();
  const lower = root.toLowerCase();

  if (!existing.has(lower) && !pending.has(lower)) {
    return root;
  }

  let index = 2;
  let next = `${root} (${index})`;
  while (existing.has(next.toLowerCase()) || pending.has(next.toLowerCase())) {
    index += 1;
    next = `${root} (${index})`;
  }
  return next;
}

function getSceneIdentity(sceneLike) {
  const titleKey = normalizeKeyPart(sceneLike?.title);
  const fingerprint = buildSceneFingerprint(sceneLike);
  if (titleKey && fingerprint) {
    return `${titleKey}|${fingerprint}`;
  }
  return titleKey || fingerprint;
}

function extractSceneEditId(text) {
  const content = String(text || '');
  const match = content.match(/Edit shot context ID:\s*([A-Za-z0-9_-]+)/i);
  return match ? String(match[1] || '').trim() : '';
}

function buildSceneChangesFromAdd(entry, existingScene) {
  const current = existingScene && typeof existingScene === 'object' ? existingScene : {};
  const changes = {};

  const title = String(entry?.title || '').trim();
  const location = String(entry?.location || '').trim();
  const time = String(entry?.time || '').trim();
  const visualDescription = String(entry?.visualDescription || '').trim();
  const action = String(entry?.action || '').trim();
  const mood = String(entry?.mood || '').trim();
  const storyFunction = String(entry?.storyFunction || '').trim();

  if (title && title !== String(current.title || '')) {
    changes.title = title;
  }
  if (location && location !== String(current.location || '')) {
    changes.location = location;
  }
  if (time && time !== String(current.time || '')) {
    changes.time = time;
  }
  if (visualDescription && visualDescription !== String(current.visualDescription || '')) {
    changes.visualDescription = visualDescription;
  }
  if (action && action !== String(current.action || '')) {
    changes.action = action;
  }
  if (mood && mood !== String(current.mood || '')) {
    changes.mood = mood;
  }
  if (storyFunction && storyFunction !== String(current.storyFunction || '')) {
    changes.storyFunction = storyFunction;
  }

  const dialogue = normalizeDialogue(entry?.dialogue);
  if (dialogue.length > 0) {
    changes.dialogue = dialogue;
  }

  const characterIds = normalizeStringArray(entry?.characterIds);
  if (characterIds.length > 0) {
    changes.characterIds = characterIds;
  }

  const locationIds = normalizeStringArray(entry?.locationIds);
  if (locationIds.length > 0) {
    changes.locationIds = locationIds;
  }

  return changes;
}

function normalizeDialogue(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((line) => ({
      character: String(line?.character || '').trim(),
      line: String(line?.line || '').trim(),
    }))
    .filter((line) => line.character || line.line);
}

function extractStreamingChat(raw) {
  const text = String(raw || '');
  if (!text) {
    return '';
  }

  // Find the start of the "chat" value in the JSON
  const marker = '"chat"';
  const markerIdx = text.indexOf(marker);
  if (markerIdx === -1) {
    return '';
  }

  // Skip past "chat" : "
  let i = markerIdx + marker.length;
  // Skip whitespace and colon
  while (i < text.length && (text[i] === ' ' || text[i] === ':' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')) {
    i++;
  }
  if (i >= text.length || text[i] !== '"') {
    return '';
  }
  i++; // skip opening quote

  // Read the string value, handling escape sequences
  let result = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '"') { result += '"'; i += 2; continue; }
      if (next === '\\') { result += '\\'; i += 2; continue; }
      if (next === 'n') { result += '\n'; i += 2; continue; }
      if (next === 't') { result += '\t'; i += 2; continue; }
      if (next === 'r') { result += '\r'; i += 2; continue; }
      result += next;
      i += 2;
      continue;
    }
    if (ch === '"') {
      break; // end of string
    }
    result += ch;
    i++;
  }

  return result;
}

/**
 * Derive a human-readable phase label from what the model has streamed so far.
 *
 * The model emits JSON in roughly this order:
 *   "chat"          → always first
 *   story_outline   → if bootstrapping / restructuring
 *   acts_update     → optional
 *   sequences_add   → new Scenes being created
 *   sequences_update→ Scene renames/edits
 *   characters_add  → new characters being written
 *   characters_update → bible rewrites
 *   locations_add   → new locations
 *   locations_update → location rewrites
 *   scenes_add      → Panels being blocked out
 *   scenes_update   → Panel edits
 *
 * We surface whichever stage is the LAST one seen, so the status label tracks
 * real progress. Counts (2/8 Panels drafted) are parsed where feasible.
 */
function derivePhaseFromStream(fullText, partialChat) {
  const text = String(fullText || '');
  const hasChat = !!partialChat;

  // Count occurrences of "id" inside scenes_add to estimate Panels drafted
  // so far. It's an approximation — streaming JSON isn't valid until closed —
  // but it correlates tightly with progress.
  const panelsDrafted = countStreamedPanels(text);

  // Check for the presence of each major section, in emit order.
  const sections = [
    { key: 'scenes_update', status: 'Refining Panels...', phase: 'panels_update', detail: 'Tightening existing storyboard Panels.' },
    { key: 'scenes_add', status: panelsDrafted ? `Blocking Panels... (${panelsDrafted} drafted)` : 'Blocking Panels...', phase: 'panels_add', detail: 'Writing each Panel\'s visuals, action, and mood.' },
    { key: 'locations_update', status: 'Rewriting location bibles...', phase: 'locations_update', detail: 'Propagating the world\'s visual language.' },
    { key: 'locations_add', status: 'Building the world...', phase: 'locations_add', detail: 'Establishing locations with reusable visual anchors.' },
    { key: 'characters_update', status: 'Rewriting character bibles...', phase: 'characters_update', detail: 'Updating character designs for continuity.' },
    { key: 'characters_add', status: 'Casting characters...', phase: 'characters_add', detail: 'Designing the people at the heart of the story.' },
    { key: 'sequences_add', status: 'Mapping Scenes...', phase: 'scenes_add', detail: 'Laying out the Scenes inside each Act.' },
    { key: 'story_outline', status: 'Shaping the arc...', phase: 'outline', detail: 'Drafting the three-Act spine of the story.' },
  ];

  // Pick the last emitted section (highest priority in emit order).
  for (const section of sections) {
    if (text.includes(`"${section.key}"`)) {
      return {
        status: section.status,
        phase: section.phase,
        detail: section.detail,
      };
    }
  }

  // No structural keys seen yet — still in the opening chat/planning phase.
  if (hasChat) {
    return {
      status: 'Drafting response...',
      phase: 'drafting',
      detail: 'Streaming the reply while Storyboarder prepares storyboard updates.',
    };
  }

  return {
    status: 'Planning storyboard...',
    phase: 'planning',
    detail: 'Waiting for the first draft from the planner.',
  };
}

/**
 * Rough count of Panel objects that have appeared in the stream so far.
 * Counts occurrences of \`"title"\` within the scenes_add block. Not perfect —
 * but close enough for a progress counter and never undercounts.
 */
function countStreamedPanels(text) {
  const addIdx = text.indexOf('"scenes_add"');
  if (addIdx === -1) return 0;
  // Look for the matching closing bracket — fall back to end-of-text if the
  // stream hasn't closed it yet.
  const slice = text.slice(addIdx);
  // Count title fields as a proxy for "one Panel emitted."
  const matches = slice.match(/"title"\s*:/g);
  return matches ? matches.length : 0;
}

function collectSequenceSlots(storyboard) {
  const slots = [];
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    const actNumber = Number(act?.number || 0);
    if (!actNumber) {
      continue;
    }
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    for (const sequence of sequences) {
      const sequenceNumber = Number(sequence?.number || 0);
      if (!sequenceNumber) {
        continue;
      }
      const shotCount = Array.isArray(sequence?.scenes) ? sequence.scenes.length : 0;
      slots.push({
        actNumber,
        sequenceNumber,
        shotCount,
      });
    }
  }
  return slots;
}

function getNextSceneGenerationTarget(storyboard) {
  const slots = collectSequenceSlots(storyboard);
  if (slots.length === 0) {
    return null;
  }

  const firstMissing = slots.find((slot) => slot.shotCount === 0);
  if (firstMissing) {
    return {
      actNumber: firstMissing.actNumber,
      sequenceNumber: firstMissing.sequenceNumber,
    };
  }

  let minShots = slots[0]?.shotCount ?? 0;
  for (const slot of slots) {
    minShots = Math.min(minShots, slot.shotCount);
  }

  const next = slots.find((slot) => slot.shotCount === minShots) || slots[0];
  if (!next) {
    return null;
  }

  return {
    actNumber: next.actNumber,
    sequenceNumber: next.sequenceNumber,
  };
}

function findNextTargetInAct(storyboard, actNumber) {
  const targetAct = Number(actNumber || 0);
  if (!targetAct) {
    return null;
  }

  const slots = collectSequenceSlots(storyboard).filter(
    (slot) => Number(slot.actNumber) === Number(targetAct)
  );
  if (slots.length === 0) {
    return null;
  }

  const firstMissing = slots.find((slot) => slot.shotCount === 0);
  if (firstMissing) {
    return {
      actNumber: firstMissing.actNumber,
      sequenceNumber: firstMissing.sequenceNumber,
    };
  }

  let minShots = slots[0]?.shotCount ?? 0;
  for (const slot of slots) {
    minShots = Math.min(minShots, slot.shotCount);
  }

  const next = slots.find((slot) => slot.shotCount === minShots) || slots[0];
  if (!next) {
    return null;
  }

  return {
    actNumber: next.actNumber,
    sequenceNumber: next.sequenceNumber,
  };
}

function resolvePromptSceneTarget(storyboard, userPrompt) {
  const focusSceneTarget = extractFocusSceneTarget(userPrompt);
  if (focusSceneTarget && findSequenceByNumbers(storyboard, focusSceneTarget.actNumber, focusSceneTarget.sequenceNumber)) {
    return focusSceneTarget;
  }

  const explicitSceneTarget = extractExplicitSceneTarget(userPrompt);
  if (
    explicitSceneTarget &&
    findSequenceByNumbers(storyboard, explicitSceneTarget.actNumber, explicitSceneTarget.sequenceNumber)
  ) {
    return explicitSceneTarget;
  }

  const focusActTarget = extractFocusActTarget(userPrompt);
  if (focusActTarget) {
    return findNextTargetInAct(storyboard, focusActTarget.actNumber);
  }

  return null;
}

function extractFocusSceneTarget(text) {
  const content = String(text || '');
  const match = content.match(/\[FOCUS_SCENE\]\s*Sequence\s+(\d+)\s*,\s*Scene\s+(\d+)/i);
  if (!match) {
    return null;
  }

  const actNumber = Number(match[1] || 0);
  const sequenceNumber = Number(match[2] || 0);
  if (!actNumber || !sequenceNumber) {
    return null;
  }

  return {
    actNumber,
    sequenceNumber,
  };
}

function extractFocusActTarget(text) {
  const content = String(text || '');
  const match = content.match(/\[FOCUS_SEQUENCE\]\s*Sequence\s+(\d+)/i);
  if (!match) {
    return null;
  }

  const actNumber = Number(match[1] || 0);
  if (!actNumber) {
    return null;
  }

  return { actNumber };
}

function extractExplicitSceneTarget(text) {
  const content = String(text || '');
  const match = content.match(/for\s+Sequence\s+(\d+)\s*,\s*Scene\s+(\d+)/i);
  if (!match) {
    return null;
  }

  const actNumber = Number(match[1] || 0);
  const sequenceNumber = Number(match[2] || 0);
  if (!actNumber || !sequenceNumber) {
    return null;
  }

  return {
    actNumber,
    sequenceNumber,
  };
}

function extractRequestedShotCount(text) {
  const content = String(text || '');
  const explicit = content.match(/\b(?:generate|add|create)\s+(\d+)\s+shot(?:s)?\b/i);
  if (!explicit) {
    return 1;
  }

  const count = Number(explicit[1] || 1);
  if (!Number.isFinite(count) || count <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(count, 5));
}

let sceneDiffResetTimer = null;
let persistQueue = Promise.resolve();
let persistRequestId = 0;

export const useProjectStore = create((set, get) => ({
  projectIndex: [],
  activeProject: null,
  selectedSceneId: null,
  isStreaming: false,
  streamingText: '',
  isSending: false,
  processingStatus: '',
  processingPhase: 'idle',
  processingDetail: '',
  sceneDiffById: {},
  lastAiUpdate: null,

  init: async () => {
    const index = sortByUpdatedDesc(await listProjects());

    if (index.length === 0) {
      // No projects found — create a starter project
      const starter = createProject('My First Story', getActiveUserId());
      await saveProject(starter);
      const updatedIndex = sortByUpdatedDesc(await listProjects());
      set({
        projectIndex: updatedIndex,
        activeProject: starter,
        selectedSceneId: null,
        sceneDiffById: {},
        lastAiUpdate: null,
      });
      return;
    }

    const first = await loadProject(index[0].id);
    set({
      projectIndex: index,
      activeProject: normalizeProject(first),
      selectedSceneId: null,
      sceneDiffById: {},
      lastAiUpdate: null,
    });
  },

  refreshProjectIndex: async () => {
    const index = sortByUpdatedDesc(await listProjects());
    set({ projectIndex: index });
  },

  createProject: async (name) => {
    const project = createProject(String(name || '').trim() || 'New Story', getActiveUserId());
    await saveProject(project);
    const index = sortByUpdatedDesc(await listProjects());
    set({
      projectIndex: index,
      activeProject: project,
      selectedSceneId: null,
      sceneDiffById: {},
      lastAiUpdate: null,
    });
    return project;
  },

  switchProject: async (projectId) => {
    const project = normalizeProject(await loadProject(projectId));
    if (!project) {
      return;
    }

    set({
      activeProject: project,
      selectedSceneId: null,
      streamingText: '',
      isStreaming: false,
      isSending: false,
      processingStatus: '',
      processingPhase: 'idle',
      processingDetail: '',
      sceneDiffById: {},
      lastAiUpdate: null,
    });
  },

  renameActiveProject: async (name) => {
    const activeProject = get().activeProject;
    if (!activeProject) {
      return;
    }

    const clean = String(name || '').trim();
    if (!clean) {
      return;
    }

    const nextProject = {
      ...activeProject,
      name: clean,
      updatedAt: new Date().toISOString(),
    };

    await saveProject(nextProject);
    set({ activeProject: nextProject });
    await get().refreshProjectIndex();
  },

  renameProjectById: async (projectId, name) => {
    const targetId = String(projectId || '').trim();
    const clean = String(name || '').trim();
    if (!targetId || !clean) {
      return;
    }

    const activeProject = get().activeProject;
    if (activeProject?.id === targetId) {
      await get().renameActiveProject(clean);
      return;
    }

    const loaded = normalizeProject(await loadProject(targetId));
    if (!loaded) {
      return;
    }

    const nextProject = {
      ...loaded,
      name: clean,
      updatedAt: new Date().toISOString(),
    };

    await saveProject(nextProject);
    await get().refreshProjectIndex();
  },

  deleteProjectById: async (projectId) => {
    await deleteProject(projectId);
    const index = sortByUpdatedDesc(await listProjects());

    let nextProject = null;
    if (index.length > 0) {
      nextProject = normalizeProject(await loadProject(index[0].id));
    }

    set({
      projectIndex: index,
      activeProject: nextProject,
      selectedSceneId: null,
      streamingText: '',
      isStreaming: false,
      isSending: false,
      processingStatus: '',
      processingPhase: 'idle',
      processingDetail: '',
      sceneDiffById: {},
      lastAiUpdate: null,
    });

    if (!nextProject) {
      const starter = createProject('New Story');
      await saveProject(starter);
      const withStarter = sortByUpdatedDesc(await listProjects());
      set({
        projectIndex: withStarter,
        activeProject: starter,
        sceneDiffById: {},
        lastAiUpdate: null,
      });
    }
  },

  deleteActiveProject: async () => {
    const activeProject = get().activeProject;
    if (!activeProject) {
      return;
    }
    await get().deleteProjectById(activeProject.id);
  },

  selectScene: (sceneId) => {
    set({ selectedSceneId: sceneId || null });
  },

  clearSelection: () => {
    set({ selectedSceneId: null });
  },

  clearChatHistory: async () => {
    const activeProject = get().activeProject;
    if (!activeProject) {
      return;
    }

    const now = new Date().toISOString();
    const assistantIntro =
      activeProject.messages.find((message) => message.role === 'assistant')?.content ||
      "What story are we building? Give me a premise, a genre, a vibe — or just a title if it's a classic. I'll start setting up your characters, world, and sequence structure right away.";

    const nextProject = {
      ...activeProject,
      messages: [
        {
          role: 'assistant',
          content: assistantIntro,
          timestamp: now,
        },
      ],
      updatedAt: now,
    };

    await saveProject(nextProject);
    set({
      activeProject: nextProject,
      isStreaming: false,
      streamingText: '',
      isSending: false,
      processingStatus: '',
      processingPhase: 'idle',
      processingDetail: '',
      sceneDiffById: {},
      lastAiUpdate: null,
    });
    await get().refreshProjectIndex();
  },

  saveCurrentProject: async () => {
    persistRequestId += 1;
    const requestId = persistRequestId;

    persistQueue = persistQueue
      .catch(() => {
        // Keep queue alive after previous failure.
      })
      .then(async () => {
        if (requestId < persistRequestId) {
          return;
        }

        const activeProject = get().activeProject;
        if (!activeProject) {
          return;
        }

        const now = new Date().toISOString();
        const nextProject = {
          ...activeProject,
          updatedAt: now,
        };

        await saveProject(nextProject);

        set((state) => {
          const current = state.activeProject;
          if (!current || String(current.id || '') !== String(nextProject.id || '')) {
            return {};
          }
          return {
            activeProject: {
              ...current,
              updatedAt: now,
            },
          };
        });

        if (requestId === persistRequestId) {
          await get().refreshProjectIndex();
        }
      });

    await persistQueue;
  },

  setActiveProject: (updater) => {
    const activeProject = get().activeProject;
    if (!activeProject) {
      return;
    }

    const nextProject = normalizeProject(
      typeof updater === 'function' ? updater(activeProject) : updater
    );

    if (!nextProject) {
      return;
    }

    set({ activeProject: nextProject });
  },

  sendUserMessage: async (userText, opts = {}) => {
    const activeProject = get().activeProject;
    const settings = useSettingsStore.getState();
    const visibleBase = opts?.visibleContent ?? (opts?.isSystem ? '' : userText ?? '');
    const apiBase = opts?.apiContent ?? (userText ?? '');
    const visibleContent = String(visibleBase || '').trim();
    const apiContent = String(apiBase || '').trim();
    const providerKeys = settings?.providerKeys || {};
    const planningProvider = settings?.planningProvider || 'openrouter';
    const hasClientApiKey = Boolean(String(providerKeys[planningProvider] || '').trim());

    if (!activeProject || !apiContent) {
      return;
    }

    // Auto-title: on the first real user message, generate a title in the background
    const isFirstUserMessage =
      !opts?.isSystem &&
      visibleContent &&
      !activeProject.messages.some((m) => m.role === 'user');

    if (isFirstUserMessage) {
      generateTitle(visibleContent)
        .then((title) => { if (title) get().renameActiveProject(title); })
        .catch(() => { });
    }

    const visibleMessage = visibleContent
      ? createUserMessage(visibleContent, {
        isSystem: false,
        hidden: Boolean(opts?.hidden),
      })
      : null;

    if (!hasClientApiKey) {
      const errorProject = {
        ...activeProject,
        messages: [
          ...activeProject.messages,
          ...(visibleMessage ? [visibleMessage] : []),
          ...(
            visibleMessage
              ? [
                createAssistantMessage(
                  'Add an API key in Settings to start AI storyboard generation.'
                ),
              ]
              : []
          ),
        ],
        updatedAt: new Date().toISOString(),
      };

      await saveProject(errorProject);
      set({
        activeProject: errorProject,
        streamingText: '',
        isStreaming: false,
        isSending: false,
        processingStatus: '',
        processingPhase: 'idle',
        processingDetail: '',
        sceneDiffById: {},
        lastAiUpdate: {
          at: new Date().toISOString(),
          chat: 'AI request blocked: API key missing.',
          counts: {
            addedScenes: 0,
            updatedScenes: 0,
            removedScenes: 0,
            charactersAdded: 0,
            charactersUpdated: 0,
            locationsAdded: 0,
            locationsUpdated: 0,
          },
          scenes: { added: [], updated: [], removed: [] },
        },
      });
      await get().refreshProjectIndex();
      return;
    }

    const projectWithUser = {
      ...activeProject,
      messages: [...activeProject.messages, ...(visibleMessage ? [visibleMessage] : [])],
      updatedAt: new Date().toISOString(),
    };

    set({
      activeProject: projectWithUser,
      isStreaming: true,
      isSending: true,
      streamingText: '',
      processingStatus: 'Planning storyboard...',
      processingPhase: 'planning',
      processingDetail: 'Sending your prompt to Gemini and mapping the next storyboard changes.',
      sceneDiffById: {},
    });

    await saveProject(projectWithUser);
    await get().refreshProjectIndex();

    const { chatMode } = useSettingsStore.getState();
    const systemPrompt = buildSystemPrompt(projectWithUser.storyboard, projectWithUser.entities, chatMode);

    const apiMessages = buildApiMessages(
      projectWithUser.messages,
      !visibleMessage || apiContent !== visibleContent ? apiContent : ''
    );

    await sendMessage({
      model: settings.planningModel,
      systemPrompt,
      messages: apiMessages,
      onToken: (_delta, fullText) => {
        const partialChat = extractStreamingChat(fullText);
        // Derive the phase from what the model has already emitted in the stream.
        // As the JSON grows, we see new keys appear in order: story_outline →
        // characters_add → locations_add → scenes_add. Use their presence as a
        // real-time progress signal so the user knows work is progressing.
        const phase = derivePhaseFromStream(fullText, partialChat);
        set({
          streamingText: partialChat,
          processingStatus: phase.status,
          processingPhase: phase.phase,
          processingDetail: phase.detail,
        });
      },
      onDone: async (fullText) => {
        const baseProject = resolveLiveProjectBase(get, projectWithUser);
        const parsed = enrichShotUpdatesFromChat(
          harmonizeStoryOutlineWithChat(parseAIResponse(fullText)),
          baseProject.storyboard,
          baseProject.entities
        );
        const updates = enforceSceneMutationPolicy(baseProject.storyboard, parsed.updates || {}, {
          editSceneId: extractSceneEditId(apiContent),
          chatMode,
          userPrompt: apiContent,
        });
        const parsedWithPolicy = { ...parsed, updates };
        let updated = applyUpdates(baseProject, updates);
        const changedSceneIds = collectChangedSceneIds(
          baseProject.storyboard,
          updated.storyboard,
          updates
        );
        const shouldGenerateImages =
          !updated?.imageFreeMode &&
          changedSceneIds.length > 0 &&
          (hasClientApiKey || canUseHostedDemo);

        if (shouldGenerateImages) {
          updated = markSceneImagesGenerating(updated, changedSceneIds);
        }

        updated = appendAssistantReply(updated, parsed.chat || 'Updated storyboard.');
        updated.updatedAt = new Date().toISOString();
        const aiSummary = buildAiUpdateSummary(
          parsedWithPolicy,
          baseProject.storyboard,
          updated.storyboard
        );

        await saveProject(updated);
        const textReadyIndex = sortByUpdatedDesc(await listProjects());

        set({
          activeProject: updated,
          projectIndex: textReadyIndex,
          isStreaming: false,
          streamingText: '',
          isSending: shouldGenerateImages,
          processingStatus: shouldGenerateImages ? 'Generating scene previews...' : '',
          processingPhase: shouldGenerateImages ? 'rendering' : 'idle',
          processingDetail: shouldGenerateImages
            ? `Rendering ${changedSceneIds.length} updated preview${changedSceneIds.length === 1 ? '' : 's'} in the background.`
            : '',
          sceneDiffById: aiSummary.sceneDiffById,
          lastAiUpdate: aiSummary.lastAiUpdate,
        });

        let generatedProject = updated;
        let previewSceneIds = changedSceneIds;

        if (shouldGenerateImages) {
          const imageResult = await regenerateSceneImages(updated, {
            imageModel: settings.imageModel,
            candidateSceneIds: changedSceneIds,
            concurrency: 2,
            maxAttempts: 3,
            onProgress: (progress) => {
              set((state) => {
                const nextState = {
                  processingStatus: 'Generating scene previews...',
                  processingPhase: 'rendering',
                  processingDetail: buildRenderingDetail(progress),
                };

                if (progress?.stage !== 'completed' || !progress?.scenePatch) {
                  return nextState;
                }

                const liveBase = resolveLiveProjectBase(() => state, updated);
                let partialProject = applySceneImagePatch(
                  liveBase,
                  progress.sceneId,
                  progress.scenePatch
                );
                const inlinePreview = buildScenePreview(partialProject, [
                  progress.sceneId,
                  ...changedSceneIds,
                ]);
                partialProject = attachPreviewToLastAssistantMessage(partialProject, inlinePreview);

                nextState.activeProject = partialProject;
                return nextState;
              });
            },
          });
          generatedProject = imageResult.project;
          // Reset any scenes still stuck at 'generating' that weren't actually
          // regenerated (e.g. only non-visual fields changed so the prompt hash
          // matched and shouldRegenerate returned false).
          resetStuckGeneratingScenes(generatedProject);
          previewSceneIds =
            imageResult.updatedSceneIds.length > 0
              ? imageResult.updatedSceneIds
              : changedSceneIds;
        }

        const inlinePreview = buildScenePreview(generatedProject, previewSceneIds);
        generatedProject = attachPreviewToLastAssistantMessage(generatedProject, inlinePreview);

        await saveProject(generatedProject);
        const index = sortByUpdatedDesc(await listProjects());

        set({
          activeProject: generatedProject,
          projectIndex: index,
          isStreaming: false,
          streamingText: '',
          isSending: false,
          processingStatus: '',
          processingPhase: 'idle',
          processingDetail: '',
          sceneDiffById: aiSummary.sceneDiffById,
          lastAiUpdate: aiSummary.lastAiUpdate,
        });

        if (sceneDiffResetTimer) {
          clearTimeout(sceneDiffResetTimer);
        }
        sceneDiffResetTimer = setTimeout(() => {
          const currentProjectId = get().activeProject?.id;
          if (currentProjectId === generatedProject.id) {
            set({ sceneDiffById: {} });
          }
        }, 5000);

      },
      onError: async (error) => {
        console.error('[Storyboarder] Chat onError triggered — this message will appear in chat:', {
          errorMessage: typeof error === 'string' ? error : error?.message,
          errorName: error?.name,
          timestamp: new Date().toISOString(),
        });
        const baseProject = resolveLiveProjectBase(get, projectWithUser);
        const errorMessage = typeof error === 'string' ? error : (error?.message || 'Unable to process request.');
        if (!visibleMessage) {
          set({
            activeProject: baseProject,
            isStreaming: false,
            streamingText: '',
            isSending: false,
            processingStatus: '',
            processingPhase: 'idle',
            processingDetail: '',
            sceneDiffById: {},
          });
          return;
        }

        const fallback = appendAssistantReply(
          baseProject,
          errorMessage
        );
        fallback.updatedAt = new Date().toISOString();

        await saveProject(fallback);
        const index = sortByUpdatedDesc(await listProjects());

        set({
          activeProject: fallback,
          projectIndex: index,
          isStreaming: false,
          streamingText: '',
          isSending: false,
          processingStatus: '',
          processingPhase: 'idle',
          processingDetail: '',
          sceneDiffById: {},
          lastAiUpdate: {
            at: new Date().toISOString(),
            chat: errorMessage,
            counts: {
              addedScenes: 0,
              updatedScenes: 0,
              removedScenes: 0,
              charactersAdded: 0,
              charactersUpdated: 0,
              locationsAdded: 0,
              locationsUpdated: 0,
            },
            scenes: { added: [], updated: [], removed: [] },
          },
        });
      },
    });
  },

  autoFillMissingSequences: async () => {
    const activeProject = get().activeProject;
    if (!activeProject || get().isSending) {
      return;
    }

    const missing = collectMissingSequences(activeProject.storyboard);
    if (missing.length === 0) {
      return;
    }

    const list = missing
      .map((item) => `Sequence ${item.actNumber}, Scene ${item.number} (${item.title})`)
      .join(', ');

    const instruction = [
      'Expand this into a fuller storyboard draft.',
      `Fill missing scenes: ${list}.`,
      'For each missing scene add at least one concise shot with title, location, time, visualDescription, action, mood, storyFunction, characterIds, and locationIds.',
      'Terminology mapping: `act` = Sequence, `sequence` = Scene, each `scenes_add` item = Shot.',
      'Keep continuity with existing shots and entities.',
      'Do not rewrite existing shots unless needed for continuity.',
    ].join(' ');

    await get().sendUserMessage(instruction, { isSystem: true });
  },

  setImageFreeMode: async (enabled) => {
    get().setActiveProject((project) => {
      if (!project) return project;
      return { ...project, imageFreeMode: Boolean(enabled) };
    });
    await get().saveCurrentProject();
  },
}));

function normalizeProject(project) {
  if (!project || typeof project !== 'object') {
    return null;
  }

  const storyboard = normalizeStoryboard(project.storyboard || createEmptyStoryboard());
  const entities = project.entities || createEmptyEntities();

  return {
    ...project,
    userId: String(project.userId || getActiveUserId()),
    messages: normalizeMessages(project.messages),
    storyboard,
    entities: {
      characters: Array.isArray(entities.characters) ? entities.characters : [],
      locations: Array.isArray(entities.locations) ? entities.locations : [],
    },
    imageFreeMode: Boolean(project?.imageFreeMode),
    updatedAt: project.updatedAt || new Date().toISOString(),
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => {
      const originalContent = String(message.content || '');
      const isSystem = Boolean(message.isSystem);
      const isFocusedPrompt = !isSystem && isInternalFocusPrompt(originalContent);
      const extractedUserRequest = isFocusedPrompt ? extractEmbeddedUserRequest(originalContent) : '';

      const normalized = {
        ...message,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: extractedUserRequest || originalContent,
        timestamp: message.timestamp || new Date().toISOString(),
        isSystem,
        hidden: Boolean(message.hidden) || (isSystem && !extractedUserRequest),
      };

      const scenePreview = normalizeScenePreview(message.scenePreview);
      if (scenePreview) {
        normalized.scenePreview = scenePreview;
      } else {
        delete normalized.scenePreview;
      }

      return normalized;
    });
}

function normalizeScenePreview(preview) {
  if (!preview || typeof preview !== 'object') {
    return null;
  }

  const sceneId = String(preview.sceneId || '').trim();
  const imageUrl = String(preview.imageUrl || '').trim();
  if (!sceneId || !imageUrl) {
    return null;
  }

  return {
    sceneId,
    sceneNumber: String(preview.sceneNumber || '').trim(),
    title: String(preview.title || '').trim() || 'Untitled Shot',
    contextLabel: String(preview.contextLabel || '').trim(),
    location: String(preview.location || '').trim(),
    mood: String(preview.mood || '').trim(),
    storyFunction: String(preview.storyFunction || '').trim(),
    imageUrl,
    imageStatus: String(preview.imageStatus || 'ready').trim() || 'ready',
  };
}

function normalizeStoryboard(storyboard) {
  const fallback = createEmptyStoryboard();
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : fallback.acts;
  const seenSceneIds = new Set();

  return {
    ...fallback,
    ...storyboard,
    acts: acts.map((act) => ({
      ...act,
      sequences: Array.isArray(act?.sequences)
        ? act.sequences.map((sequence, sequenceIndex) => ({
          ...sequence,
          number: sequenceIndex + 1,
          scenes: Array.isArray(sequence?.scenes)
            ? sequence.scenes.map((scene, sceneIndex) =>
              normalizeScene(
                scene,
                Number(act?.number),
                sequenceIndex + 1,
                sceneIndex + 1,
                seenSceneIds
              )
            )
            : [],
        }))
        : [],
    })),
  };
}

function normalizeScene(scene, actNumber, sequenceNumber, sceneIndex, seenSceneIds) {
  const sceneId = ensureUniqueSceneId(scene?.id, seenSceneIds);
  return {
    ...scene,
    id: sceneId,
    sceneNumber: `${actNumber}.${sequenceNumber}.${sceneIndex}`,
    characterIds: normalizeStringArray(scene?.characterIds),
    locationIds: normalizeStringArray(scene?.locationIds),
    imageUrl: typeof scene?.imageUrl === 'string' && scene.imageUrl.trim() ? scene.imageUrl : null,
    imagePrompt: String(scene?.imagePrompt || ''),
    imagePromptHash: String(scene?.imagePromptHash || ''),
    imageStatus: String(scene?.imageStatus || 'idle'),
    imageError: String(scene?.imageError || ''),
    imageUpdatedAt: scene?.imageUpdatedAt ? String(scene.imageUpdatedAt) : null,
    imageProvider: String(scene?.imageProvider || ''),
    imageModelResolved: String(scene?.imageModelResolved || ''),
    imageAttemptedAt: scene?.imageAttemptedAt ? String(scene.imageAttemptedAt) : null,
    imageLatencyMs:
      typeof scene?.imageLatencyMs === 'number' && Number.isFinite(scene.imageLatencyMs)
        ? scene.imageLatencyMs
        : null,
    imageDiagnosticCode: String(scene?.imageDiagnosticCode || ''),
    imageDiagnosticMessage: String(scene?.imageDiagnosticMessage || ''),
    imagePromptPreview: String(scene?.imagePromptPreview || ''),
  };
}

function ensureUniqueSceneId(rawId, seenSceneIds) {
  const seen = seenSceneIds instanceof Set ? seenSceneIds : new Set();
  let nextId = String(rawId || '').trim();
  if (!nextId || seen.has(nextId)) {
    nextId = createSceneId(seen);
  }
  seen.add(nextId);
  return nextId;
}

function createSceneId(seenSceneIds) {
  let next = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const seen = seenSceneIds instanceof Set ? seenSceneIds : null;
  while (seen?.has(next)) {
    next = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return next;
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export const __projectStoreTestUtils = {
  enforceSceneMutationPolicy,
  extractSceneEditId,
  getNextSceneGenerationTarget,
  extractRequestedShotCount,
  resolvePromptSceneTarget,
  harmonizeStoryOutlineWithChat,
  parseStoryOutlineFromChat,
  parseShotSpecFromChat,
  enrichShotUpdatesFromChat,
};
