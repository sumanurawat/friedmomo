/**
 * Promise-based dialog store — replaces window.confirm / window.alert.
 *
 * Usage:
 *   import { confirm, alertModal } from '../store/dialog-store.js';
 *
 *   if (!(await confirm({
 *     title: 'Delete scene?',
 *     message: 'This will also delete all shots in it. This cannot be undone.',
 *     destructive: true,
 *     confirmLabel: 'Delete',
 *   }))) return;
 *
 *   await alertModal({ title: 'PDF export failed', message: err.message });
 *
 * The DialogHost component (mounted once at app root) subscribes to this
 * store and renders the modal. Only one dialog is visible at a time; calls
 * that arrive while a dialog is open are queued in order.
 */

import { create } from 'zustand';

let nextId = 1;

export const useDialogStore = create((set, get) => ({
  queue: [],     // [{ id, kind, title, message, destructive, confirmLabel, cancelLabel, resolve }]

  _push(entry) {
    set({ queue: [...get().queue, entry] });
  },

  _resolveTop(result) {
    const [top, ...rest] = get().queue;
    if (!top) return;
    top.resolve(result);
    set({ queue: rest });
  },
}));

/** Resolve `true` on confirm, `false` on cancel / dismiss. */
export function confirm(opts = {}) {
  return new Promise((resolve) => {
    useDialogStore.getState()._push({
      id: nextId++,
      kind: 'confirm',
      title: opts.title || 'Are you sure?',
      message: opts.message || '',
      destructive: !!opts.destructive,
      confirmLabel: opts.confirmLabel || (opts.destructive ? 'Delete' : 'Confirm'),
      cancelLabel: opts.cancelLabel || 'Cancel',
      resolve,
    });
  });
}

/** Always resolves `true` when dismissed. Use for one-way notifications. */
export function alertModal(opts = {}) {
  return new Promise((resolve) => {
    useDialogStore.getState()._push({
      id: nextId++,
      kind: 'alert',
      title: opts.title || 'Notice',
      message: opts.message || '',
      destructive: !!opts.destructive,
      confirmLabel: opts.confirmLabel || 'OK',
      cancelLabel: null,
      resolve,
    });
  });
}
