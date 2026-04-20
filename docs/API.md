# Storyboarder API Reference

Base URL: `http://127.0.0.1:3001`

All requests/responses use `Content-Type: application/json` unless noted.

---

## Health

### `GET /api/health`
Returns server status and workspace path.

**Response:**
```json
{ "status": "ok", "workspace": "/Users/you/Storyboarder" }
```

---

## Settings

### `GET /api/settings`
Load app settings (API keys, model preferences, chat mode).

### `PUT /api/settings`
Save app settings. Body is the full settings object.

**Body:**
```json
{
  "providerKeys": { "openrouter": "sk-or-..." },
  "planningProvider": "openrouter",
  "planningModel": "google/gemini-2.5-flash-preview",
  "imageProvider": "openrouter",
  "imageModel": "google/gemini-2.5-flash-preview-image",
  "chatMode": "lucky"
}
```

---

## Projects

### `GET /api/projects?userId=X`
List all projects for a user. Returns array of `{ id, name, updatedAt, createdAt }`.

### `POST /api/projects`
Create a new project. Body must include `id`.

### `GET /api/projects/:id`
Load a full project (storyboard, chat, entities).

### `PUT /api/projects/:id`
Save/update a project. Merges with existing data.

### `DELETE /api/projects/:id`
Delete a project and all its images.

---

## Characters

### `GET /api/characters?userId=X`
List all characters (optionally filtered by userId).

### `POST /api/characters`
Create a character. Body must include `id`.

### `GET /api/characters/:id`
Load a single character.

### `PUT /api/characters/:id`
Update a character. Merges with existing data.

### `DELETE /api/characters/:id`
Delete a character.

---

## Locations

### `GET /api/locations?userId=X`
List all locations.

### `POST /api/locations`
Create a location. Body must include `id`.

### `GET /api/locations/:id`
Load a single location.

### `PUT /api/locations/:id`
Update a location.

### `DELETE /api/locations/:id`
Delete a location.

---

## Story-Entity Links

### `GET /api/entities/story/:storyId`
Get all characters and locations linked to a story.

**Response:**
```json
{
  "characters": [{ "id": "...", "name": "...", "..." }],
  "locations": [{ "id": "...", "name": "...", "..." }]
}
```

### `POST /api/entities/story/:storyId/link`
Link an entity to a story.

**Body:** `{ "entityType": "character"|"location", "entityId": "..." }`

### `POST /api/entities/story/:storyId/unlink`
Unlink an entity from a story.

**Body:** `{ "entityType": "character"|"location", "entityId": "..." }`

---

## Images

### `GET /api/images/:projectId/:filename`
Serve an image file (returns binary with appropriate Content-Type).

### `POST /api/images/:projectId/:sceneId`
Save an image for a scene.

**Body:** `{ "imageData": "base64-encoded-string-or-data-url" }`

**Response:** `{ "url": "/api/images/proj_xxx/scene_yyy.png" }`

### `DELETE /api/images/:projectId/:sceneId`
Delete an image.

---

## AI

### `POST /api/ai/chat`
Streaming chat completion (SSE). The backend reads the API key from config.

**Body:**
```json
{
  "provider": "openrouter",
  "model": "google/gemini-2.5-flash-preview",
  "systemPrompt": "You are a storyboarding assistant...",
  "messages": [
    { "role": "user", "content": "Tell me a story about..." }
  ]
}
```

**Response:** Server-Sent Events stream (text/event-stream).

### `POST /api/ai/title`
Generate a story title from a user message.

**Body:** `{ "provider": "openrouter", "model": "...", "userMessage": "..." }`

**Response:** `{ "title": "Snow White" }`

### `POST /api/ai/image`
Generate an image.

**Body:** `{ "provider": "openrouter", "model": "...", "prompt": "..." }`

**Response:** `{ "imageUrl": "...", "model": "...", "provider": "...", "latencyMs": 1234 }`

### `POST /api/ai/validate-key`
Validate an API key before saving.

**Body:** `{ "provider": "openrouter", "apiKey": "sk-or-..." }`

**Response:** `{ "valid": true }` or `{ "valid": false, "error": "..." }`

### `GET /api/ai/models?provider=X`
List available models for a provider (reads API key from config).

**Response:** Array of `{ "id": "...", "name": "...", "context_length": 128000 }`
