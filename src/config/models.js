/**
 * Re-exports from providers.js for backward compatibility.
 */
export {
  DEFAULT_PLANNING_MODEL as FIXED_PLANNING_MODEL,
  DEFAULT_IMAGE_MODEL as FIXED_IMAGE_MODEL,
} from './providers.js';

export const FIXED_PLANNING_MODEL_LABEL = 'Gemini 2.5 Flash';
export const FIXED_IMAGE_MODEL_LABEL = 'Gemini 2.5 Flash Image';
export const FALLBACK_IMAGE_MODEL = '';
export const FALLBACK_IMAGE_MODEL_LABEL = '';
