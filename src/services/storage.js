/**
 * Storage abstraction — thin API client that talks to the local backend server.
 *
 * All functions maintain the same interface as before, so existing stores
 * and components don't need to change. Under the hood, every call is now
 * a fetch() to http://localhost:3001/api/*.
 */

const API_BASE = '/api';

const GUEST_ID_KEY = 'storyboarder_guest_id';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOrCreateGuestId() {
  if (typeof window === 'undefined') return 'guest_default';
  let guestId = localStorage.getItem(GUEST_ID_KEY);
  if (!guestId) {
    guestId = 'guest_' + (self.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    localStorage.setItem(GUEST_ID_KEY, guestId);
  }
  return guestId;
}

let activeUserId = null;

export function getActiveUserId() {
  if (!activeUserId) {
    activeUserId = getOrCreateGuestId();
  }
  return activeUserId;
}

export function setActiveUserId(userId) {
  activeUserId = String(userId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || getOrCreateGuestId();
  return activeUserId;
}

async function api(path, options = {}) {
  const { method = 'GET', body } = options;
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `API error ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function loadSettings() {
  try {
    return await api('/settings');
  } catch {
    return {};
  }
}

export async function saveSettings(settings) {
  try {
    await api('/settings', { method: 'PUT', body: settings });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers() {
  return api('/users').catch(() => []);
}

export async function loadUser(userId) {
  return api(`/users/${encodeURIComponent(userId)}`).catch(() => null);
}

export async function saveUser(user) {
  return api(`/users/${encodeURIComponent(user.id)}`, { method: 'PUT', body: user }).catch(() => null);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(options = {}) {
  const userId = options?.userId || getActiveUserId();
  return api(`/projects?userId=${encodeURIComponent(userId)}`).catch(() => []);
}

export async function loadProject(projectId) {
  return api(`/projects/${encodeURIComponent(projectId)}`).catch(() => null);
}

export async function saveProject(project) {
  if (!project?.id) throw new Error('project.id is required');
  return api(`/projects/${encodeURIComponent(project.id)}`, { method: 'PUT', body: project });
}

export async function deleteProject(projectId) {
  try {
    const result = await api(`/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
    return result?.deleted ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Characters (global)
// ---------------------------------------------------------------------------

export async function listCharacters(options = {}) {
  const userId = options?.userId || getActiveUserId();
  return api(`/characters?userId=${encodeURIComponent(userId)}`).catch(() => []);
}

export async function loadCharacter(characterId) {
  return api(`/characters/${encodeURIComponent(characterId)}`).catch(() => null);
}

export async function saveCharacter(character) {
  if (!character?.id) throw new Error('character.id is required');
  return api(`/characters/${encodeURIComponent(character.id)}`, { method: 'PUT', body: character });
}

export async function deleteCharacter(characterId) {
  try {
    const result = await api(`/characters/${encodeURIComponent(characterId)}`, { method: 'DELETE' });
    return result?.deleted ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Locations (global)
// ---------------------------------------------------------------------------

export async function listLocations(options = {}) {
  const userId = options?.userId || getActiveUserId();
  return api(`/locations?userId=${encodeURIComponent(userId)}`).catch(() => []);
}

export async function loadLocation(locationId) {
  return api(`/locations/${encodeURIComponent(locationId)}`).catch(() => null);
}

export async function saveLocation(location) {
  if (!location?.id) throw new Error('location.id is required');
  return api(`/locations/${encodeURIComponent(location.id)}`, { method: 'PUT', body: location });
}

export async function deleteLocation(locationId) {
  try {
    const result = await api(`/locations/${encodeURIComponent(locationId)}`, { method: 'DELETE' });
    return result?.deleted ?? false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Story-entity links
// ---------------------------------------------------------------------------

export async function linkEntityToStory(storyId, entityType, entityId) {
  try {
    await api(`/entities/story/${encodeURIComponent(storyId)}/link`, {
      method: 'POST',
      body: { entityType, entityId },
    });
    return true;
  } catch {
    return false;
  }
}

export async function unlinkEntityFromStory(storyId, entityType, entityId) {
  try {
    await api(`/entities/story/${encodeURIComponent(storyId)}/unlink`, {
      method: 'POST',
      body: { entityType, entityId },
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadStoryEntities(storyId) {
  return api(`/entities/story/${encodeURIComponent(storyId)}`).catch(() => ({ characters: [], locations: [] }));
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function saveImage(projectId, sceneId, imageData) {
  try {
    const result = await api(`/images/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}`, {
      method: 'POST',
      body: { imageData },
    });
    return result?.url || null;
  } catch {
    return null;
  }
}

export async function deleteImage(projectId, sceneId) {
  try {
    const result = await api(`/images/${encodeURIComponent(projectId)}/${encodeURIComponent(sceneId)}`, {
      method: 'DELETE',
    });
    return result?.deleted ?? false;
  } catch {
    return false;
  }
}

export async function resolveImagePath(relativePath) {
  // Image paths are now API URLs served by the backend — return as-is
  return relativePath || null;
}
