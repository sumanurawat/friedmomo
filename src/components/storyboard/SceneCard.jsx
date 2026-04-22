import { useLightbox } from '../../store/lightbox-store.js';

export default function SceneCard({
  scene,
  actColor,
  isSelected,
  onSelect,
  onDelete,
  onGenerateImage,
  diffType,
  characterNames,
  onCharacterClick,
  sequenceLabel,
  dragPayload,
  isDropTarget,
  onDropAt,
  onDragOverAt,
  compact = false,
}) {
  const openLightbox = useLightbox((state) => state.open);

  // Handler shared by both compact + full thumbnail img tags. We stop
  // propagation so clicking the image doesn't also trigger the outer
  // card's onSelect — opening the lightbox is its own intent, distinct
  // from selecting the shot for inspector editing.
  const handleThumbClick = (event) => {
    event.stopPropagation();
    if (!scene.imageUrl) return;
    openLightbox({
      imageUrl: resolveLocalImage(scene.imageUrl),
      title: scene.title || 'Shot',
      subtitle: [sequenceLabel, scene.location].filter(Boolean).join(' · '),
    });
  };
  const toneLabel = diffType === 'added' ? 'New' : diffType === 'updated' ? 'Updated' : '';
  const characters = Array.isArray(characterNames) ? characterNames : [];
  const firstCharacters = characters.slice(0, 2);
  const remaining = Math.max(0, characters.length - firstCharacters.length);
  function getDropPosition(event) {
    const target = event.currentTarget;
    if (!(target instanceof Element)) {
      return 'before';
    }
    const rect = target.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    return event.clientY >= midpoint ? 'after' : 'before';
  }

  return (
    <article
      className={`sb-scene-card ${compact ? 'is-compact' : ''} ${isSelected ? 'active' : ''} ${diffType ? `is-${diffType}` : ''} ${
        isDropTarget ? 'is-drop-target' : ''
      }`}
      draggable
      onDragStart={(event) => {
        event.stopPropagation();
        const scenePayload = {
          type: 'scene',
          sceneId: scene.id,
          sourceActNumber: dragPayload?.sourceActNumber,
          sourceSequenceNumber: dragPayload?.sourceSequenceNumber,
        };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-storyboard-scene', JSON.stringify(scenePayload));
        event.dataTransfer.setData('text/plain', JSON.stringify(scenePayload));
      }}
      onDragOver={(event) => {
        event.stopPropagation();
        onDragOverAt?.(event, getDropPosition(event));
      }}
      onDrop={(event) => {
        event.stopPropagation();
        onDropAt?.(event, getDropPosition(event));
      }}
      title={scene.storyFunction || scene.mood || scene.title}
    >
      {compact ? (
        <div
          className="sb-scene-main sb-scene-main-compact"
          role="button"
          tabIndex={0}
          onClick={() => onSelect?.(scene.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect?.(scene.id);
            }
          }}
        >
          <div
            className={`sb-scene-thumb sb-scene-thumb-compact ${scene.imageStatus === 'generating' ? 'is-generating' : ''} ${
              scene.imageUrl ? 'has-image' : ''
            }`}
            style={{ borderColor: `${actColor}55` }}
          >
            {scene.imageStatus === 'generating' ? (
              <div className="sb-scene-spinner">
                <div className="sb-spinner" />
                <small>Generating...</small>
              </div>
            ) : scene.imageUrl ? (
              <img
                className="sb-scene-thumb-media sb-scene-thumb-clickable"
                src={resolveLocalImage(scene.imageUrl)}
                alt={`${scene.title} storyboard shot`}
                loading="lazy"
                title="Click to enlarge"
                onClick={handleThumbClick}
              />
            ) : (
              <button
                type="button"
                className="sb-generate-image-btn sb-generate-image-btn-compact"
                title="Generate image for this shot"
                onClick={(event) => {
                  event.stopPropagation();
                  onGenerateImage?.(scene.id);
                }}
              >
                <span className="sb-generate-image-icon">+</span>
                <small>Generate image</small>
              </button>
            )}
          </div>

          <div className="sb-scene-compact-title">
            <strong>{scene.title}</strong>
          </div>
        </div>
      ) : (
        <>
          <header className="sb-scene-top">
            <div className="sb-scene-number" style={{ color: actColor }}>
              Shot
            </div>
            <button
              type="button"
              className="sb-scene-delete"
              title="Delete shot"
              onClick={() => onDelete?.(scene.id)}
            >
              ×
            </button>
          </header>

          <div
            className="sb-scene-main"
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(scene.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect?.(scene.id);
              }
            }}
          >
            <div className="sb-scene-layout">
              <div className="sb-scene-copy">
                {/* Numeric SQ/SC/SH label removed — visual hierarchy + scene title provide context */}
                {toneLabel ? <span className="sb-scene-state">{toneLabel}</span> : null}
                <strong>{scene.title}</strong>
                <p>{scene.storyFunction || scene.location || scene.mood || 'No shot context yet'}</p>

                <div className="sb-scene-characters">
                  {firstCharacters.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className="sb-scene-character-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCharacterClick?.(character.id);
                      }}
                    >
                      {character.name}
                    </button>
                  ))}
                  {remaining > 0 ? <span>+{remaining}</span> : null}
                  {characters.length === 0 ? <span>No cast</span> : null}
                </div>
              </div>

              <div
                className={`sb-scene-thumb ${scene.imageStatus === 'generating' ? 'is-generating' : ''} ${
                  scene.imageUrl ? 'has-image' : ''
                }`}
                style={{ borderColor: `${actColor}55` }}
              >
                {scene.imageStatus === 'generating' ? (
                  <div className="sb-scene-spinner">
                    <div className="sb-spinner" />
                    <small>Generating...</small>
                  </div>
                ) : scene.imageUrl ? (
                  <img
                    className="sb-scene-thumb-media sb-scene-thumb-clickable"
                    src={resolveLocalImage(scene.imageUrl)}
                    alt={`${scene.title} storyboard shot`}
                    loading="lazy"
                    title="Click to enlarge"
                    onClick={handleThumbClick}
                  />
                ) : (
                  <button
                    type="button"
                    className="sb-generate-image-btn"
                    title="Generate image for this shot"
                    onClick={(event) => {
                      event.stopPropagation();
                      onGenerateImage?.(scene.id);
                    }}
                  >
                    <span className="sb-generate-image-icon">+</span>
                    <small>Generate Image</small>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </article>
  );
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
