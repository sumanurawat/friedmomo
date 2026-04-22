import { create } from 'zustand';

/**
 * Tiny global store for the shot-image lightbox. Anything in the app that
 * renders a shot thumbnail can call `useLightbox.getState().open(...)` or
 * `const open = useLightbox((s) => s.open)` to pop the full-size view;
 * a single <ShotImageLightbox /> mounted at the app root handles rendering.
 *
 * Kept deliberately tiny (active + open + close) so there's no prop
 * plumbing through storyboard / grid / card / detail.
 */
export const useLightbox = create((set) => ({
  /** { imageUrl, title, subtitle } | null */
  active: null,

  open: ({ imageUrl, title, subtitle } = {}) => {
    if (!imageUrl) return;
    set({ active: { imageUrl: String(imageUrl), title: String(title || ''), subtitle: String(subtitle || '') } });
  },

  close: () => set({ active: null }),
}));
