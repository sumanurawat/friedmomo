import { v4 as uuidv4 } from 'uuid';

import { buildSystemPrompt } from '../prompts/system-prompt.js';
import { buildSceneFingerprint, normalizeKeyPart } from '../utils/storyboard-ops.js';

export function parseAIResponse(rawText) {
  const original = String(rawText || '').trim();
  if (!original) {
    return {
      chat: 'No response received. Try again.',
      updates: {},
    };
  }

  let cleaned = original;
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  const parsed =
    tryParseJson(cleaned) ||
    tryParseJson(extractCodeFenceJson(cleaned)) ||
    tryParseJson(extractFirstJsonObject(cleaned));

  if (parsed && typeof parsed === 'object') {
    const updates =
      parsed?.updates && typeof parsed.updates === 'object'
        ? parsed.updates
        : normalizeDirectUpdates(parsed);

    return {
      chat:
        typeof parsed?.chat === 'string' && parsed.chat.trim()
          ? parsed.chat.trim()
          : 'Updated storyboard.',
      updates,
    };
  }

  const salvaged = salvageStructuredResponse(cleaned);
  if (salvaged) {
    return salvaged;
  }

  return {
    chat: sanitizeChatFallback(original),
    updates: {},
  };
}

export function applyUpdates(project, updates) {
  const nextProject = structuredClone(project);
  const nextUpdates = updates && typeof updates === 'object' ? updates : {};

  applyStoryOutline(nextProject, nextUpdates);
  applyActs(nextProject, nextUpdates);
  applySequenceAdds(nextProject, nextUpdates);
  applySequenceUpdates(nextProject, nextUpdates);
  applyCharacters(nextProject, nextUpdates);
  applyLocations(nextProject, nextUpdates);
  applySceneAdds(nextProject, nextUpdates);
  applySceneUpdates(nextProject, nextUpdates);
  applySceneRemovals(nextProject, nextUpdates);
  normalizeSequenceNumbers(nextProject.storyboard);
  normalizeSceneNumbers(nextProject.storyboard);

  nextProject.updatedAt = new Date().toISOString();
  return nextProject;
}

function applyStoryOutline(project, updates) {
  const actsOutline = Array.isArray(updates?.story_outline?.acts)
    ? updates.story_outline.acts
    : null;
  if (!actsOutline || actsOutline.length === 0) {
    return;
  }

  const hasScenes = project.storyboard.acts.some((act) =>
    (act.sequences || []).some((sequence) => (sequence.scenes || []).length > 0)
  );

  if (!hasScenes) {
    project.storyboard.acts = actsOutline.map((actItem, actIndex) => {
      const sequencesOutline = Array.isArray(actItem?.sequences) ? actItem.sequences : [];
      const sequences =
        sequencesOutline.length > 0
          ? sequencesOutline.map((sequenceItem, sequenceIndex) => {
            const title =
              typeof sequenceItem === 'string'
                ? sequenceItem
                : String(sequenceItem?.title || '').trim() || `Scene ${sequenceIndex + 1}`;
            const next = {
              number: sequenceIndex + 1,
              title,
              scenes: [],
            };
            return next;
          })
          : [
            {
              number: 1,
              title: 'New Scene',
              scenes: [],
            },
          ];

      return {
        number: Number(actItem?.act || actIndex + 1),
        title: String(actItem?.title || '').trim() || `Sequence ${actIndex + 1}`,
        sequences,
      };
    });
    return;
  }

  for (const [index, actItem] of actsOutline.entries()) {
    const actNumber = Number(actItem?.act || index + 1);
    const targetAct = project.storyboard.acts.find((act) => Number(act.number) === actNumber);
    if (!targetAct) {
      continue;
    }

    const nextTitle = String(actItem?.title || '').trim();
    if (nextTitle) {
      targetAct.title = nextTitle;
    }

    const sequencesOutline = Array.isArray(actItem?.sequences) ? actItem.sequences : [];
    for (const [sequenceIndex, sequenceItem] of sequencesOutline.entries()) {
      const byNumber = Number(sequenceItem?.sequence || 0);
      const targetSequence = byNumber
        ? targetAct.sequences.find((sequence) => Number(sequence.number) === byNumber)
        : targetAct.sequences[sequenceIndex];
      if (!targetSequence) {
        continue;
      }
      const nextSequenceTitle =
        typeof sequenceItem === 'string'
          ? sequenceItem
          : String(sequenceItem?.title || '').trim();
      if (nextSequenceTitle) {
        targetSequence.title = nextSequenceTitle;
      }
    }
  }
}

function applyActs(project, updates) {
  const list = Array.isArray(updates?.acts_update) ? updates.acts_update : [];
  for (const entry of list) {
    const actNumber = Number(entry?.act);
    if (!actNumber) {
      continue;
    }
    const targetAct = project.storyboard.acts.find((act) => Number(act.number) === actNumber);
    if (!targetAct) {
      continue;
    }
    const nextTitle = String(entry?.changes?.title || entry?.title || '').trim();
    if (nextTitle) {
      targetAct.title = nextTitle;
    }
  }
}

function applySequenceAdds(project, updates) {
  const list = Array.isArray(updates?.sequences_add) ? updates.sequences_add : [];
  for (const entry of list) {
    const actNumber = Number(entry?.act || 0);
    if (!actNumber) {
      continue;
    }
    const targetAct = resolveAct(project.storyboard.acts, actNumber);
    if (!targetAct) {
      continue;
    }

    const sequenceTitle = String(entry?.title || '').trim();
    if (!sequenceTitle) {
      continue;
    }

    const exists = targetAct.sequences.some(
      (sequence) => String(sequence?.title || '').trim().toLowerCase() === sequenceTitle.toLowerCase()
    );
    if (exists) {
      continue;
    }

    const nextSequenceNumber = getNextSequenceNumber(targetAct);
    const newSequence = {
      number: nextSequenceNumber,
      title: sequenceTitle,
      scenes: [],
    };

    const afterSequence = Number(entry?.afterSequence);
    if (afterSequence) {
      const anchor = resolveSequenceInAct(targetAct, afterSequence);
      const index = anchor ? targetAct.sequences.indexOf(anchor) : -1;
      if (index >= 0) {
        targetAct.sequences.splice(index + 1, 0, newSequence);
        continue;
      }
    }

    targetAct.sequences.push(newSequence);
  }
}

function applySequenceUpdates(project, updates) {
  const list = Array.isArray(updates?.sequences_update) ? updates.sequences_update : [];
  for (const entry of list) {
    const actNumber = Number(entry?.act || 0);
    const sequenceNumber = Number(entry?.sequence || 0);
    const sequenceTitle = String(entry?.sequenceTitle || '').trim();
    const nextTitle = String(entry?.changes?.title || entry?.title || '').trim();
    if (!nextTitle) {
      continue;
    }

    const acts = project.storyboard.acts || [];
    let targetSequence = null;

    if (actNumber) {
      const targetAct = resolveAct(acts, actNumber);
      if (targetAct) {
        targetSequence =
          resolveSequenceInAct(targetAct, sequenceNumber) ||
          findSequenceByTitle(targetAct.sequences, sequenceTitle);
      }
    }

    if (!targetSequence && sequenceNumber) {
      for (const act of acts) {
        const sequence = (act.sequences || []).find(
          (item) => Number(item.number) === sequenceNumber
        );
        if (sequence) {
          targetSequence = sequence;
          break;
        }
      }
    }

    if (!targetSequence && actNumber) {
      const targetAct = resolveAct(acts, actNumber);
      const byIndex = Number(entry?.sequenceIndex || 0);
      if (targetAct && byIndex > 0) {
        targetSequence = targetAct.sequences?.[byIndex - 1] || null;
      }
    }

    if (!targetSequence && sequenceTitle) {
      for (const act of acts) {
        const match = findSequenceByTitle(act.sequences, sequenceTitle);
        if (match) {
          targetSequence = match;
          break;
        }
      }
    }

    if (!targetSequence) {
      continue;
    }

    targetSequence.title = nextTitle;
  }
}

function applyCharacters(project, updates) {
  const list = Array.isArray(updates.characters_add) ? updates.characters_add : [];
  for (const character of list) {
    const safeName = String(character?.name || '').trim();
    if (!safeName) {
      continue;
    }

    const id = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const exists = project.entities.characters.find((item) => item.id === id);
    if (exists) {
      continue;
    }

    const colors = ['#E8B4E8', '#B4D4E8', '#B4E8C8', '#E8D4B4', '#D4B4E8', '#E8B4B4'];
    project.entities.characters.push({
      id,
      name: safeName,
      description: String(character?.description || ''),
      visualPromptDescription: String(character?.visualPromptDescription || ''),
      role: String(character?.role || 'Supporting'),
      firstAppearance: '',
      color: colors[project.entities.characters.length % colors.length],
    });
  }

  const updatesList = Array.isArray(updates.characters_update) ? updates.characters_update : [];
  for (const update of updatesList) {
    const targetId = String(update?.id || '').trim();
    if (!targetId) {
      continue;
    }
    const target = project.entities.characters.find((item) => item.id === targetId);
    if (!target) {
      continue;
    }
    Object.assign(target, update?.changes || {});
  }
}

function applyLocations(project, updates) {
  const list = Array.isArray(updates.locations_add) ? updates.locations_add : [];
  for (const location of list) {
    const safeName = String(location?.name || '').trim();
    if (!safeName) {
      continue;
    }

    const id = safeName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const exists = project.entities.locations.find((item) => item.id === id);
    if (exists) {
      continue;
    }

    project.entities.locations.push({
      id,
      name: safeName,
      description: String(location?.description || ''),
      visualPromptDescription: String(location?.visualPromptDescription || ''),
      mood: String(location?.mood || ''),
    });
  }

  const updatesList = Array.isArray(updates.locations_update) ? updates.locations_update : [];
  for (const update of updatesList) {
    const targetId = String(update?.id || '').trim();
    if (!targetId) {
      continue;
    }
    const target = project.entities.locations.find((item) => item.id === targetId);
    if (!target) {
      continue;
    }
    Object.assign(target, update?.changes || {});
  }
}

function applySceneAdds(project, updates) {
  const additions = Array.isArray(updates.scenes_add) ? updates.scenes_add : [];
  const seenSceneKeys = new Set();
  for (const sceneData of additions) {
    const actNumber = Number(sceneData?.act || 0);
    const sequenceNumber = Number(sceneData?.sequence || 0);
    const sequenceTitle = String(sceneData?.sequenceTitle || '').trim();

    const act = resolveAct(project.storyboard.acts, actNumber);
    if (!act) {
      continue;
    }

    const sequence =
      resolveSequenceInAct(act, sequenceNumber) ||
      findSequenceByTitle(act.sequences, sequenceTitle) ||
      null;
    if (!sequence) {
      continue;
    }

    const sceneTitle = String(sceneData?.title || '').trim();
    const sceneKey = buildSceneKey(actNumber, sequence.number, sceneTitle, sceneData);
    if (sceneKey && seenSceneKeys.has(sceneKey)) {
      continue;
    }
    if (sceneKey) {
      seenSceneKeys.add(sceneKey);
    }

    const existingScene = findMatchingScene(sequence.scenes, sceneData);
    if (existingScene) {
      continue;
    }

    const fallbackTitle = sceneTitle || deriveFallbackTitle(sceneData);
    const uniqueTitle = makeUniqueShotTitle(sequence.scenes, fallbackTitle);
    const safeLocation = String(sceneData?.location || '').trim();
    const safeTime = String(sceneData?.time || '').trim();
    const safeVisualDescription =
      String(sceneData?.visualDescription || '').trim() ||
      String(sceneData?.action || '').trim() ||
      `Visual frame for "${uniqueTitle}".`;
    const safeAction =
      String(sceneData?.action || '').trim() ||
      String(sceneData?.storyFunction || '').trim() ||
      `Advance the scene through "${uniqueTitle}".`;
    const safeStoryFunction =
      String(sceneData?.storyFunction || '').trim() ||
      String(sceneData?.action || '').trim() ||
      String(sceneData?.visualDescription || '').trim() ||
      `Story beat: ${uniqueTitle}.`;
    const safeMood = String(sceneData?.mood || '').trim();



    sequence.scenes.push({
      id: `scene_${uuidv4().slice(0, 8)}`,
      sceneNumber: '',
      title: uniqueTitle,
      location: safeLocation,
      time: safeTime,
      visualDescription: safeVisualDescription,
      action: safeAction,
      dialogue: normalizeDialogue(sceneData?.dialogue),
      mood: safeMood,
      storyFunction: safeStoryFunction,
      characterIds: normalizeStringArray(sceneData?.characterIds),
      locationIds: normalizeStringArray(sceneData?.locationIds),
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
    });
  }
}

function applySceneUpdates(project, updates) {
  const list = Array.isArray(updates.scenes_update) ? updates.scenes_update : [];
  for (const update of list) {
    const sceneId = String(update?.sceneId || '').trim();
    if (!sceneId) {
      continue;
    }

    for (const act of project.storyboard.acts) {
      for (const sequence of act.sequences) {
        const scene = sequence.scenes.find((item) => item.id === sceneId);
        if (!scene) {
          continue;
        }

        const changes = sanitizeSceneChanges(update?.changes || {});
        if ('dialogue' in changes) {
          changes.dialogue = normalizeDialogue(changes.dialogue);
        }
        if ('characterIds' in changes) {
          changes.characterIds = normalizeStringArray(changes.characterIds);
        }
        if ('locationIds' in changes) {
          changes.locationIds = normalizeStringArray(changes.locationIds);
        }

        Object.assign(scene, changes);
      }
    }
  }
}

function applySceneRemovals(project, updates) {
  const removals = Array.isArray(updates.scenes_remove) ? updates.scenes_remove : [];
  if (removals.length === 0) {
    return;
  }

  const removeSet = new Set(removals.map((value) => String(value)));
  for (const act of project.storyboard.acts) {
    for (const sequence of act.sequences) {
      sequence.scenes = sequence.scenes.filter((scene) => !removeSet.has(String(scene.id)));
    }
  }
}

function normalizeSceneNumbers(storyboard) {
  for (const act of storyboard.acts) {
    for (const sequence of act.sequences) {
      sequence.scenes = sequence.scenes.map((scene, index) => ({
        ...scene,
        sceneNumber: `${act.number}.${sequence.number}.${index + 1}`,
      }));
    }
  }
}

function normalizeDialogue(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => ({
      character: String(item?.character || '').trim(),
      line: String(item?.line || '').trim(),
    }))
    .filter((item) => item.character || item.line);
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export { buildSystemPrompt };

function tryParseJson(input) {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractCodeFenceJson(input) {
  const text = String(input || '');
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? match[1] : '';
}

function extractFirstJsonObject(input) {
  const text = String(input || '');
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return '';
}

function normalizeDirectUpdates(parsed) {
  const candidate = parsed && typeof parsed === 'object' ? parsed : {};
  const keys = [
    'story_outline',
    'acts_update',
    'sequences_add',
    'sequences_update',
    'scenes_add',
    'scenes_update',
    'scenes_remove',
    'characters_add',
    'characters_update',
    'locations_add',
    'locations_update',
  ];

  const updates = {};
  let hasAny = false;

  for (const key of keys) {
    if (key in candidate) {
      updates[key] = candidate[key];
      hasAny = true;
    }
  }

  return hasAny ? updates : {};
}

function salvageStructuredResponse(input) {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }

  const chat =
    extractNamedJsonString(text, 'chat') ||
    extractClippedChatValue(text) ||
    '';
  const updates =
    extractNamedObject(text, 'updates') ||
    {};

  if (!chat && (!updates || Object.keys(updates).length === 0)) {
    return null;
  }

  return {
    chat: chat || 'Updated storyboard.',
    updates: updates && typeof updates === 'object' ? updates : {},
  };
}

function extractNamedJsonString(input, key) {
  const text = String(input || '');
  const pattern = new RegExp(`"${escapeRegex(key)}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 's');
  const match = text.match(pattern);
  if (!match?.[1]) {
    return '';
  }
  return decodeJsonString(match[1]);
}

function extractClippedChatValue(input) {
  const text = String(input || '');
  const match = text.match(/^\s*":\s*"((?:\\.|[^"\\])*)"\s*,\s*"updates"\s*:/s);
  if (!match?.[1]) {
    return '';
  }
  return decodeJsonString(match[1]);
}

function extractNamedObject(input, key) {
  const text = String(input || '');
  const marker = `"${key}"`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  let colonIndex = text.indexOf(':', markerIndex + marker.length);
  if (colonIndex === -1) {
    return null;
  }

  let objectStart = text.indexOf('{', colonIndex + 1);
  if (objectStart === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = objectStart; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return tryParseJson(text.slice(objectStart, i + 1));
      }
    }
  }

  return null;
}

function decodeJsonString(value) {
  const raw = String(value || '');
  if (!raw) {
    return '';
  }

  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .trim();
  }
}

function sanitizeChatFallback(input) {
  const text = String(input || '').trim();
  if (!text) {
    return 'Updated storyboard.';
  }

  if (looksLikeStructuredPayload(text)) {
    const clipped = extractClippedChatValue(text);
    if (clipped) {
      return clipped;
    }

    const named = extractNamedJsonString(text, 'chat');
    if (named) {
      return named;
    }

    return 'Updated storyboard.';
  }

  return text;
}

function looksLikeStructuredPayload(input) {
  const text = String(input || '');
  return text.includes('"updates"') || text.includes('"story_outline"') || text.includes('"scenes_add"');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getNextSequenceNumber(act) {
  const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
  let max = 0;
  for (const sequence of sequences) {
    max = Math.max(max, Number(sequence?.number) || 0);
  }
  return max + 1;
}

function resolveAct(acts, actNumber) {
  const targetActNumber = Number(actNumber || 0);
  if (!targetActNumber) {
    return null;
  }

  return (
    (acts || []).find((act) => Number(act?.number) === targetActNumber) ||
    (acts || [])[targetActNumber - 1] ||
    null
  );
}

function resolveSequenceInAct(act, sequenceNumber) {
  const targetSequenceNumber = Number(sequenceNumber || 0);
  if (!act || !targetSequenceNumber) {
    return null;
  }

  const sequences = Array.isArray(act.sequences) ? act.sequences : [];
  return (
    sequences.find((sequence) => Number(sequence?.number) === targetSequenceNumber) ||
    sequences[targetSequenceNumber - 1] ||
    null
  );
}

function normalizeSequenceNumbers(storyboard) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    act.sequences = (act.sequences || []).map((sequence, index) => ({
      ...sequence,
      number: index + 1,
    }));
  }
}

function findSequenceByTitle(sequences, title) {
  const cleanTitle = String(title || '').trim().toLowerCase();
  if (!cleanTitle) {
    return null;
  }

  return (
    (Array.isArray(sequences) ? sequences : []).find(
      (sequence) => String(sequence?.title || '').trim().toLowerCase() === cleanTitle
    ) || null
  );
}

function findSceneByTitle(scenes, title) {
  const cleanTitle = String(title || '').trim().toLowerCase();
  if (!cleanTitle) {
    return null;
  }
  return (
    (Array.isArray(scenes) ? scenes : []).find(
      (scene) => String(scene?.title || '').trim().toLowerCase() === cleanTitle
    ) || null
  );
}

function findSceneByFingerprint(scenes, sceneData) {
  const targetFingerprint = buildSceneFingerprint(sceneData);
  if (!targetFingerprint) {
    return null;
  }
  return (
    (Array.isArray(scenes) ? scenes : []).find(
      (scene) => buildSceneFingerprint(scene) === targetFingerprint
    ) || null
  );
}

function findMatchingScene(scenes, sceneData) {
  const list = Array.isArray(scenes) ? scenes : [];
  const sceneTitle = String(sceneData?.title || '').trim();
  const titleKey = sceneTitle.toLowerCase();
  const fingerprint = buildSceneFingerprint(sceneData);

  if (titleKey && fingerprint) {
    const combinedMatch =
      list.find((scene) => {
        const sceneTitleKey = String(scene?.title || '').trim().toLowerCase();
        if (sceneTitleKey !== titleKey) {
          return false;
        }
        return buildSceneFingerprint(scene) === fingerprint;
      }) || null;

    if (combinedMatch) {
      return combinedMatch;
    }

    // If the incoming scene data is sparse (few populated fields), treat a
    // title match alone as a duplicate — the AI likely re-described the same
    // shot rather than creating genuinely new content.
    const contentFieldCount = [
      sceneData?.location,
      sceneData?.time,
      sceneData?.visualDescription,
      sceneData?.action,
      sceneData?.storyFunction,
    ].filter((v) => String(v || '').trim()).length;

    if (contentFieldCount <= 3) {
      return findSceneByTitle(list, sceneTitle);
    }

    // Rich, distinct content — allow the add (caller will auto-rename title).
    return null;
  }

  if (titleKey) {
    return findSceneByTitle(list, sceneTitle);
  }

  if (fingerprint) {
    return findSceneByFingerprint(list, sceneData);
  }

  return null;
}

function buildSceneKey(actNumber, sequenceNumber, title, sceneData) {
  const cleanTitle = normalizeKeyPart(title);
  const sceneFingerprint = buildSceneFingerprint(sceneData);
  const fingerprint = cleanTitle && sceneFingerprint ? `${cleanTitle}|${sceneFingerprint}` : cleanTitle || sceneFingerprint;
  if (!actNumber || !sequenceNumber || !fingerprint) {
    return '';
  }
  return `${actNumber}:${sequenceNumber}:${fingerprint}`;
}

function makeUniqueShotTitle(scenes, candidateTitle) {
  const baseTitle = String(candidateTitle || '').trim() || 'Untitled Shot';
  const existing = new Set(
    (Array.isArray(scenes) ? scenes : [])
      .map((scene) => String(scene?.title || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (!existing.has(baseTitle.toLowerCase())) {
    return baseTitle;
  }

  let index = 2;
  let nextTitle = `${baseTitle} (${index})`;
  while (existing.has(nextTitle.toLowerCase())) {
    index += 1;
    nextTitle = `${baseTitle} (${index})`;
  }

  return nextTitle;
}

function deriveFallbackTitle(sceneData) {
  const action = String(sceneData?.action || '').trim();
  const storyFunction = String(sceneData?.storyFunction || '').trim();
  const visual = String(sceneData?.visualDescription || '').trim();
  return action || storyFunction || visual || 'Untitled Shot';
}

function sanitizeSceneChanges(input) {
  const source = input && typeof input === 'object' ? input : {};
  const next = { ...source };
  const textFields = [
    'title',
    'location',
    'time',
    'visualDescription',
    'action',
    'mood',
    'storyFunction',
    'imagePrompt',
    'imageError',
  ];

  for (const field of textFields) {
    if (!(field in next)) {
      continue;
    }
    const value = next[field];
    if (typeof value === 'string' && !value.trim()) {
      delete next[field];
    }
  }

  return next;
}
