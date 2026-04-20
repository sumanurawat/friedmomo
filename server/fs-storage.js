/**
 * Filesystem storage engine.
 * All data lives under a workspace directory (default: ~/Storyboarder).
 *
 * Directory layout:
 *   ~/Storyboarder/
 *   ├── config.json                 (settings / API keys)
 *   ├── projects/
 *   │   └── {project-id}/
 *   │       ├── project.json        (storyboard + chat + inline entities)
 *   │       └── images/
 *   │           └── {scene-id}.png
 *   ├── entities/
 *   │   ├── characters.json
 *   │   └── locations.json
 *   └── users/
 *       └── {user-id}.json
 */

import { readFile, writeFile, mkdir, readdir, unlink, rm, access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_WORKSPACE = join(homedir(), 'Storyboarder');

let workspace = DEFAULT_WORKSPACE;

export function getWorkspace() {
  return workspace;
}

export function setWorkspace(dir) {
  workspace = dir;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(join(filePath, '..'));
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config / Settings
// ---------------------------------------------------------------------------

function configPath() {
  return join(workspace, 'config.json');
}

export async function loadSettings() {
  return readJson(configPath(), {});
}

export async function saveSettings(settings) {
  await writeJson(configPath(), settings);
  return true;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function usersDir() {
  return join(workspace, 'users');
}

function userPath(userId) {
  return join(usersDir(), `${userId}.json`);
}

export async function listUsers() {
  await ensureDir(usersDir());
  const files = await readdir(usersDir());
  const users = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const user = await readJson(join(usersDir(), f));
    if (user) users.push(user);
  }
  return users.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function loadUser(userId) {
  return readJson(userPath(userId), null);
}

export async function saveUser(user) {
  const existing = await loadUser(user.id);
  const now = new Date().toISOString();
  const merged = {
    id: user.id,
    displayName: user.displayName || existing?.displayName || user.id,
    storyIds: [...new Set([...(existing?.storyIds || []), ...(user.storyIds || [])])],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJson(userPath(user.id), merged);
  return merged;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function projectsDir() {
  return join(workspace, 'projects');
}

function projectDir(projectId) {
  return join(projectsDir(), projectId);
}

function projectJsonPath(projectId) {
  return join(projectDir(projectId), 'project.json');
}

export async function listProjects(userId) {
  await ensureDir(projectsDir());
  const dirs = await readdir(projectsDir(), { withFileTypes: true });
  const projects = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const proj = await readJson(join(projectsDir(), d.name, 'project.json'));
    if (proj && (!userId || proj.userId === userId)) {
      projects.push({
        id: proj.id,
        name: proj.name,
        updatedAt: proj.updatedAt,
        createdAt: proj.createdAt,
      });
    }
  }
  return projects.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function loadProject(projectId) {
  return readJson(projectJsonPath(projectId), null);
}

export async function saveProject(project) {
  const now = new Date().toISOString();
  const existing = await loadProject(project.id);
  const merged = {
    ...(existing || {}),
    ...project,
    updatedAt: project.updatedAt || now,
    createdAt: existing?.createdAt || project.createdAt || now,
  };
  await writeJson(projectJsonPath(project.id), merged);

  // Update user's storyIds list
  if (merged.userId) {
    const user = await loadUser(merged.userId) || { id: merged.userId };
    const storyIds = [...new Set([...(user.storyIds || []), merged.id])];
    await saveUser({ ...user, storyIds });
  }

  return merged;
}

export async function deleteProject(projectId) {
  const dir = projectDir(projectId);
  if (await fileExists(dir)) {
    await rm(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Characters (global, cross-project)
// ---------------------------------------------------------------------------

function entitiesDir() {
  return join(workspace, 'entities');
}

function charactersPath() {
  return join(entitiesDir(), 'characters.json');
}

export async function listCharacters(userId) {
  const all = await readJson(charactersPath(), []);
  if (!userId) return all;
  return all.filter((c) => !c.userId || c.userId === userId);
}

export async function loadCharacter(characterId) {
  const all = await readJson(charactersPath(), []);
  return all.find((c) => c.id === characterId) || null;
}

export async function saveCharacter(character) {
  const all = await readJson(charactersPath(), []);
  const now = new Date().toISOString();
  const idx = all.findIndex((c) => c.id === character.id);
  const existing = idx >= 0 ? all[idx] : null;
  const merged = {
    ...(existing || {}),
    ...character,
    updatedAt: now,
    createdAt: existing?.createdAt || character.createdAt || now,
  };
  if (idx >= 0) {
    all[idx] = merged;
  } else {
    all.push(merged);
  }
  await writeJson(charactersPath(), all);
  return merged;
}

export async function deleteCharacter(characterId) {
  const all = await readJson(charactersPath(), []);
  const filtered = all.filter((c) => c.id !== characterId);
  if (filtered.length === all.length) return false;
  await writeJson(charactersPath(), filtered);
  return true;
}

// ---------------------------------------------------------------------------
// Locations (global, cross-project)
// ---------------------------------------------------------------------------

function locationsPath() {
  return join(entitiesDir(), 'locations.json');
}

export async function listLocations(userId) {
  const all = await readJson(locationsPath(), []);
  if (!userId) return all;
  return all.filter((l) => !l.userId || l.userId === userId);
}

export async function loadLocation(locationId) {
  const all = await readJson(locationsPath(), []);
  return all.find((l) => l.id === locationId) || null;
}

export async function saveLocation(location) {
  const all = await readJson(locationsPath(), []);
  const now = new Date().toISOString();
  const idx = all.findIndex((l) => l.id === location.id);
  const existing = idx >= 0 ? all[idx] : null;
  const merged = {
    ...(existing || {}),
    ...location,
    updatedAt: now,
    createdAt: existing?.createdAt || location.createdAt || now,
  };
  if (idx >= 0) {
    all[idx] = merged;
  } else {
    all.push(merged);
  }
  await writeJson(locationsPath(), all);
  return merged;
}

export async function deleteLocation(locationId) {
  const all = await readJson(locationsPath(), []);
  const filtered = all.filter((l) => l.id !== locationId);
  if (filtered.length === all.length) return false;
  await writeJson(locationsPath(), filtered);
  return true;
}

// ---------------------------------------------------------------------------
// Story-entity links
// ---------------------------------------------------------------------------

function linksPath() {
  return join(entitiesDir(), 'links.json');
}

export async function loadStoryEntities(storyId) {
  const links = await readJson(linksPath(), {});
  const entry = links[storyId] || { characterIds: [], locationIds: [] };
  const characters = [];
  const locations = [];
  for (const cid of entry.characterIds || []) {
    const c = await loadCharacter(cid);
    if (c) characters.push(c);
  }
  for (const lid of entry.locationIds || []) {
    const l = await loadLocation(lid);
    if (l) locations.push(l);
  }
  return { characters, locations };
}

export async function linkEntityToStory(storyId, entityType, entityId) {
  const links = await readJson(linksPath(), {});
  if (!links[storyId]) links[storyId] = { characterIds: [], locationIds: [] };
  const key = entityType === 'character' ? 'characterIds' : 'locationIds';
  const arr = links[storyId][key] || [];
  if (!arr.includes(entityId)) arr.push(entityId);
  links[storyId][key] = arr;
  await writeJson(linksPath(), links);
  return true;
}

export async function unlinkEntityFromStory(storyId, entityType, entityId) {
  const links = await readJson(linksPath(), {});
  if (!links[storyId]) return false;
  const key = entityType === 'character' ? 'characterIds' : 'locationIds';
  links[storyId][key] = (links[storyId][key] || []).filter((id) => id !== entityId);
  await writeJson(linksPath(), links);
  return true;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

function imagesDir(projectId) {
  return join(projectDir(projectId), 'images');
}

export async function saveImage(projectId, sceneId, imageData) {
  const dir = imagesDir(projectId);
  await ensureDir(dir);

  // imageData can be a base64 string or a Buffer
  let buffer;
  let ext = 'png';
  if (typeof imageData === 'string') {
    // Check for data URL prefix
    const match = imageData.match(/^data:image\/(\w+);base64,/);
    if (match) {
      ext = match[1];
      buffer = Buffer.from(imageData.slice(match[0].length), 'base64');
    } else {
      buffer = Buffer.from(imageData, 'base64');
    }
  } else {
    buffer = imageData;
  }

  const filename = `${sceneId}.${ext}`;
  const filePath = join(dir, filename);
  await writeFile(filePath, buffer);
  return `/api/images/${projectId}/${filename}`;
}

export async function deleteImage(projectId, sceneId) {
  const dir = imagesDir(projectId);
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith(sceneId + '.')) {
        await unlink(join(dir, f));
        return true;
      }
    }
  } catch {
    // directory doesn't exist
  }
  return false;
}

export async function resolveImagePath(projectId, filename) {
  const filePath = join(imagesDir(projectId), filename);
  if (await fileExists(filePath)) return filePath;
  return null;
}

// ---------------------------------------------------------------------------
// Init workspace
// ---------------------------------------------------------------------------

export async function initWorkspace() {
  await ensureDir(workspace);
  await ensureDir(join(workspace, 'projects'));
  await ensureDir(join(workspace, 'entities'));
  await ensureDir(join(workspace, 'users'));
  console.log(`[Storyboarder] Workspace: ${workspace}`);
  return workspace;
}
