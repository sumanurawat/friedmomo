# Storyboarder Roadmap

## Current Status (v0.2.0)

**Local-first single-user app** with a proper backend server and filesystem storage.

### What's Working
- [x] Local backend server (Node.js, zero dependencies)
- [x] Filesystem storage in `~/Storyboarder/`
- [x] REST API for all CRUD operations (projects, characters, locations, images)
- [x] AI proxy (chat, image generation, title generation) through backend
- [x] API key validation and model listing
- [x] Frontend rewired to use backend API (no more localStorage)
- [x] Vite proxy for seamless dev experience
- [x] Multi-provider AI support (OpenRouter + Ollama Cloud)
- [x] Streaming chat with SSE
- [x] 3-act storyboard structure (acts → sequences → shots)
- [x] Scene detail editor (title, location, time, visual description, action, dialogue, mood)
- [x] Character and location entity management
- [x] PDF export
- [x] Dark/light theme
- [x] Tutorial overlay

### What's Not Working Yet
- [ ] Image generation saves to filesystem (backend endpoint exists, frontend not fully wired)
- [ ] Cross-project entity registry (backend ready, frontend entity panel still uses inline project entities)

---

## Phase 1: Polish for Personal Use (Current Focus)

The goal is to make the app feel like a real creative tool for a single user.

### UI/UX
- [ ] Improve chat panel responsiveness and layout
- [ ] Better scene card design with thumbnails
- [ ] Drag-and-drop reordering polish
- [ ] Keyboard shortcuts for common actions
- [ ] Undo/redo support
- [ ] Auto-save indicator
- [ ] Better error messages and loading states

### Data & Storage
- [ ] Wire up image generation to save to filesystem via backend
- [ ] Wire up global entity panel to use backend entity APIs
- [ ] Project export/import (zip file with all data + images)
- [ ] Backup/restore functionality

### AI
- [ ] Improve system prompts for better storyboard generation
- [ ] Scene-level AI refinement (enhance a single scene)
- [ ] Character arc suggestions
- [ ] Story structure analysis/feedback

---

## Phase 2: Authentication & Multi-User

- [ ] Add Firebase Auth (Google sign-in) — auth store is already stubbed
- [ ] User profiles and preferences
- [ ] Per-user workspaces
- [ ] Session management

---

## Phase 3: Cloud Deployment

- [ ] Swap `fs-storage.js` with a database adapter (Firestore / Postgres)
- [ ] Deploy backend to Cloud Run / Railway
- [ ] Image storage to S3/GCS
- [ ] Deploy frontend to Vercel / Firebase Hosting
- [ ] Re-enable CI/CD workflows

---

## Phase 4: Distribution

Options (not mutually exclusive):
- [ ] **Electron app** — bundle backend + frontend, full desktop experience
- [ ] **PWA** — service worker, offline support, installable
- [ ] **Web app** — hosted SaaS version

---

## Architecture Principles

1. **Backend owns all data** — the frontend is a thin client
2. **Same API everywhere** — web, Electron, and cloud all call the same REST endpoints
3. **No external backend dependencies** — the Node.js server uses only built-ins
4. **Local-first** — works offline (except AI calls), data lives on your machine
5. **Cloud-ready** — swap the storage layer, deploy the same routes
