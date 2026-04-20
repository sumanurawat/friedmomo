import { create } from 'zustand';

import {
  listCharacters,
  loadCharacter,
  saveCharacter,
  deleteCharacter as deleteCharacterApi,
  listLocations,
  loadLocation,
  saveLocation,
  deleteLocation as deleteLocationApi,
  linkEntityToStory,
  unlinkEntityFromStory,
} from '../services/storage.js';

export const useEntityStore = create((set, get) => ({
  allCharacters: [],
  allLocations: [],
  initialized: false,

  init: async () => {
    if (get().initialized) {
      return;
    }
    const characters = await listCharacters();
    const locations = await listLocations();
    set({
      allCharacters: Array.isArray(characters) ? characters : [],
      allLocations: Array.isArray(locations) ? locations : [],
      initialized: true,
    });
  },

  refresh: async () => {
    const characters = await listCharacters();
    const locations = await listLocations();
    set({
      allCharacters: Array.isArray(characters) ? characters : [],
      allLocations: Array.isArray(locations) ? locations : [],
    });
  },

  createCharacter: async (draft) => {
    const result = await saveCharacter(draft);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  updateCharacter: async (id, changes) => {
    const existing = await loadCharacter(id);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...changes, id };
    const result = await saveCharacter(updated);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  removeCharacter: async (id) => {
    const result = await deleteCharacterApi(id);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  createLocation: async (draft) => {
    const result = await saveLocation(draft);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  updateLocation: async (id, changes) => {
    const existing = await loadLocation(id);
    if (!existing) {
      return null;
    }
    const updated = { ...existing, ...changes, id };
    const result = await saveLocation(updated);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  removeLocation: async (id) => {
    const result = await deleteLocationApi(id);
    if (result) {
      await get().refresh();
    }
    return result;
  },

  linkCharacterToStory: async (storyId, characterId) => {
    const result = await linkEntityToStory(storyId, 'character', characterId);
    return result;
  },

  unlinkCharacterFromStory: async (storyId, characterId) => {
    const result = await unlinkEntityFromStory(storyId, 'character', characterId);
    return result;
  },

  linkLocationToStory: async (storyId, locationId) => {
    const result = await linkEntityToStory(storyId, 'location', locationId);
    return result;
  },

  unlinkLocationFromStory: async (storyId, locationId) => {
    const result = await unlinkEntityFromStory(storyId, 'location', locationId);
    return result;
  },
}));
