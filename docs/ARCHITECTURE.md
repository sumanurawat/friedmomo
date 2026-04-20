# Storyboarder Architecture

## Overview

Storyboarder is a **local-first, conversation-driven storyboarding studio**. Users chat with an AI assistant to develop stories, which are structured into acts, sequences, and shots with visual previews.

The app runs as two processes on the developer's machine:
1. **Backend server** (Node.js, port 3001) — owns all data, proxies AI calls
2. **Frontend** (Vite + React 19, port 4173) — UI, proxies `/api/*` to backend

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  React 19 + Zustand (state management)       │
│  Vite dev server (port 4173)                 │
│  /api/* → proxy to backend                   │
└────────────────────┬────────────────────────┘
                     │ fetch /api/*
                     ▼
┌─────────────────────────────────────────────┐
│           Backend Server (port 3001)         │
│  Node.js HTTP server, no dependencies        │
│                                              │
│  Routes:                                     │
│    /api/projects    — CRUD projects           │
│    /api/characters  — CRUD characters         │
│    /api/locations   — CRUD locations           │
│    /api/entities    — story-entity links       │
│    /api/images      — serve/save images        │
│    /api/settings    — app config & API keys    │
│    /api/ai/*        — proxy to AI providers    │
│    /api/health      — health check             │
└────────────────────┬────────────────────────┘
                     │ filesystem
                     ▼
┌─────────────────────────────────────────────┐
│          ~/Storyboarder/ (workspace)         │
│                                              │
│  config.json           — settings, API keys   │
│  projects/                                    │
│    {project-id}/                              │
│      project.json      — storyboard + chat    │
│      images/           — generated images     │
│  entities/                                    │
│    characters.json     — global characters    │
│    locations.json      — global locations     │
│    links.json          — story↔entity links   │
│  users/                                       │
│    {user-id}.json      — user profile         │
└─────────────────────────────────────────────┘
```

## Key Design Decisions

### Local-first, cloud-ready
All data lives on the local filesystem in `~/Storyboarder/`. The backend server is a thin REST layer over the filesystem. To move to cloud:
- Swap `fs-storage.js` with a database adapter (Firebase, Postgres, S3, etc.)
- Deploy the same Express routes to Cloud Run / Railway / etc.
- The frontend doesn't change at all — it just calls `/api/*`

### No external dependencies for the backend
The backend uses only Node.js built-in modules (`node:http`, `node:fs`, `node:path`). Zero npm dependencies. This makes it trivially portable — works in Electron, Docker, or bare metal.

### API keys stay server-side
The frontend sends AI requests to `/api/ai/chat`, `/api/ai/image`, etc. The backend reads API keys from `config.json` and forwards requests to providers (OpenRouter, Ollama). Keys never touch the browser after initial setup.

### Entities are global, not per-project
Characters and locations live in `entities/characters.json` and `entities/locations.json`. They can be linked to multiple stories via `entities/links.json`. Projects also keep inline copies for convenience (the storyboard JSON contains entity data for that story).

## Data Model

### Project
```json
{
  "id": "proj_1712345678_abc12",
  "userId": "guest_xxxxxxxx",
  "name": "Snow White",
  "createdAt": "2026-04-07T...",
  "updatedAt": "2026-04-07T...",
  "messages": [
    { "role": "assistant", "content": "...", "timestamp": "..." },
    { "role": "user", "content": "...", "timestamp": "..." }
  ],
  "storyboard": {
    "acts": [
      {
        "number": 1,
        "title": "SETUP",
        "sequences": [
          {
            "number": 1,
            "title": "Status Quo + Inciting Incident",
            "scenes": [
              {
                "id": "scene_abc",
                "title": "Dawn Patrol",
                "location": "City rooftop",
                "time": "Dawn",
                "visualDescription": "...",
                "action": "...",
                "dialogue": [{ "character": "Reyes", "line": "..." }],
                "mood": "tense",
                "storyFunction": "...",
                "characterIds": ["detective_reyes"],
                "imageUrl": "/api/images/proj_xxx/scene_abc.png",
                "imageStatus": "idle"
              }
            ]
          }
        ]
      }
    ],
    "storyBeats": { "openingImage": null, "statusQuo": null, "...": null }
  },
  "entities": {
    "characters": [{ "id": "detective_reyes", "name": "Detective Reyes", "..." }],
    "locations": [{ "id": "city_rooftop", "name": "City Rooftop", "..." }]
  }
}
```

### Character
```json
{
  "id": "detective_reyes",
  "userId": "guest_xxx",
  "name": "Detective Reyes",
  "description": "A sharp, closed-off detective...",
  "visualPromptDescription": "Late-30s Latina woman, short dark hair...",
  "role": "Protagonist",
  "firstAppearance": "1.1.1",
  "color": "#10a37f",
  "tags": [],
  "createdAt": "2026-04-07T...",
  "updatedAt": "2026-04-07T..."
}
```

### Location
```json
{
  "id": "city_rooftop",
  "userId": "guest_xxx",
  "name": "City Rooftop",
  "description": "The recurring visual anchor...",
  "visualPromptDescription": "Urban rooftop, ventilation ducts...",
  "mood": "Isolation, perspective",
  "tags": [],
  "createdAt": "2026-04-07T...",
  "updatedAt": "2026-04-07T..."
}
```

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19.2 | Functional components, hooks |
| State | Zustand 5 | 4 stores: auth, settings, project, entity |
| Build | Vite 7.3 | Dev server + HMR + API proxy |
| Backend | Node.js (built-in http) | Zero dependencies |
| Storage | Filesystem (JSON + images) | ~/Storyboarder/ |
| AI | OpenRouter, Ollama Cloud | BYOK (bring your own key) |
| Styling | Custom CSS | Dark/light theme |

## AI Provider Support

| Provider | Planning (text) | Image Generation |
|----------|----------------|-----------------|
| OpenRouter | Claude, GPT-4, Gemini, Llama, etc. | Gemini Flash Image, DALL-E |
| Ollama Cloud | Llama, Mistral, Gemma, DeepSeek | Not supported |
