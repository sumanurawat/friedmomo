import { create } from 'zustand';

import { loadSettings, saveSettings } from '../services/storage.js';
import { validateKey as apiValidateKey, listModels as apiListModels } from '../services/ai-client.js';
import {
  PROVIDERS,
  DEFAULT_PLANNING_PROVIDER,
  DEFAULT_PLANNING_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_IMAGE_MODEL,
  getSuggestedModels,
} from '../config/providers.js';

const CHAT_MODE_OPTIONS = [
  {
    id: 'plan',
    label: "I know what I'm doing",
    description:
      'Best when you already have a somewhat well-defined story or script and want tighter, more deliberate scene updates.',
  },
  {
    id: 'lucky',
    label: 'Auto-Generate',
    description:
      'Best when you only have a rough idea. Storyboarder will extrapolate more aggressively so you can build the story live as you keep chatting.',
  },
];

const DEFAULT_CHAT_MODE = 'lucky';

export const useSettingsStore = create((set, get) => ({
  // Multi-provider API keys: { openrouter: 'sk-or-...', ollama: '...' }
  providerKeys: {},

  // Planning model selection
  planningProvider: DEFAULT_PLANNING_PROVIDER,
  planningModel: DEFAULT_PLANNING_MODEL,

  // Image model selection
  imageProvider: DEFAULT_IMAGE_PROVIDER,
  imageModel: DEFAULT_IMAGE_MODEL,

  // Chat mode
  chatMode: DEFAULT_CHAT_MODE,
  chatModeOptions: CHAT_MODE_OPTIONS,

  // Available providers (static)
  providers: PROVIDERS,

  // Key validation: { openrouter: 'unknown'|'validating'|'valid'|'invalid', ... }
  validationStatus: {},

  // Live model lists fetched from providers: { openrouter: [...], ollama: [...] }
  availableModels: {},

  // Whether models are being fetched: { openrouter: false, ollama: false }
  modelsFetching: {},

  initialized: false,

  // Computed labels for backward compat
  get planningModelLabel() {
    const models = getSuggestedModels(get().planningProvider, 'planning');
    const match = models.find((m) => m.id === get().planningModel);
    return match?.label || get().planningModel || 'Not selected';
  },

  get imageModelLabel() {
    const models = getSuggestedModels(get().imageProvider, 'image');
    const match = models.find((m) => m.id === get().imageModel);
    return match?.label || get().imageModel || 'Not selected';
  },

  init: async () => {
    const settings = await loadSettings();

    const providerKeys = settings?.providerKeys && typeof settings.providerKeys === 'object'
      ? settings.providerKeys
      : {};

    // Migrate old single apiKey to openrouter
    const migratedApiKey = !providerKeys.openrouter && settings?.apiKey;
    if (migratedApiKey) {
      providerKeys.openrouter = String(settings.apiKey).trim();
    }

    const chatMode = sanitizeOption(
      String(settings?.chatMode || DEFAULT_CHAT_MODE).trim(),
      CHAT_MODE_OPTIONS,
      DEFAULT_CHAT_MODE
    );

    set({
      providerKeys,
      planningProvider: String(settings?.planningProvider || DEFAULT_PLANNING_PROVIDER).trim(),
      planningModel: String(settings?.planningModel || DEFAULT_PLANNING_MODEL).trim(),
      imageProvider: String(settings?.imageProvider || DEFAULT_IMAGE_PROVIDER).trim(),
      imageModel: String(settings?.imageModel || DEFAULT_IMAGE_MODEL).trim(),
      chatMode,
      initialized: true,
    });

    // Only persist on init if we actually transformed something (legacy key
    // migration). Otherwise, a race where loadSettings() returns {} (e.g. the
    // backend was briefly unavailable) would PUT an empty payload back and
    // clobber an existing settings file. Real user changes flow through the
    // explicit setters below, which each call persistSettings.
    if (migratedApiKey) {
      await persistSettings(get());
    }
  },

  setProviderKey: async (providerId, key) => {
    const clean = String(key || '').trim();
    const next = { ...get().providerKeys, [providerId]: clean };
    set({ providerKeys: next });
    await persistSettings(get());
  },

  setPlanningProvider: async (providerId) => {
    const clean = String(providerId || '').trim();
    const models = getSuggestedModels(clean, 'planning');
    set({
      planningProvider: clean,
      planningModel: models[0]?.id || '',
    });
    await persistSettings(get());
  },

  setPlanningModel: async (modelId) => {
    set({ planningModel: String(modelId || '').trim() });
    await persistSettings(get());
  },

  setImageProvider: async (providerId) => {
    const clean = String(providerId || '').trim();
    const models = getSuggestedModels(clean, 'image');
    set({
      imageProvider: clean,
      imageModel: models[0]?.id || '',
    });
    await persistSettings(get());
  },

  setImageModel: async (modelId) => {
    set({ imageModel: String(modelId || '').trim() });
    await persistSettings(get());
  },

  setChatMode: async (mode) => {
    const next = sanitizeOption(mode, CHAT_MODE_OPTIONS, DEFAULT_CHAT_MODE);
    set({ chatMode: next });
    await persistSettings(get());
  },

  validateProviderKey: async (providerId) => {
    const apiKey = String(get().providerKeys?.[providerId] || '').trim();
    if (!apiKey) {
      set({ validationStatus: { ...get().validationStatus, [providerId]: 'unknown' } });
      return;
    }

    set({ validationStatus: { ...get().validationStatus, [providerId]: 'validating' } });

    try {
      const result = await apiValidateKey({ provider: providerId, apiKey });
      set({
        validationStatus: {
          ...get().validationStatus,
          [providerId]: result.valid ? 'valid' : 'invalid',
        },
      });
    } catch {
      set({ validationStatus: { ...get().validationStatus, [providerId]: 'invalid' } });
    }
  },

  fetchAvailableModels: async (providerId) => {
    const apiKey = String(get().providerKeys?.[providerId] || '').trim();
    if (!apiKey) return;

    set({ modelsFetching: { ...get().modelsFetching, [providerId]: true } });

    try {
      const models = await apiListModels({ provider: providerId });
      set({
        availableModels: { ...get().availableModels, [providerId]: models },
        modelsFetching: { ...get().modelsFetching, [providerId]: false },
      });
    } catch {
      set({ modelsFetching: { ...get().modelsFetching, [providerId]: false } });
    }
  },
}));

function sanitizeOption(value, options, fallback) {
  const clean = String(value || '').trim();
  if (options.some((option) => option.id === clean)) return clean;
  return fallback;
}

async function persistSettings(state) {
  await saveSettings({
    providerKeys: state.providerKeys,
    planningProvider: state.planningProvider,
    planningModel: state.planningModel,
    imageProvider: state.imageProvider,
    imageModel: state.imageModel,
    chatMode: state.chatMode,
  });
}
