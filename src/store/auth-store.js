import { create } from 'zustand';

import { setActiveUserId, getActiveUserId } from '../services/storage.js';

/**
 * Simplified auth store for local-only Electron app.
 * No Firebase, no cloud auth — always runs as a local user.
 */
export const useAuthStore = create((set) => ({
  user: null,
  loading: true,
  guestMode: true,
  authAvailable: false,

  init: () => {
    setActiveUserId(getActiveUserId());
    set({ user: null, loading: false, guestMode: true, authAvailable: false });
  },

  signInWithGoogle: null,
  signOut: null,

  continueAsGuest: () => {
    setActiveUserId(getActiveUserId());
    set({ user: null, loading: false, guestMode: true });
  },

  exitGuestMode: null,
}));
