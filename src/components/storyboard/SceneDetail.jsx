import { useEffect, useRef, useState } from 'react';

import { useLightbox } from '../../store/lightbox-store.js';

const MAX_UPLOAD_MB = 5;

export default function SceneDetail({
  scene,
  sceneContextLabel,
  entities,
  onClose,
  onDeleteScene,
  onUpdateScene,
  onSetSceneImage,
  onGenerateAiImage,
  onSetSceneCharacters,
  onCreateCharacter,
  onEnhanceSceneWithAi,
  showToast,
}) {
  const characters = Array.isArray(entities?.characters) ? entities.characters : [];
  const [draft, setDraft] = useState(createDraft(scene));
  const [imageError, setImageError] = useState('');
  const [newCharacterName, setNewCharacterName] = useState('');
  const [newCharacterDescription, setNewCharacterDescription] = useState('');
  const [aiScenePrompt, setAiScenePrompt] = useState('');
  const [aiImagePrompt, setAiImagePrompt] = useState('');
  const openLightbox = useLightbox((state) => state.open);

  const selectedCharacterIds = Array.isArray(scene?.characterIds) ? scene.characterIds : [];

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDraft(createDraft(scene));
      setAiImagePrompt('');
      setAiScenePrompt('');
      setImageError('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scene]);

  if (!scene) {
    return (
      <aside className="sb-scene-detail">
        <header className="sb-scene-detail-head">
          <h3>Shot Inspector</h3>
        </header>
        <div className="sb-shot-inspector-empty">
          <div className="sb-shot-inspector-empty-icon" aria-hidden="true">◧</div>
          <h3>No shot selected</h3>
          <p>
            Click a shot card on the storyboard to edit its title, cast, and visuals here.
            Chat focus follows your selection automatically.
          </p>
          <p style={{ marginTop: '0.35rem' }}>
            Tip: press <kbd>Esc</kbd> to close any open panel.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="sb-scene-detail">
      <header className="sb-scene-detail-head">
        <div>
          <h3>{scene.title || 'Untitled Shot'}</h3>
          <p>{sceneContextLabel || 'Shot Details'}</p>
        </div>

        <div className="sb-inspector-actions">
          <button type="button" className="sb-btn sb-btn-xs" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="sb-scene-delete"
            title="Delete shot"
            onClick={() => onDeleteScene?.(scene.id)}
          >
            ×
          </button>
        </div>
      </header>

      <div className="sb-inspector-scroll">
        <section className="sb-detail-block">
          <h4>Edit Shot</h4>
          <FieldLabel
            label="Shot title"
            hint="A short production-facing name for the frame or beat."
          />
          <input
            value={draft.title}
            onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
            placeholder="Shot title"
          />
          <FieldLabel
            label="Location"
            hint="Where the shot takes place. Use screenplay-style location text if useful."
          />
          <input
            value={draft.location}
            onChange={(event) => setDraft((value) => ({ ...value, location: event.target.value }))}
            placeholder="Location"
          />
          <FieldLabel
            label="Time"
            hint="Time of day or scene timing, like dawn, rush hour, or high noon."
          />
          <input
            value={draft.time}
            onChange={(event) => setDraft((value) => ({ ...value, time: event.target.value }))}
            placeholder="Time"
          />
          <FieldLabel
            label="Story function"
            hint="Why this shot exists in the sequence. What does it establish, shift, or reveal?"
          />
          <AutoTextarea
            value={draft.storyFunction}
            onChange={(event) => setDraft((value) => ({ ...value, storyFunction: event.target.value }))}
            placeholder="Story function"
          />
          <FieldLabel
            label="Visual direction"
            hint="What the camera should see first: composition, landmarks, props, staging, and mood."
          />
          <AutoTextarea
            value={draft.visualDescription}
            onChange={(event) => setDraft((value) => ({ ...value, visualDescription: event.target.value }))}
            placeholder="Visual direction"
          />
          <FieldLabel
            label="Action"
            hint="What physically happens in the frame. Focus on blocking, motion, and the key on-screen beat."
          />
          <AutoTextarea
            value={draft.action}
            onChange={(event) => setDraft((value) => ({ ...value, action: event.target.value }))}
            placeholder="Action"
          />
          <FieldLabel
            label="Mood"
            hint="The emotional temperature of the frame: tense, playful, eerie, triumphant."
          />
          <AutoTextarea
            value={draft.mood}
            onChange={(event) => setDraft((value) => ({ ...value, mood: event.target.value }))}
            placeholder="Mood"
          />
          <button
            type="button"
            className="sb-btn sb-btn-primary"
            onClick={async () => {
              try {
                await onUpdateScene?.(scene.id, draft);
                showToast?.('Shot saved successfully', 'success');
              } catch (error) {
                showToast?.(error.message || 'Failed to save shot', 'error');
              }
            }}
          >
            Save Shot
          </button>
        </section>

        <section className="sb-detail-block">
          <h4>Characters in Shot</h4>
          <div className="sb-check-grid">
            {characters.map((character) => {
              const checked = selectedCharacterIds.includes(character.id);
              return (
                <label key={character.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      if (event.target.checked) {
                        onSetSceneCharacters?.(scene.id, [...selectedCharacterIds, character.id]);
                        return;
                      }
                      onSetSceneCharacters?.(
                        scene.id,
                        selectedCharacterIds.filter((id) => id !== character.id)
                      );
                    }}
                  />
                  <span>{character.name}</span>
                </label>
              );
            })}
            {characters.length === 0 ? <p className="sb-hint">No characters yet. Create one below.</p> : null}
          </div>

          <div className="sb-inline-label">Create Character + Link</div>
          <FieldLabel
            label="Character name"
            hint="Add a new recurring character and link them to this shot."
          />
          <input
            value={newCharacterName}
            onChange={(event) => setNewCharacterName(event.target.value)}
            placeholder="Character name"
          />
          <FieldLabel
            label="Character description"
            hint="A short visual/personality note so the character stays consistent."
          />
          <AutoTextarea
            value={newCharacterDescription}
            onChange={(event) => setNewCharacterDescription(event.target.value)}
            placeholder="Character description"
          />
          <button
            type="button"
            className="sb-btn"
            onClick={async () => {
              const createdId = await onCreateCharacter?.(
                {
                  name: newCharacterName,
                  description: newCharacterDescription,
                  role: 'Supporting',
                },
                { linkToSceneId: scene.id }
              );
              if (createdId) {
                setNewCharacterName('');
                setNewCharacterDescription('');
              }
            }}
          >
            Add Character
          </button>
        </section>

        <section className="sb-detail-block">
          <h4>Shot Image</h4>
          {scene.imageStatus === 'generating' ? (
            <div className="sb-image-generating">
              <div className="sb-spinner" />
              <p className="sb-hint">Generating image...</p>
            </div>
          ) : scene.imageUrl ? (
            <div className="sb-image-preview">
              <img
                src={resolveLocalImage(scene.imageUrl)}
                alt={scene.title || 'Shot preview'}
                className="sb-scene-thumb-clickable"
                title="Click to enlarge"
                onClick={() => openLightbox({
                  imageUrl: resolveLocalImage(scene.imageUrl),
                  title: scene.title || 'Shot',
                  subtitle: [sceneContextLabel, scene.location].filter(Boolean).join(' · '),
                })}
              />
              <button
                type="button"
                className="sb-scene-delete"
                title="Remove image"
                onClick={() => onSetSceneImage?.(scene.id, null)}
              >
                ×
              </button>
            </div>
          ) : (
            <p className="sb-hint">No image yet.</p>
          )}

          {scene.imageStatus === 'error' ? (
            <p className="sb-error">Image generation failed: {scene.imageError || 'Unknown error'}</p>
          ) : null}
          {scene.imageStatus === 'fallback' ? (
            <p className="sb-hint">
              Showing a locally composed fallback frame. Retry image generation to replace it with a hosted render.
            </p>
          ) : null}
          {scene.imageModelResolved || scene.imageAttemptedAt || scene.imageDiagnosticCode ? (
            <div className="sb-image-meta">
              {scene.imageModelResolved ? <p><strong>Model:</strong> {scene.imageModelResolved}</p> : null}
              {scene.imageAttemptedAt ? (
                <p><strong>Last attempt:</strong> {new Date(scene.imageAttemptedAt).toLocaleString()}</p>
              ) : null}
              {scene.imageDiagnosticCode ? (
                <p><strong>Status:</strong> {scene.imageDiagnosticCode}</p>
              ) : null}
              {scene.imageDiagnosticMessage ? (
                <p><strong>Details:</strong> {scene.imageDiagnosticMessage}</p>
              ) : null}
            </div>
          ) : null}

          <label className="sb-upload-label">
            Upload (max {MAX_UPLOAD_MB}MB)
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }

                const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
                if (file.size > maxBytes) {
                  setImageError(`Image is too large. Please upload up to ${MAX_UPLOAD_MB}MB.`);
                  return;
                }

                const reader = new FileReader();
                reader.onload = () => {
                  setImageError('');
                  onSetSceneImage?.(scene.id, String(reader.result || ''));
                };
                reader.onerror = () => {
                  setImageError('Could not read image file.');
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {imageError ? <p className="sb-error">{imageError}</p> : null}

          <FieldLabel
            label="Additional image direction"
            hint="Optional. Leave blank to regenerate from the saved shot details. Add only extra visual guidance here."
          />
          <AutoTextarea
            value={aiImagePrompt}
            onChange={(event) => setAiImagePrompt(event.target.value)}
            placeholder="Optional extra direction for the hosted image model"
          />
          <button
            type="button"
            className="sb-btn"
            onClick={async () => {
              try {
                await onUpdateScene?.(scene.id, draft);
                await onGenerateAiImage?.(scene.id, {
                  draft,
                  additionalDirection: aiImagePrompt,
                });
              } catch (error) {
                showToast?.(error.message || 'Failed to regenerate image', 'error');
              }
            }}
          >
            Regenerate AI Image
          </button>
          {(scene.imageDiagnosticCode === 'no_image_text_only' ||
            scene.imageDiagnosticCode === 'no_image_empty_response') ? (
              <p className="sb-hint">
                Retry with a simpler, more visual prompt. Dense screenplay-style prompts are less reliable for image generation.
              </p>
            ) : null}
        </section>

        <section className="sb-detail-block">
          <h4>AI Shot Enhancement</h4>
          <FieldLabel
            label="Shot enhancement request"
            hint="Ask for rewrites, alternate blocking, stronger mood, or another version of this shot."
          />
          <AutoTextarea
            value={aiScenePrompt}
            onChange={(event) => setAiScenePrompt(event.target.value)}
            placeholder="Tell AI how to improve this shot or request alternate versions"
          />
          <button
            type="button"
            className="sb-btn"
            onClick={() => onEnhanceSceneWithAi?.(scene.id, aiScenePrompt)}
          >
            Ask AI
          </button>
        </section>
      </div>
    </aside>
  );
}

function FieldLabel({ label, hint }) {
  return (
    <div className="sb-field-label">
      <strong>{label}</strong>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

function AutoTextarea({ value, onChange, placeholder }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={1}
      placeholder={placeholder}
      className="sb-auto-textarea"
    />
  );
}

function createDraft(scene) {
  return {
    title: String(scene?.title || ''),
    location: String(scene?.location || ''),
    time: String(scene?.time || ''),
    visualDescription: String(scene?.visualDescription || ''),
    action: String(scene?.action || ''),
    mood: String(scene?.mood || ''),
    storyFunction: String(scene?.storyFunction || ''),
  };
}

function resolveLocalImage(imageUrl) {
  if (!imageUrl) {
    return '';
  }
  // Convert legacy file:// URLs to sb-local:// protocol
  if (imageUrl.startsWith('file://')) {
    const imagesIdx = imageUrl.indexOf('/images/');
    if (imagesIdx !== -1) {
      return `sb-local://media${imageUrl.slice(imagesIdx)}`;
    }
  }
  if (imageUrl.startsWith('sb-local://') || imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:')) {
    return imageUrl;
  }
  return imageUrl;
}
