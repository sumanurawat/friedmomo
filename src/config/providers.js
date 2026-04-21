/**
 * AI Provider definitions and default model suggestions.
 */

export const PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
    description: 'Access hundreds of models (Claude, Gemini, GPT-5, etc.) through one API key.',
  },
];

/**
 * Suggested models per provider.
 *
 * OpenRouter's catalog rotates fast — older IDs get deprecated and replaced
 * with newer point releases every few months. The list below is curated
 * against the live /v1/models catalog; the Settings → Models page also
 * fetches the catalog live so users can pick anything that's currently
 * available even if it's not in this hand-curated list.
 *
 * The `recommended` flag drives the green "Recommended" badge in Settings →
 * Models. Keep it scarce — one flag per category (planning / image) — so the
 * badge stays meaningful and new users know where to start.
 *
 * Tiers are a hint to the user, not a technical constraint:
 *   Strong    — balanced quality + speed. The default tier.
 *   Flagship  — top-end reasoning, slower and pricier.
 *   Fast      — cheap + low latency, weaker at long structured output.
 *
 * Ordered by expected default experience within each tier.
 */
export const SUGGESTED_MODELS = {
  openrouter: {
    planning: [
      // --- Flagship / strongest reasoning (default) ---
      { id: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', tier: 'Flagship', recommended: true },
      { id: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', tier: 'Flagship' },
      { id: 'openai/gpt-5.4-pro', label: 'GPT-5.4 Pro', tier: 'Flagship' },
      { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', tier: 'Flagship' },

      // --- Strong / balanced (faster, cheaper) ---
      { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', tier: 'Strong' },
      { id: 'openai/gpt-5.4', label: 'GPT-5.4', tier: 'Strong' },
      { id: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini', tier: 'Strong' },

      // --- Fast / cost-effective ---
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', tier: 'Fast' },
      { id: 'google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite', tier: 'Fast' },
    ],
    image: [
      // Currently the only live image-output model on OpenRouter. If others
      // land, add them here and mark only one as `recommended`.
      { id: 'google/gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', recommended: true },
    ],
  },
};

export const DEFAULT_PLANNING_PROVIDER = 'openrouter';
// Opus 4.7 — strongest reasoning in the Claude family, best at following the
// planner's strict JSON contract without dropping updates. Slower to stream
// than Sonnet (2-4 min for a full bootstrap vs 30-45s) but the quality and
// structure-compliance win out for storyboarding where partial/prose-only
// responses leave the user staring at an empty board. Users who want speed
// over reasoning can switch to Sonnet 4.6 in Settings → Models.
export const DEFAULT_PLANNING_MODEL = 'anthropic/claude-opus-4.7';

/**
 * Model IDs that were defaults (or common picks) in earlier builds and are
 * either deprecated on OpenRouter now or replaced by a newer point release.
 * On init, the settings store migrates any saved planningModel matching one
 * of these to the current DEFAULT_PLANNING_MODEL — so a user who onboarded
 * three weeks ago isn't stuck on a silently-rotated-out model forever.
 *
 * Narrow on purpose: we only migrate known-stale IDs, never custom picks
 * from the live OpenRouter catalog that aren't in our curated list.
 */
export const STALE_PLANNING_MODELS = new Set([
  'openai/gpt-4',
  'openai/gpt-4-turbo',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4.1',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
  'anthropic/claude-3-opus',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-sonnet-4',
  'meta-llama/llama-3-70b-instruct',
  'meta-llama/llama-3.1-70b-instruct',
  'meta-llama/llama-3.1-405b-instruct',
]);
export const DEFAULT_IMAGE_PROVIDER = 'openrouter';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

/**
 * Title generator — cheap/fast model. Titles are 2–5 words, so we don't need
 * the planner's flagship reasoning for this. This model is used only for the
 * one-shot "generate a story title" call in ai-direct.js / server/routes/ai.js.
 *
 * Chosen: google/gemini-3.1-flash-lite-preview — cheapest usable planner-class
 * model on OpenRouter right now. Swap below if a cheaper one appears.
 */
export const DEFAULT_TITLE_PROVIDER = 'openrouter';
export const DEFAULT_TITLE_MODEL = 'google/gemini-3.1-flash-lite-preview';

export function getProvider(providerId) {
  return PROVIDERS.find((p) => p.id === providerId) || null;
}

export function getSuggestedModels(providerId, type) {
  return SUGGESTED_MODELS[providerId]?.[type] || [];
}
