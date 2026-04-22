import { useState } from 'react';

import SceneCard from './SceneCard.jsx';

const ACT_COLORS = ['#10a37f', '#5b6cff', '#e96f4a'];

export default function ActRow({
  act,
  entities,
  selectedSceneId,
  onSelectScene,
  onDeleteScene,
  onCreateSceneManual,
  onGenerateSection,
  onGenerateImage,
  onMoveScene,
  onDeleteAct,
  onDeleteSequence,
  onRenameAct,
  onRenameSequence,
  sceneDiffById,
  selectedAct,
  isDraggingAct,
  onActDragStart,
  onActDragEnd,
  onSelectAct,
  selectedSequence,
  onSelectSequence,
  viewMode,
  collapsed,
  onToggleCollapsed,
  onOpenCharacter,
}) {
  const color = ACT_COLORS[(Number(act?.number || 1) - 1) % ACT_COLORS.length];
  const characters = Array.isArray(entities?.characters) ? entities.characters : [];
  const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
  const flatScenes = sequences.flatMap((sequence) =>
    (Array.isArray(sequence?.scenes) ? sequence.scenes : []).map((scene, index) => ({
      scene,
      sequence,
      index,
    }))
  );

  const [composer, setComposer] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [collapsedBySequence, setCollapsedBySequence] = useState({});
  const isSelectedAct = Number(selectedAct?.actNumber) === Number(act?.number);

  function moveSceneFromEvent(event, targetActNumber, targetSequenceNumber, targetIndex) {
    const payload = readSceneDragPayload(event);
    if (!payload) {
      return;
    }

    onMoveScene?.({
      sceneId: payload.sceneId,
      targetActNumber,
      targetSequenceNumber,
      targetIndex,
    });
  }

  function toggleSequenceCollapsed(sequenceNumber) {
    const key = getSequenceKey(act.number, sequenceNumber);
    setCollapsedBySequence((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function commitActTitle(nextValue) {
    const nextTitle = String(nextValue || '').trim();
    if (!nextTitle || nextTitle === String(act?.title || '').trim()) {
      return;
    }
    onRenameAct?.(act?.number, nextTitle);
  }

  function commitSequenceTitle(sequence, nextValue) {
    const nextTitle = String(nextValue || '').trim();
    const currentTitle = String(sequence?.title || '').trim();

    if (!nextTitle || nextTitle === currentTitle) {
      return;
    }

    onRenameSequence?.({
      actNumber: act?.number,
      sequenceNumber: sequence?.number,
      title: nextTitle,
    });
  }

  return (
    <section
      className={`sb-act-row ${collapsed ? 'is-collapsed' : ''} ${
        isDraggingAct ? 'is-dragging' : ''
      }`}
      draggable
      onDragStart={(event) => {
        const target = event.target;
        if (target instanceof Element && shouldSkipActDrag(target)) {
          event.preventDefault();
          return;
        }

        const actPayload = { type: 'act', actNumber: act.number };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-storyboard-act', JSON.stringify(actPayload));
        event.dataTransfer.setData('text/plain', JSON.stringify(actPayload));
        onActDragStart?.({ actNumber: act.number });
      }}
      onDragEnd={() => onActDragEnd?.()}
    >
      <header className="sb-act-head">
        <div
          className={`sb-act-title-wrap ${isSelectedAct ? 'is-selected' : ''}`}
          role="button"
          tabIndex={0}
          title={isSelectedAct ? 'Focused sequence block' : 'Click to focus this sequence block'}
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('.sb-act-title-input')) {
              return;
            }
            onSelectAct?.({ actNumber: act.number });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelectAct?.({ actNumber: act.number });
            }
          }}
        >
          <div className="sb-act-color" style={{ background: color }} />
          <h4>{`Act ${act.number}:`}</h4>
          <input
            key={`act-title-${act.number}-${act.title}`}
            className="sb-act-title-input"
            defaultValue={String(act?.title || '')}
            onBlur={(event) => commitActTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                event.currentTarget.value = String(act?.title || '');
                event.currentTarget.blur();
              }
            }}
            aria-label={`Act ${act.number} title`}
          />
          <small>{countActScenes(sequences)} shots</small>
        </div>

        <div className="sb-act-actions">
          <IconButton
            title={collapsed ? 'Expand act' : 'Minimize act'}
            onClick={() => onToggleCollapsed?.()}
          >
            <ExpandCollapseIcon collapsed={collapsed} />
          </IconButton>
          <IconButton danger title="Delete act" onClick={() => onDeleteAct?.()}>
            <TrashIcon />
          </IconButton>
        </div>
      </header>

      {collapsed ? null : viewMode === 'grid' ? (
        <div className="sb-act-thumb-grid">
          {flatScenes.map(({ scene, sequence, index }) => (
            <SceneCard
              key={scene.id || `scene_${sequence.number}_${index}`}
              scene={scene}
              actColor={color}
              isSelected={selectedSceneId === scene.id}
              onSelect={onSelectScene}
              onDelete={onDeleteScene}
              onGenerateImage={onGenerateImage}
              diffType={sceneDiffById?.[scene.id] || ''}
              characterNames={resolveCharacterNames(scene.characterIds, characters)}
              onCharacterClick={onOpenCharacter}
              sequenceLabel={`SQ${act.number} / SC${sequence.number} / SH${index + 1}`}
              dragPayload={{
                type: 'scene',
                sceneId: scene.id,
                sourceActNumber: act.number,
                sourceSequenceNumber: sequence.number,
              }}
              compact
            />
          ))}
          {/* Always-present add-shot tile: works whether the sequence has 0 or N shots */}
          <button
            type="button"
            className="sb-grid-add-tile"
            title="Add a shot to the next empty scene"
            onClick={() => {
              // Find the first scene slot with no shots; fall back to the first scene.
              const firstEmpty = sequences.find((s) => !Array.isArray(s?.scenes) || s.scenes.length === 0);
              const target = firstEmpty || sequences[0];
              if (!target) return;
              onCreateSceneManual?.({
                actNumber: act.number,
                sequenceNumber: target.number,
                manual: { title: '' },
              });
            }}
          >
            <span className="sb-grid-add-plus">+</span>
            <span>Add shot</span>
          </button>
        </div>
      ) : (
        <div className="sb-sequence-grid">
          {sequences.map((sequence) => {
            const scenes = Array.isArray(sequence?.scenes) ? sequence.scenes : [];
            const sequenceKey = getSequenceKey(act.number, sequence.number);
            const isCollapsed = Boolean(collapsedBySequence[sequenceKey]);
            const isSelectedSequence =
              Number(selectedSequence?.actNumber) === Number(act.number) &&
              Number(selectedSequence?.sequenceNumber) === Number(sequence.number);

            return (
              <section
                key={sequence.number}
                className={`sb-sequence-column ${isSelectedSequence ? 'is-selected' : ''} ${
                  isCollapsed ? 'is-collapsed' : ''
                  } ${dropTarget?.sequenceNumber === sequence.number && dropTarget?.index === scenes.length
                    ? 'is-drop-target'
                    : ''
                  }`}
                onDragOver={(event) => {
                  if (!hasSceneDragPayload(event)) {
                    return;
                  }
                  event.preventDefault();
                  setDropTarget({ sequenceNumber: sequence.number, index: scenes.length });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  moveSceneFromEvent(event, act.number, sequence.number, scenes.length);
                  setDropTarget(null);
                }}
                onDragLeave={() => {
                  setDropTarget((current) =>
                    current?.sequenceNumber === sequence.number && current?.index === scenes.length
                      ? null
                      : current
                  );
                }}
              >
                <header className="sb-sequence-head">
                  <div
                    className={`sb-sequence-title ${isSelectedSequence ? 'is-selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    title={
                      isSelectedSequence
                        ? 'Focused scene column'
                        : 'Click to focus this scene column'
                    }
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('.sb-sequence-title-input')) {
                        return;
                      }
                      onSelectSequence?.({ actNumber: act.number, sequenceNumber: sequence.number });
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectSequence?.({ actNumber: act.number, sequenceNumber: sequence.number });
                      }
                    }}
                  >
                    <div className="sb-sequence-title-row">
                      <input
                        key={`seq-title-${act.number}-${sequence.number}-${sequence.title}`}
                        className="sb-sequence-title-input"
                        defaultValue={String(sequence?.title || '')}
                        onBlur={(event) => commitSequenceTitle(sequence, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                          if (event.key === 'Escape') {
                            event.currentTarget.value = String(sequence?.title || '');
                            event.currentTarget.blur();
                          }
                        }}
                        aria-label={`Sequence ${sequence.number} title`}
                      />
                    </div>
                  </div>

                  <div className="sb-sequence-actions">
                    <IconButton
                      title={isCollapsed ? 'Expand sequence' : 'Minimize sequence'}
                      onClick={() => toggleSequenceCollapsed(sequence.number)}
                    >
                      <ExpandCollapseIcon collapsed={isCollapsed} />
                    </IconButton>
                    <IconButton
                      danger
                      title="Delete scene"
                      onClick={() => onDeleteSequence?.(sequence.number)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </header>

                {isCollapsed ? null : composer?.sequenceNumber === sequence.number ? (
                  <SectionComposer
                    sequence={sequence}
                    actNumber={act.number}
                    characters={characters}
                    initialMode={composer.mode}
                    onClose={() => setComposer(null)}
                    onCreateManual={(payload) => {
                      onCreateSceneManual?.({
                        actNumber: act.number,
                        sequenceNumber: sequence.number,
                        ...payload,
                      });
                      setComposer(null);
                    }}
                    onGenerate={(payload) => {
                      onGenerateSection?.({
                        actNumber: act.number,
                        sequenceNumber: sequence.number,
                        ...payload,
                      });
                    }}
                  />
                ) : null}

                {isCollapsed ? null : <div className="sb-sequence-scenes">
                  {scenes.length === 0 ? (
                    <div className="sb-empty-seq-row">
                      {/* AI rescue button — primary action for the common
                          case where the planner emitted a Sequence without
                          its paired Shot. One click fires a focused request
                          that only adds the missing Shot. */}
                      <button
                        type="button"
                        className="sb-empty-seq sb-empty-seq-btn sb-empty-seq-ai"
                        style={{ borderColor: `${color}88` }}
                        onClick={() => onGenerateSection?.({
                          actNumber: act.number,
                          sequenceNumber: sequence.number,
                          count: 1,
                        })}
                        title="Ask the AI to draft the missing Shot for this Sequence"
                      >
                        <span className="sb-empty-seq-ai-badge" aria-hidden="true">AI</span>
                        <small>Draft Shot with AI</small>
                      </button>
                      {/* Escape hatch — if the user prefers to write it by
                          hand, same manual composer as before. */}
                      <button
                        type="button"
                        className="sb-empty-seq sb-empty-seq-btn sb-empty-seq-manual"
                        style={{ borderColor: `${color}55` }}
                        onClick={() => setComposer({ sequenceNumber: sequence.number, mode: 'manual' })}
                      >
                        <span>+</span>
                        <small>Add manually</small>
                      </button>
                    </div>
                  ) : (
                    scenes.map((scene, index) => (
                      <SceneCard
                        key={scene.id || `scene_${index}`}
                        scene={scene}
                        actColor={color}
                        isSelected={selectedSceneId === scene.id}
                        onSelect={onSelectScene}
                        onDelete={onDeleteScene}
                        onGenerateImage={onGenerateImage}
                        diffType={sceneDiffById?.[scene.id] || ''}
                        characterNames={resolveCharacterNames(scene.characterIds, characters)}
                        onCharacterClick={onOpenCharacter}
                        sequenceLabel={`SQ${act.number} / SC${sequence.number} / SH${index + 1}`}
                        layoutIndex={index}
                        dragPayload={{
                          type: 'scene',
                          sceneId: scene.id,
                          sceneNumber: scene.sceneNumber,
                          sourceActNumber: act.number,
                          sourceSequenceNumber: sequence.number,
                        }}
                        isDropTarget={
                          dropTarget?.sequenceNumber === sequence.number && dropTarget?.index === index
                        }
                        onDropAt={(event, position) => {
                          event.stopPropagation();
                          event.preventDefault();
                          const targetIndex = position === 'after' ? index + 1 : index;
                          moveSceneFromEvent(event, act.number, sequence.number, targetIndex);
                          setDropTarget(null);
                        }}
                        onDragOverAt={(event, position) => {
                          event.stopPropagation();
                          if (!hasSceneDragPayload(event)) {
                            return;
                          }
                          event.preventDefault();
                          const targetIndex = position === 'after' ? index + 1 : index;
                          setDropTarget({ sequenceNumber: sequence.number, index: targetIndex });
                        }}
                      />
                    ))
                  )}
                </div>}

                {isCollapsed ? null : (
                  <div
                    className={`sb-scene-drop-slot ${dropTarget?.sequenceNumber === sequence.number && dropTarget?.index === scenes.length
                        ? 'is-active'
                        : ''
                      }`}
                    onClick={() => setComposer({ sequenceNumber: sequence.number, mode: 'manual' })}
                    onDragOver={(event) => {
                      event.stopPropagation();
                      if (!hasSceneDragPayload(event)) {
                        return;
                      }
                      event.preventDefault();
                      setDropTarget({ sequenceNumber: sequence.number, index: scenes.length });
                    }}
                    onDrop={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      moveSceneFromEvent(event, act.number, sequence.number, scenes.length);
                      setDropTarget(null);
                    }}
                  >
                    Click to add shot or drop to append
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SectionComposer({
  sequence,
  actNumber,
  characters,
  initialMode,
  onClose,
  onCreateManual,
  onGenerate,
}) {
  const [mode, setMode] = useState(initialMode || 'manual');

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [storyFunction, setStoryFunction] = useState('');
  const [mood, setMood] = useState('');
  const [visualDescription, setVisualDescription] = useState('');
  const [action, setAction] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [newCharacterName, setNewCharacterName] = useState('');
  const [newCharacterDescription, setNewCharacterDescription] = useState('');

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiCount, setAiCount] = useState(1);

  return (
    <section className="sb-composer">
      <header className="sb-composer-head">
        <strong>
          Act {actNumber}, Sequence {sequence.number}
        </strong>
        <button type="button" className="sb-btn sb-btn-xs" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="sb-mode-toggle">
        <button
          type="button"
          className={mode === 'manual' ? 'active' : ''}
          onClick={() => setMode('manual')}
        >
          Write
        </button>
        <button
          type="button"
          className={mode === 'ai' ? 'active' : ''}
          onClick={() => setMode('ai')}
        >
          AI
        </button>
      </div>

      {mode === 'manual' ? (
        <div className="sb-composer-body">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Shot title"
          />
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Location (INT./EXT.)"
          />
          <input
            value={mood}
            onChange={(event) => setMood(event.target.value)}
            placeholder="Mood"
          />
          <textarea
            value={storyFunction}
            onChange={(event) => setStoryFunction(event.target.value)}
            rows={2}
            placeholder="Why this shot exists in the story"
          />
          <textarea
            value={visualDescription}
            onChange={(event) => setVisualDescription(event.target.value)}
            rows={2}
            placeholder="Visual direction"
          />
          <textarea
            value={action}
            onChange={(event) => setAction(event.target.value)}
            rows={2}
            placeholder="Action beats"
          />

          <div className="sb-inline-label">Characters in Shot</div>
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
                        setSelectedCharacterIds((value) => [...value, character.id]);
                        return;
                      }
                      setSelectedCharacterIds((value) => value.filter((id) => id !== character.id));
                    }}
                  />
                  <span>{character.name}</span>
                </label>
              );
            })}
          </div>

          <div className="sb-inline-label">Create New Character (Optional)</div>
          <input
            value={newCharacterName}
            onChange={(event) => setNewCharacterName(event.target.value)}
            placeholder="Character name"
          />
          <textarea
            value={newCharacterDescription}
            onChange={(event) => setNewCharacterDescription(event.target.value)}
            rows={2}
            placeholder="Character description"
          />

          <button
            type="button"
            className="sb-btn sb-btn-primary"
            onClick={() => {
              onCreateManual?.({
                manual: {
                  title,
                  location,
                  mood,
                  storyFunction,
                  visualDescription,
                  action,
                  characterIds: selectedCharacterIds,
                },
                newCharacter: {
                  name: newCharacterName,
                  description: newCharacterDescription,
                  role: 'Supporting',
                },
              });
              setTitle('');
              setLocation('');
              setMood('');
              setStoryFunction('');
              setVisualDescription('');
              setAction('');
              setSelectedCharacterIds([]);
              setNewCharacterName('');
              setNewCharacterDescription('');
            }}
          >
            Add Shot
          </button>
        </div>
      ) : (
        <div className="sb-composer-body">
          <textarea
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            rows={4}
            placeholder="Ask AI to generate or improve this scene"
          />
          <div className="sb-row">
            <label className="sb-inline-label" htmlFor={`count_${sequence.number}`}>
              Shot Count
            </label>
            <select
              id={`count_${sequence.number}`}
              value={aiCount}
              onChange={(event) => setAiCount(Number(event.target.value) || 1)}
            >
              <option value={1}>1 shot</option>
              <option value={2}>2 shots</option>
              <option value={3}>3 shots</option>
              <option value={5}>5 shots</option>
            </select>
          </div>
          <button
            type="button"
            className="sb-btn sb-btn-primary"
            onClick={() => onGenerate?.({ prompt: aiPrompt, count: aiCount })}
          >
            Generate With AI
          </button>
        </div>
      )}
    </section>
  );
}

function IconButton({ title, onClick, active = false, danger = false, children }) {
  return (
    <button
      type="button"
      className={`sb-icon-btn ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ExpandCollapseIcon({ collapsed }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 12h10" />
      {collapsed ? <path d="M12 7v10" /> : null}
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M9 6V4h6v2" />
      <path d="M7 6v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </svg>
  );
}

function resolveCharacterNames(characterIds, characters) {
  const ids = Array.isArray(characterIds) ? characterIds : [];
  return ids.map((id) => ({
    id,
    name: characters.find((character) => character.id === id)?.name || id,
  }));
}

function countActScenes(sequences) {
  return (sequences || []).reduce((total, sequence) => {
    return total + (Array.isArray(sequence?.scenes) ? sequence.scenes.length : 0);
  }, 0);
}

function hasSceneDragPayload(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes('application/x-storyboard-scene') || types.includes('text/plain');
}

function readSceneDragPayload(event) {
  const custom = event.dataTransfer.getData('application/x-storyboard-scene');
  const plain = event.dataTransfer.getData('text/plain');
  const raw = custom || plain;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    const sceneId = String(parsed?.sceneId || '').trim();
    if (!sceneId) {
      return null;
    }
    return { sceneId };
  } catch {
    return null;
  }
}

function getSequenceKey(actNumber, sequenceNumber) {
  return `${actNumber}:${sequenceNumber}`;
}

function shouldSkipActDrag(target) {
  return Boolean(
    target.closest(
      'button, input, textarea, select, option, label, a, [contenteditable="true"], .sb-scene-card, .sb-composer'
    )
  );
}
