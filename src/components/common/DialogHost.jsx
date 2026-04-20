import { useEffect, useRef } from 'react';
import { useDialogStore } from '../../store/dialog-store.js';

/**
 * Renders the topmost dialog from the dialog-store queue.
 * Mount once at the app root.
 */
export default function DialogHost() {
  const queue = useDialogStore((s) => s.queue);
  const resolveTop = useDialogStore((s) => s._resolveTop);
  const top = queue[0];
  const confirmBtnRef = useRef(null);
  const cancelBtnRef = useRef(null);

  // Focus the safe default (Cancel for destructive, Confirm otherwise).
  useEffect(() => {
    if (!top) return;
    const target = top.destructive ? cancelBtnRef.current : confirmBtnRef.current;
    target?.focus();
  }, [top?.id, top?.destructive]);

  // ESC cancels, ENTER confirms
  useEffect(() => {
    if (!top) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveTop(top.kind === 'alert');          // alert: OK = true; confirm: cancel = false
      } else if (e.key === 'Enter') {
        const active = document.activeElement;
        // If focus is on cancel, let Enter trigger cancel; otherwise confirm.
        if (active === cancelBtnRef.current) {
          e.preventDefault();
          resolveTop(false);
        } else {
          e.preventDefault();
          resolveTop(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [top?.id, top?.kind, resolveTop]);

  if (!top) return null;

  return (
    <div
      className="sb-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`sb-dialog-title-${top.id}`}
      onMouseDown={(e) => {
        // Click outside the panel = cancel (alert: same as OK)
        if (e.target === e.currentTarget) resolveTop(top.kind === 'alert');
      }}
    >
      <div className={`sb-dialog-panel ${top.destructive ? 'is-destructive' : ''}`}>
        <h3 id={`sb-dialog-title-${top.id}`} className="sb-dialog-title">
          {top.title}
        </h3>
        {top.message ? <p className="sb-dialog-message">{top.message}</p> : null}

        <div className="sb-dialog-actions">
          {top.cancelLabel ? (
            <button
              ref={cancelBtnRef}
              type="button"
              className="sb-btn sb-btn-ghost"
              onClick={() => resolveTop(false)}
            >
              {top.cancelLabel}
            </button>
          ) : null}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`sb-btn ${top.destructive ? 'sb-btn-danger' : 'sb-btn-primary'}`}
            onClick={() => resolveTop(true)}
          >
            {top.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
