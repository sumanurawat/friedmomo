import { useState } from 'react';

import ActRow from './ActRow.jsx';

export default function StoryboardGrid({
  storyboard,
  entities,
  selectedSceneId,
  onSelectScene,
  onDeleteScene,
  onCreateSceneManual,
  onGenerateSection,
  onGenerateImage,
  onMoveScene,
  onMoveAct,
  onAddAct,
  onDeleteAct,
  onDeleteSequence,
  onExportPdf,
  selectedAct,
  onSelectAct,
  selectedSequence,
  onSelectSequence,
  sceneDiffById,
  onRenameAct,
  onRenameSequence,
  onOpenCharacter,
}) {
  const [collapsedByAct, setCollapsedByAct] = useState({});
  const [viewMode, setViewMode] = useState('list');
  const [draggingActNumber, setDraggingActNumber] = useState(null);
  const [actDropTarget, setActDropTarget] = useState(null);
  const acts = Array.isArray(storyboard?.acts) ? storyboard.acts : [];
  const { totalSequences, filledSequences } = getSequenceCoverage(acts);

  function handleDropOnAct(event, targetActNumber) {
    event.preventDefault();
    const payload = readActDragPayload(event);
    if (!payload) {
      setActDropTarget(null);
      return;
    }

    if (Number(payload.actNumber) === Number(targetActNumber)) {
      setActDropTarget(null);
      setDraggingActNumber(null);
      return;
    }

    const position = getDropPosition(event);
    onMoveAct?.({
      sourceActNumber: payload.actNumber,
      targetActNumber,
      placeAfter: position === 'after',
    });
    setActDropTarget(null);
    setDraggingActNumber(null);
  }

  function handleDropToEnd(event) {
    event.preventDefault();
    const payload = readActDragPayload(event);
    if (!payload) {
      setActDropTarget(null);
      return;
    }

    onMoveAct?.({ sourceActNumber: payload.actNumber, toEnd: true });
    setActDropTarget(null);
    setDraggingActNumber(null);
  }

  return (
    <section className="sb-board-grid">
      <header className="sb-section-head">
        <h2>Storyboard</h2>
        <div className="sb-row">
          <p>
            {filledSequences}/{totalSequences} scenes filled
          </p>
          <div className="sb-view-toggle" role="tablist" aria-label="Storyboard view">
            <button
              type="button"
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              aria-pressed={viewMode === 'list'}
            >
              List
            </button>
            <button
              type="button"
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              aria-pressed={viewMode === 'grid'}
            >
              Grid
            </button>
          </div>
          <button type="button" className="sb-btn sb-btn-xs" onClick={onExportPdf}>
            Export PDF
          </button>
          <button type="button" className="sb-btn sb-btn-xs" title="Add new sequence" onClick={onAddAct}>
            +
          </button>
        </div>
      </header>

      <div className="sb-board-acts">
        {acts.map((act) => {
          const isDragTarget = Number(actDropTarget?.actNumber) === Number(act.number);
          const isDragging = Number(draggingActNumber) === Number(act.number);

          return (
            <div
              key={act.number}
              className={`sb-act-slot ${isDragTarget ? 'is-drop-target' : ''}`}
              onDragOver={(event) => {
                if (!hasActDragPayload(event)) {
                  return;
                }
                event.preventDefault();
                setActDropTarget({
                  actNumber: act.number,
                  position: getDropPosition(event),
                });
              }}
              onDrop={(event) => handleDropOnAct(event, act.number)}
            >
              <ActRow
                act={act}
                entities={entities}
                selectedSceneId={selectedSceneId}
                onSelectScene={onSelectScene}
                onDeleteScene={onDeleteScene}
                onCreateSceneManual={onCreateSceneManual}
                onGenerateSection={onGenerateSection}
                onGenerateImage={onGenerateImage}
                onMoveScene={onMoveScene}
                onDeleteAct={() => onDeleteAct?.(act.number)}
                onDeleteSequence={(sequenceNumber) =>
                  onDeleteSequence?.({ actNumber: act.number, sequenceNumber })
                }
                onRenameAct={onRenameAct}
                onRenameSequence={onRenameSequence}
                sceneDiffById={sceneDiffById}
                selectedAct={selectedAct}
                onSelectAct={onSelectAct}
                selectedSequence={selectedSequence}
                onSelectSequence={onSelectSequence}
                viewMode={viewMode}
                collapsed={Boolean(collapsedByAct[act.number])}
                onToggleCollapsed={() => {
                  setCollapsedByAct((value) => ({
                    ...value,
                    [act.number]: !value[act.number],
                  }));
                }}
                isDraggingAct={isDragging}
                onActDragStart={(payload) => {
                  setDraggingActNumber(payload.actNumber);
                }}
                onActDragEnd={() => {
                  setDraggingActNumber(null);
                  setActDropTarget(null);
                }}
                onOpenCharacter={onOpenCharacter}
              />
            </div>
          );
        })}

        <div
          className={`sb-act-end-drop ${actDropTarget === '__end__' ? 'is-active' : ''}`}
          onDragOver={(event) => {
            if (!hasActDragPayload(event)) {
              return;
            }
            event.preventDefault();
            setActDropTarget('__end__');
          }}
          onDrop={handleDropToEnd}
        >
          Drop here to move sequence block to end
        </div>
      </div>
    </section>
  );
}

function getSequenceCoverage(acts) {
  let totalSequences = 0;
  let filledSequences = 0;

  for (const act of acts) {
    const sequences = Array.isArray(act?.sequences) ? act.sequences : [];
    totalSequences += sequences.length;
    for (const sequence of sequences) {
      if (Array.isArray(sequence?.scenes) && sequence.scenes.length > 0) {
        filledSequences += 1;
      }
    }
  }

  return { totalSequences, filledSequences };
}

function hasActDragPayload(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes('application/x-storyboard-act');
}

function readActDragPayload(event) {
  const custom = event.dataTransfer.getData('application/x-storyboard-act');
  const raw = custom;
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (String(parsed?.type || '').trim() !== 'act') {
      return null;
    }
    const actNumber = Number(parsed?.actNumber);
    if (!actNumber) {
      return null;
    }
    return { actNumber };
  } catch {
    return null;
  }
}

function getDropPosition(event) {
  const target = event.currentTarget;
  if (!(target instanceof Element)) {
    return 'before';
  }
  const rect = target.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  return event.clientY >= midpoint ? 'after' : 'before';
}
