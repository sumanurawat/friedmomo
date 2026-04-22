import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { useLightbox } from '../../store/lightbox-store.js';

/**
 * Full-screen modal overlay for a shot image. Opens when any component in
 * the app calls useLightbox().open({ imageUrl, title, subtitle }).
 *
 * UX rules:
 * - Esc closes.
 * - Click on the backdrop (outside the image) closes.
 * - Click on the image itself does NOT close — that's a natural affordance to
 *   pan/inspect. The explicit Close button in the top-right is the always-on
 *   escape hatch.
 * - Body scroll is locked while the lightbox is open so the page doesn't
 *   drift behind the overlay.
 *
 * Mounted once at the root via AppLayout; no per-card plumbing needed.
 */
export default function ShotImageLightbox() {
  const active = useLightbox((state) => state.active);
  const close = useLightbox((state) => state.close);

  useEffect(() => {
    if (!active) return undefined;

    const handleKeydown = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeydown);

    // Lock background scroll while the overlay is up — sticks to the
    // previous overflow so we don't clobber any custom value.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [active, close]);

  if (!active || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="sb-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={active.title || 'Shot image'}
      onClick={close}
    >
      <button
        type="button"
        className="sb-lightbox-close"
        onClick={close}
        aria-label="Close image"
      >
        ×
      </button>

      <figure
        className="sb-lightbox-figure"
        // Stop-propagation so clicks on the image area don't close the
        // overlay — only the backdrop / close button do.
        onClick={(event) => event.stopPropagation()}
      >
        <img
          className="sb-lightbox-image"
          src={active.imageUrl}
          alt={active.title || 'Shot image'}
        />
        {(active.title || active.subtitle) ? (
          <figcaption className="sb-lightbox-caption">
            {active.title ? <strong>{active.title}</strong> : null}
            {active.subtitle ? <span>{active.subtitle}</span> : null}
          </figcaption>
        ) : null}
      </figure>
    </div>,
    document.body
  );
}
