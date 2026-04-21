/**
 * AI Provider definitions and default model suggestions.
 */

export const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    description: 'Access hundreds of models (GPT-4o, Claude, Gemini, Llama, etc.) through one API key.',
  },
];

/**
 * Suggested models per provider. Users can also type custom model IDs.
 */
/**
 * Suggested models per provider.
 * Ordered by capability tier: flagship first, then fast/cheap.
 * Users can also type any custom model ID.
 *
 * OpenRouter IDs sourced from: https://openrouter.ai/models
 */
// The `recommended` flag drives the green "Recommended" badge in Settings →
// Models. Keep it scarce — only flag the single default we want to nudge new
// users toward. Everything else in the list is still discoverable but
// unadorned, so the badge stays meaningful.
export const SUGGESTED_MODELS = {
  openrouter: {
    planning: [
      // --- Flagship / strongest reasoning ---
      { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', tier: 'Flagship', recommended: true },
      { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4', tier: 'Flagship' },
      { id: 'google/gemini-2.5-pro-preview', label: 'Gemini 2.5 Pro', tier: 'Flagship' },
      { id: 'openai/gpt-4.1', label: 'GPT-4.1', tier: 'Flagship' },
      { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', tier: 'Flagship' },

      // --- Strong / great balance of quality and speed ---
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'Strong' },
      { id: 'openai/gpt-4o', label: 'GPT-4o', tier: 'Strong' },
      { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', tier: 'Strong' },

      // --- Fast / cost-effective ---
      { id: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash', tier: 'Fast' },
      { id: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4', tier: 'Fast' },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', tier: 'Fast' },
      { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', tier: 'Fast' },
    ],
    image: [
      // Both are real image-generation endpoints; either is fine, Gemini is cheaper.
      { id: 'google/gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', recommended: true },
      { id: 'openai/gpt-image-1', label: 'GPT Image 1 (DALL-E)', recommended: true },
    ],
  },
};

export const DEFAULT_PLANNING_PROVIDER = 'openrouter';
// Default to Opus 4.7 — the onboarding no longer asks users to pick, so this
// is what they get unless they change it in Settings → Models.
export const DEFAULT_PLANNING_MODEL = 'anthropic/claude-opus-4.7';
export const DEFAULT_IMAGE_PROVIDER = 'openrouter';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

/**
 * Title generator — cheap/fast model. Titles are 2–5 words, so we don't need
 * the planner's flagship reasoning for this. This model is used only for the
 * one-shot "generate a story title" call in server/routes/ai.js.
 *
 * Chosen: google/gemini-2.5-flash-lite — one of the cheapest usable models
 * on OpenRouter. Swap below if you want to try a different cheap/free one.
 */
export const DEFAULT_TITLE_PROVIDER = 'openrouter';
export const DEFAULT_TITLE_MODEL = 'google/gemini-2.5-flash-lite';

export function getProvider(providerId) {
  return PROVIDERS.find((p) => p.id === providerId) || null;
}

export function getSuggestedModels(providerId, type) {
  return SUGGESTED_MODELS[providerId]?.[type] || [];
}
