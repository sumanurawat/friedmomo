# Storyboarder Setup Guide

## Prerequisites

- **Node.js 18+** (uses built-in `fetch`, ES modules)
- An **OpenRouter API key** (get one at https://openrouter.ai/keys)

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USER/storyboarder-next.git
cd storyboarder-next

# 2. Install dependencies
npm install

# 3. Start the app (backend + frontend)
npm run dev
```

This starts:
- **Backend server** at `http://127.0.0.1:3001`
- **Frontend** at `http://127.0.0.1:4173`

Open `http://127.0.0.1:4173` in your browser.

## First-time Setup

1. Click the **gear icon** (Settings) in the top-right
2. Go to **API Keys** and enter your OpenRouter key
3. Go to **Models** and select your preferred planning + image models
4. Go back to the main view and create a story!

## Workspace

All data is stored locally at `~/Storyboarder/`:

```
~/Storyboarder/
├── config.json                 — settings & API keys
├── projects/
│   └── {project-id}/
│       ├── project.json        — storyboard, chat history, entities
│       └── images/             — generated scene images
├── entities/
│   ├── characters.json         — global character registry
│   ├── locations.json          — global location registry
│   └── links.json              — story↔entity relationships
└── users/
    └── {user-id}.json          — user profiles
```

To change the workspace location:
```bash
STORYBOARDER_WORKSPACE=/path/to/my/workspace npm run dev
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start backend + frontend (full app) |
| `npm run dev:server` | Start only the backend server |
| `npm run dev:client` | Start only the Vite frontend |
| `npm run build` | Production build of the frontend |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STORYBOARDER_PORT` | `3001` | Backend server port |
| `STORYBOARDER_WORKSPACE` | `~/Storyboarder` | Data storage directory |

## Troubleshooting

### "Failed to fetch" errors in the UI
The backend server might not be running. Make sure both processes are up:
```bash
# Check if backend is running
curl http://127.0.0.1:3001/api/health

# If not, start it separately
npm run dev:server
```

### Port already in use
Kill existing processes:
```bash
lsof -i :3001  # find the PID
kill <PID>
```

### Data not persisting
Check that `~/Storyboarder/` exists and is writable:
```bash
ls -la ~/Storyboarder/
```
