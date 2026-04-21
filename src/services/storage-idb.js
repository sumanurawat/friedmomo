/**
 * IndexedDB-backed storage — browser mode (no Node backend).
 *
 * Public surface matches storage-backend.js exactly. Used when
 * VITE_STORYBOARDER_MODE === 'web'.
 *
 * Schema (all object stores keyed by `id` except where noted):
 *   - kv         key: string                (settings, guest id, etc.)
 *   - users      keyPath: 'id'
 *   - projects   keyPath: 'id'
 *   - characters keyPath: 'id'              global across projects
 *   - locations  keyPath: 'id'              global across projects
 *   - links      keyPath: 'storyId'         story → [characterIds, locationIds]
 *   - images     keyPath: 'key' (format: `${projectId}::${sceneId}`)
 *                value: { key, projectId, sceneId, dataUrl, updatedAt }
 *
 * Image handling: we store the raw data URL string in the `images` store and
 * return an opaque pseudo-URL `idb://images/{projectId}/{sceneId}` as the
 * saved "path". `resolveImagePath` looks it up and returns the data URL,
 * which is directly usable as <img src>. Scene JSON only carries the
 * small pseudo-URL so the project record stays compact.
 */

const DB_NAME = 'storyboarder';
const DB_VERSION = 1;

const STORES = {
  kv: 'kv',
  users: 'users',
  projects: 'projects',
  characters: 'characters',
  locations: 'locations',
  links: 'links',
  images: 'images',
};

const GUEST_ID_KEY = 'guest_id';
const SETTINGS_KEY = 'settings';
const IMAGE_URL_PREFIX = 'idb://images/';

// ---------------------------------------------------------------------------
// DB plumbing
// ---------------------------------------------------------------------------

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this context.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv);
      if (!db.objectStoreNames.contains(STORES.users)) db.createObjectStore(STORES.users, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.projects)) {
        const store = db.createObjectStore(STORES.projects, { keyPath: 'id' });
        store.createIndex('byUser', 'userId', { unique: false });
        store.createIndex('byUpdated', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.characters)) db.createObjectStore(STORES.characters, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.locations)) db.createObjectStore(STORES.locations, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.links)) db.createObjectStore(STORES.links, { keyPath: 'storyId' });
      if (!db.objectStoreNames.contains(STORES.images)) db.createObjectStore(STORES.images, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => {
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  });
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(storeName, key) {
  const store = await tx(storeName);
  return wrap(store.get(key));
}

async function idbPut(storeName, value, key) {
  const store = await tx(storeName, 'readwrite');
  return wrap(key === undefined ? store.put(value) : store.put(value, key));
}

async function idbDelete(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return wrap(store.delete(key));
}

async function idbGetAll(storeName) {
  const store = await tx(storeName);
  return wrap(store.getAll());
}

// ---------------------------------------------------------------------------
// Active user (guest id lives in localStorage so it survives DB recreation)
// ---------------------------------------------------------------------------

function getOrCreateGuestId() {
  if (typeof window === 'undefined') return 'guest_default';
  try {
    let guestId = localStorage.getItem('storyboarder_guest_id');
    if (!guestId) {
      guestId =
        'guest_' +
        (self.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
      localStorage.setItem('storyboarder_guest_id', guestId);
    }
    return guestId;
  } catch {
    return 'guest_default';
  }
}

let activeUserId = null;

export function getActiveUserId() {
  if (!activeUserId) activeUserId = getOrCreateGuestId();
  return activeUserId;
}

export function setActiveUserId(userId) {
  activeUserId =
    String(userId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '_') || getOrCreateGuestId();
  return activeUserId;
}

// ---------------------------------------------------------------------------
// Settings — one KV row. Also mirror to localStorage so onboarding reads work
// before IDB is open.
// ---------------------------------------------------------------------------

export async function loadSettings() {
  try {
    const fromIdb = await idbGet(STORES.kv, SETTINGS_KEY);
    if (fromIdb) return fromIdb;
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem('storyboarder_settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function saveSettings(settings) {
  try {
    await idbPut(STORES.kv, settings, SETTINGS_KEY);
  } catch {
    // ignore — localStorage is the fallback
  }
  try {
    localStorage.setItem('storyboarder_settings', JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function listUsers() {
  try {
    const users = await idbGetAll(STORES.users);
    return (users || []).sort((a, b) =>
      String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    );
  } catch {
    return [];
  }
}

export async function loadUser(userId) {
  try {
    return (await idbGet(STORES.users, userId)) || null;
  } catch {
    return null;
  }
}

export async function saveUser(user) {
  const now = new Date().toISOString();
  const existing = (await loadUser(user.id)) || {};
  const merged = {
    id: user.id,
    displayName: user.displayName || existing.displayName || user.id,
    storyIds: [...new Set([...(existing.storyIds || []), ...(user.storyIds || [])])],
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
  await idbPut(STORES.users, merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(options = {}) {
  const userId = options?.userId || getActiveUserId();
  try {
    const all = await idbGetAll(STORES.projects);
    const filtered = (all || []).filter((p) => !userId || p.userId === userId);
    return filtered
      .map((p) => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      }))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  } catch {
    return [];
  }
}

export async function loadProject(projectId) {
  try {
    return (await idbGet(STORES.projects, projectId)) || null;
  } catch {
    return null;
  }
}

export async function saveProject(project) {
  if (!project?.id) throw new Error('project.id is required');
  const now = new Date().toISOString();
  const existing = (await loadProject(project.id)) || {};
  const merged = {
    ...existing,
    ...project,
    updatedAt: project.updatedAt || now,
    createdAt: existing.createdAt || project.createdAt || now,
  };
  await idbPut(STORES.projects, merged);

  // Keep user's storyIds list in sync so listProjects/listUsers stays consistent.
  if (merged.userId) {
    const user = (await loadUser(merged.userId)) || { id: merged.userId };
    const storyIds = [...new Set([...(user.storyIds || []), merged.id])];
    await saveUser({ ...user, storyIds });
  }

  return merged;
}

export async function deleteProject(projectId) {
  try {
    await idbDelete(STORES.projects, projectId);
    // Also clean up image rows for this project.
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const t = db.transaction(STORES.images, 'readwrite');
      const store = t.objectStore(STORES.images);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = cursor.value?.key || '';
        if (typeof key === 'string' && key.startsWith(`${projectId}::`)) {
          cursor.delete();
        }
        cursor.continue();
      };
      t.oncomplete = () => resolve(true);
      t.onerror = () => reject(t.error);
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Characters (global)
// ---------------------------------------------------------------------------

export async function listCharacters(options = {}) {
  const userId = options?.userId || getActiveUserId();
  try {
    const all = await idbGetAll(STORES.characters);
    if (!userId) return all || [];
    return (all || []).filter((c) => !c.userId || c.userId === userId);
  } catch {
    return [];
  }
}

export async function loadCharacter(characterId) {
  try {
    return (await idbGet(STORES.characters, characterId)) || null;
  } catch {
    return null;
  }
}

export async function saveCharacter(character) {
  if (!character?.id) throw new Error('character.id is required');
  const now = new Date().toISOString();
  const existing = (await loadCharacter(character.id)) || {};
  const merged = {
    ...existing,
    ...character,
    updatedAt: now,
    createdAt: existing.createdAt || character.createdAt || now,
  };
  await idbPut(STORES.characters, merged);
  return merged;
}

export async function deleteCharacter(characterId) {
  try {
    await idbDelete(STORES.characters, characterId);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Locations (global)
// ---------------------------------------------------------------------------

export async function listLocations(options = {}) {
  const userId = options?.userId || getActiveUserId();
  try {
    const all = await idbGetAll(STORES.locations);
    if (!userId) return all || [];
    return (all || []).filter((l) => !l.userId || l.userId === userId);
  } catch {
    return [];
  }
}

export async function loadLocation(locationId) {
  try {
    return (await idbGet(STORES.locations, locationId)) || null;
  } catch {
    return null;
  }
}

export async function saveLocation(location) {
  if (!location?.id) throw new Error('location.id is required');
  const now = new Date().toISOString();
  const existing = (await loadLocation(location.id)) || {};
  const merged = {
    ...existing,
    ...location,
    updatedAt: now,
    createdAt: existing.createdAt || location.createdAt || now,
  };
  await idbPut(STORES.locations, merged);
  return merged;
}

export async function deleteLocation(locationId) {
  try {
    await idbDelete(STORES.locations, locationId);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Story-entity links
// ---------------------------------------------------------------------------

async function loadLink(storyId) {
  const row = await idbGet(STORES.links, storyId);
  return row || { storyId, characterIds: [], locationIds: [] };
}

export async function linkEntityToStory(storyId, entityType, entityId) {
  try {
    const row = await loadLink(storyId);
    const key = entityType === 'character' ? 'characterIds' : 'locationIds';
    const ids = row[key] || [];
    if (!ids.includes(entityId)) ids.push(entityId);
    row[key] = ids;
    await idbPut(STORES.links, row);
    return true;
  } catch {
    return false;
  }
}

export async function unlinkEntityFromStory(storyId, entityType, entityId) {
  try {
    const row = await loadLink(storyId);
    const key = entityType === 'character' ? 'characterIds' : 'locationIds';
    row[key] = (row[key] || []).filter((id) => id !== entityId);
    await idbPut(STORES.links, row);
    return true;
  } catch {
    return false;
  }
}

export async function loadStoryEntities(storyId) {
  try {
    const row = await loadLink(storyId);
    const characters = [];
    const locations = [];
    for (const cid of row.characterIds || []) {
      const c = await loadCharacter(cid);
      if (c) characters.push(c);
    }
    for (const lid of row.locationIds || []) {
      const l = await loadLocation(lid);
      if (l) locations.push(l);
    }
    return { characters, locations };
  } catch {
    return { characters: [], locations: [] };
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function imageKey(projectId, sceneId) {
  return `${projectId}::${sceneId}`;
}

function imagePseudoUrl(projectId, sceneId) {
  return `${IMAGE_URL_PREFIX}${projectId}/${sceneId}`;
}

function parsePseudoUrl(url) {
  if (typeof url !== 'string' || !url.startsWith(IMAGE_URL_PREFIX)) return null;
  const rest = url.slice(IMAGE_URL_PREFIX.length);
  const idx = rest.indexOf('/');
  if (idx <= 0) return null;
  return {
    projectId: rest.slice(0, idx),
    sceneId: rest.slice(idx + 1),
  };
}

export async function saveImage(projectId, sceneId, imageData) {
  if (!imageData) return null;
  const pid = String(projectId || '').trim();
  const sid = String(sceneId || '').trim();
  if (!pid || !sid) return null;
  try {
    await idbPut(STORES.images, {
      key: imageKey(pid, sid),
      projectId: pid,
      sceneId: sid,
      dataUrl: String(imageData),
      updatedAt: new Date().toISOString(),
    });
    return imagePseudoUrl(pid, sid);
  } catch {
    return null;
  }
}

export async function deleteImage(projectId, sceneId) {
  try {
    await idbDelete(STORES.images, imageKey(projectId, sceneId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an image URL for use in <img src>.
 * - `idb://images/{pid}/{sid}` → fetch the stored data URL from IDB.
 * - Anything else → pass through (data URLs, http URLs, svg URLs all work
 *   directly).
 */
export async function resolveImagePath(pathOrUrl) {
  if (!pathOrUrl) return null;
  const parsed = parsePseudoUrl(pathOrUrl);
  if (!parsed) return pathOrUrl;
  try {
    const row = await idbGet(STORES.images, imageKey(parsed.projectId, parsed.sceneId));
    return row?.dataUrl || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bulk export / import — useful for backup + cross-device migration.
// Not part of the public storage-backend surface, but web build needs it.
// ---------------------------------------------------------------------------

export async function exportProjectBundle(projectId) {
  const project = await loadProject(projectId);
  if (!project) return null;
  const db = await openDB();
  const images = await new Promise((resolve, reject) => {
    const t = db.transaction(STORES.images, 'readonly');
    const store = t.objectStore(STORES.images);
    const req = store.openCursor();
    const out = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      if (cursor.value?.projectId === projectId) out.push(cursor.value);
      cursor.continue();
    };
    t.onerror = () => reject(t.error);
  });
  const { characters, locations } = await loadStoryEntities(projectId);
  return {
    schema: 'storyboarder-project@1',
    exportedAt: new Date().toISOString(),
    project,
    images,
    characters,
    locations,
  };
}

export async function importProjectBundle(bundle) {
  if (!bundle || bundle.schema !== 'storyboarder-project@1') {
    throw new Error('Unrecognized export format.');
  }
  if (!bundle.project?.id) throw new Error('Export is missing a project.');
  await saveProject(bundle.project);
  for (const img of bundle.images || []) {
    if (img?.key) await idbPut(STORES.images, img);
  }
  for (const c of bundle.characters || []) {
    if (c?.id) await saveCharacter(c);
  }
  for (const l of bundle.locations || []) {
    if (l?.id) await saveLocation(l);
  }
  return bundle.project.id;
}
