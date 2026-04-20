export function moveActInPlace(acts, payload) {
  const sourceActNumber = Number(payload?.sourceActNumber || 0);
  const targetActNumber = Number(payload?.targetActNumber || 0);
  const toEnd = payload?.toEnd === true;
  let placeAfter = payload?.placeAfter === true;

  if (!Array.isArray(acts) || !sourceActNumber) {
    return false;
  }

  const sourceIndex = acts.findIndex((act) => Number(act?.number) === sourceActNumber);
  if (sourceIndex < 0) {
    return false;
  }

  const targetOriginalIndex = acts.findIndex((act) => Number(act?.number) === targetActNumber);
  if (!toEnd && targetOriginalIndex < 0) {
    return false;
  }

  // Prevent adjacent drops from resolving to no-op due before/after ambiguity.
  if (!toEnd && !placeAfter && sourceIndex + 1 === targetOriginalIndex) {
    placeAfter = true;
  }
  if (!toEnd && placeAfter && sourceIndex === targetOriginalIndex + 1) {
    placeAfter = false;
  }

  const [sourceAct] = acts.splice(sourceIndex, 1);
  if (!sourceAct) {
    return false;
  }

  if (toEnd) {
    acts.push(sourceAct);
    return true;
  }

  const matchIndex = acts.findIndex((act) => Number(act?.number) === targetActNumber);
  if (matchIndex < 0) {
    acts.push(sourceAct);
    return true;
  }

  const targetIndex = Math.max(0, Math.min(matchIndex + (placeAfter ? 1 : 0), acts.length));
  acts.splice(targetIndex, 0, sourceAct);
  return true;
}

export function moveSceneInPlace(storyboard, payload) {
  const sceneId = String(payload?.sceneId || '').trim();
  const targetActNumber = Number(payload?.targetActNumber || 0);
  const targetSequenceNumber = Number(payload?.targetSequenceNumber || 0);
  const targetIndex = Number(payload?.targetIndex);

  if (!storyboard || !sceneId || !targetActNumber || !targetSequenceNumber) {
    return false;
  }

  const sourceLookup = findSceneById(storyboard, sceneId);
  const targetSequence = findSequence(storyboard, targetActNumber, targetSequenceNumber);
  if (!sourceLookup || !targetSequence) {
    return false;
  }

  const sourceSequence = sourceLookup.sequence;
  const sourceScenes = Array.isArray(sourceSequence.scenes) ? sourceSequence.scenes : [];
  const sourceIndex = sourceScenes.findIndex((scene) => scene.id === sceneId);
  if (sourceIndex < 0) {
    return false;
  }

  const [scene] = sourceScenes.splice(sourceIndex, 1);
  if (!scene) {
    return false;
  }

  targetSequence.scenes = Array.isArray(targetSequence.scenes) ? targetSequence.scenes : [];

  let safeIndex = Number.isInteger(targetIndex) ? targetIndex : targetSequence.scenes.length;

  if (sourceSequence === targetSequence && sourceIndex < safeIndex) {
    safeIndex -= 1;
  }

  safeIndex = Math.max(0, Math.min(safeIndex, targetSequence.scenes.length));

  targetSequence.scenes.splice(safeIndex, 0, scene);
  return true;
}

export function findSequence(storyboard, actNumber, sequenceNumber) {
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  const act = acts.find((item) => Number(item?.number) === Number(actNumber));
  if (!act) {
    return null;
  }
  return (act.sequences || []).find((item) => Number(item?.number) === Number(sequenceNumber)) || null;
}

export function findSceneById(storyboard, sceneId) {
  const cleanSceneId = String(sceneId || '').trim();
  if (!cleanSceneId) {
    return null;
  }

  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  for (const act of acts) {
    for (const sequence of act.sequences || []) {
      const scene = (sequence.scenes || []).find((item) => item.id === cleanSceneId);
      if (scene) {
        return { act, sequence, scene };
      }
    }
  }

  return null;
}

export function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

export function buildSceneFingerprint(sceneData) {
  const location = normalizeKeyPart(sceneData?.location);
  const time = normalizeKeyPart(sceneData?.time);
  const storyFunction = normalizeKeyPart(sceneData?.storyFunction);
  const action = normalizeKeyPart(sceneData?.action);
  const visualDescription = normalizeKeyPart(sceneData?.visualDescription);
  return [location, time, storyFunction, action, visualDescription].filter(Boolean).join('|');
}
