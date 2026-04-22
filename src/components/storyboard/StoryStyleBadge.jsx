import { useEffect, useRef, useState } from 'react';

/**
 * Project-level visual style badge — shows the current storyStyle descriptor
 * inline next to the List/Grid toggle. The style is auto-drafted by
 * generateStoryStyle() on the first turn and used by buildSceneImagePrompt to
 * keep every Shot visually consistent.
 *
 * Click the badge → compact inline editor pops down (textarea + Save/Cancel).
 * The editor is anchored below the badge and auto-sizes to the content.
 *
 * UX rationale:
 * - Visible, but unobtrusive. Users who don't care about style edits never
 *   have to click into it; power users can tweak in two clicks.
 * - Empty state shows "Set visual style" so new users know the slot exists
 *   before their first AI turn completes.
 * - Truncates the preview to ~45 chars with an ellipsis; full text on hover.
 */
export default function StoryStyleBadge({ storyStyle, onUpdate }) {
  // `null` while closed; a string while editing. This pattern avoids the
  // "keep state in sync with prop" anti-pattern entirely: the editor
  // always initializes its draft from the current prop when it opens,
  // and once open the user owns the draft until Save or Cancel.
  const [draft, setDraft] = useState(null);
  const textareaRef = useRef(null);
  const wrapperRef = useRef(null);
  const editing = draft !== null;

  const beginEditing = () => setDraft(String(storyStyle || ''));
  const cancelEditing = () => setDraft(null);

  // Close the editor on Escape or an outside click — same affordance as
  // most inline popovers in the app.
  useEffect(() => {
    if (!editing) return undefined;
    function handleKeydown(event) {
      if (event.key === 'Escape') {
        cancelEditing();
      }
    }
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        cancelEditing();
      }
    }
    // Focus the textarea the moment the editor mounts so the user can type
    // immediately without a second click.
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(
      textareaRef.current.value.length,
      textareaRef.current.value.length
    );
    window.addEventListener('keydown', handleKeydown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [editing]);

  const displayStyle = String(storyStyle || '').trim();
  const hasStyle = displayStyle.length > 0;
  const preview = hasStyle
    ? displayStyle.length > 48
      ? `${displayStyle.slice(0, 45)}…`
      : displayStyle
    : 'Set visual style';

  const handleSave = () => {
    const clean = String(draft || '').trim();
    onUpdate?.(clean);
    setDraft(null);
  };

  return (
    <div className="sb-style-badge-wrap" ref={wrapperRef}>
      <button
        type="button"
        className={`sb-style-badge${hasStyle ? ' has-style' : ' empty'}`}
        onClick={() => (editing ? cancelEditing() : beginEditing())}
        title={hasStyle ? displayStyle : 'Click to set a visual style for every Shot'}
        aria-expanded={editing}
      >
        <span className="sb-style-badge-dot" aria-hidden="true" />
        <span className="sb-style-badge-label">Style</span>
        <span className="sb-style-badge-preview">{preview}</span>
      </button>

      {editing ? (
        <div className="sb-style-editor" role="dialog" aria-label="Edit visual style">
          <label htmlFor="sb-style-editor-textarea">
            Visual style applied to every Shot
          </label>
          <textarea
            id="sb-style-editor-textarea"
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Cmd/Ctrl + Enter saves; plain Enter adds a newline like any
              // real multiline textarea.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                handleSave();
              }
            }}
            rows={3}
            placeholder="e.g. Monochrome pencil storyboard, rough crosshatching, gritty noir mood, 16:9 letterbox, no text overlays."
          />
          <small className="sb-style-editor-hint">
            One sentence is ideal. Describe the medium, palette, line quality, and mood. End with <code>, no text overlays.</code> so image models don&apos;t render frame numbers or captions.
          </small>
          <div className="sb-style-editor-actions">
            <button type="button" className="sb-btn sb-btn-xs" onClick={cancelEditing}>
              Cancel
            </button>
            <button
              type="button"
              className="sb-btn sb-btn-xs sb-btn-primary"
              onClick={handleSave}
            >
              Save style
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
