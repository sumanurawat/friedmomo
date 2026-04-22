import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import MessageBubble from './MessageBubble.jsx';
import { confirm as confirmDialog } from '../../store/dialog-store.js';

// Map the granular phase identifiers that the project store emits (via
// derivePhaseFromStream) to short, user-facing pill labels. Shown inline in
// the processing banner so even during the silent structured-JSON phase the
// user can see which section the planner is writing.
const PHASE_PILL_LABEL = {
  planning: 'Planning',
  drafting: 'Drafting',
  outline: 'Outline',
  // "scenes_add" is the phase emitted when the planner is writing JSON
  // `sequences_add` (layer 2) — that's Sequences in user vocabulary.
  scenes_add: 'Sequences',
  characters_add: 'Cast',
  characters_update: 'Cast',
  locations_add: 'World',
  locations_update: 'World',
  // "panels_add" is the phase emitted when the planner is writing JSON
  // `scenes_add` (layer 3) — that's Shots in user vocabulary.
  panels_add: 'Shots',
  panels_update: 'Shots',
  rendering: 'Rendering',
};

// Format a raw character count into something the user can glance at:
// under 1 KB  → "412 chars"
// over 1 KB   → "4.2 KB"
// Used only to signal that the stream is alive — exact precision doesn't
// matter, motion does.
function formatStreamSize(chars) {
  const n = Number(chars) || 0;
  if (n <= 0) return '';
  if (n < 1024) return `${n} chars`;
  const kb = n / 1024;
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

// Wall-clock elapsed since the stream started. Ticks every 500ms while the
// banner is visible so heavy-model users (Opus, GPT-5.4 Pro) can see real
// progress during multi-minute runs instead of wondering if it's hung.
function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

export default function ChatPanel({
  messages,
  streamingText,
  streamedChars = 0,
  streamingActivity = [],
  streamingStartedAt = 0,
  isStreaming,
  isSending,
  processingStatus,
  processingPhase,
  processingDetail,
  selectedFocusLabel,
  onClearFocus,
  onClearChat,
  onSend,
  onPreviewClick,
  chatMode,
  chatModeOptions,
  onChatModeChange,
}) {
  const [input, setInput] = useState('');
  const [tooltip, setTooltip] = useState(null);
  const [tooltipStyle, setTooltipStyle] = useState(null);
  const [tooltipPlacement, setTooltipPlacement] = useState('top');
  const [elapsedMs, setElapsedMs] = useState(0);
  const listRef = useRef(null);
  const tooltipRef = useRef(null);
  const tooltipTimerRef = useRef(null);
  const tooltipAnchorRef = useRef(null);

  const displayMessages = useMemo(() => {
    const safe = (Array.isArray(messages) ? messages : []).filter(
      (message) => !message?.hidden
    );
    if (isStreaming) {
      return [
        ...safe,
        {
          role: 'assistant',
          content: streamingText || 'Thinking...',
          timestamp: new Date().toISOString(),
          _streaming: true,
        },
      ];
    }
    return safe;
  }, [messages, isStreaming, streamingText]);

  // Phase tag shown inline in the banner. Covers every phase the planner
  // stream can surface (see derivePhaseFromStream in project-store.js) so
  // the user always has a short label matching the current section.
  const phaseLabel = PHASE_PILL_LABEL[processingPhase] || null;

  // Live byte counter — empty string during non-streaming phases so the
  // banner stays clean once the response has landed and image rendering
  // takes over.
  const streamSizeLabel = isStreaming ? formatStreamSize(streamedChars) : '';

  // Live wall-clock elapsed. Kept in local state so the banner re-renders
  // every 500ms without forcing the whole store to tick. The effect only
  // runs while streaming; when it stops we just hide the pill via the
  // gating expression below rather than touching state inside the effect.
  useEffect(() => {
    if (!isSending || !streamingStartedAt) return undefined;
    const tick = () => setElapsedMs(Date.now() - streamingStartedAt);
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [isSending, streamingStartedAt]);
  const elapsedLabel = isSending && streamingStartedAt > 0
    ? formatElapsed(elapsedMs)
    : '';

  // Show the last 4 entity-progress events. Oldest at top so the list reads
  // like a running log; new entries pop in at the bottom.
  const recentActivity = Array.isArray(streamingActivity)
    ? streamingActivity.slice(-4)
    : [];

  // Auto-scroll when new messages arrive or banner appears/disappears
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayMessages.length, streamingText, isSending, recentActivity.length]);

  useEffect(() => () => {
    clearTimeout(tooltipTimerRef.current);
  }, []);

  // Tooltip positioning
  useEffect(() => {
    if (!tooltip || !tooltipRef.current || !tooltipAnchorRef.current) {
      return undefined;
    }

    const updateTooltipPosition = () => {
      const bubble = tooltipRef.current;
      const anchor = tooltipAnchorRef.current;
      if (!bubble || !anchor) return;

      const anchorRect = anchor.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const margin = 12;
      const gap = 10;

      let placement = 'top';
      let top = anchorRect.top - bubbleRect.height - gap;
      if (top < margin) {
        placement = 'bottom';
        top = anchorRect.bottom + gap;
      }
      if (top + bubbleRect.height > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - bubbleRect.height - margin);
      }

      let left = anchorRect.left + anchorRect.width / 2 - bubbleRect.width / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - bubbleRect.width - margin));

      setTooltipPlacement(placement);
      setTooltipStyle({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [tooltip]);

  const hideTooltip = () => {
    clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = null;
    tooltipAnchorRef.current = null;
    setTooltip(null);
    setTooltipStyle(null);
  };

  const scheduleTooltip = (option, element, immediate = false) => {
    clearTimeout(tooltipTimerRef.current);
    tooltipAnchorRef.current = element;
    const show = () => setTooltip({ id: `chat-mode-help-${option.id}`, text: option.description });
    if (immediate) { show(); return; }
    tooltipTimerRef.current = setTimeout(show, 260);
  };

  const submit = () => {
    const text = input.trim();
    if (!text || isSending) return;
    onSend?.(text);
    setInput('');
  };

  return (
    <section className="sb-chat-panel">

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sb-chat-head">
        <div>
          <h2>Chat</h2>
          <p>Direct the story, ask for shot batches, and get inline frame previews as scenes update.</p>
          {selectedFocusLabel ? (
            <div className="sb-chat-focus-row">
              <span>{selectedFocusLabel}</span>
              <button type="button" className="sb-btn sb-btn-xs" onClick={onClearFocus}>
                Clear Focus
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="sb-btn sb-btn-xs"
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Clear chat?',
              message: 'Removes all prompts and assistant replies for this story. Your storyboard data stays untouched.',
              destructive: true,
              confirmLabel: 'Clear chat',
            });
            if (!ok) return;
            onClearChat?.();
          }}
        >
          Clear Chat
        </button>
      </header>

      {/* ── Message list (scrollable) ──────────────────────────── */}
      {/*  The processing banner lives INSIDE this div so it never  */}
      {/*  overlaps the header or compose area.                     */}
      <div className="sb-message-list" ref={listRef}>
        {displayMessages.map((message, index) => (
          <MessageBubble
            key={`${message.timestamp || ''}_${index}`}
            message={message}
            onPreviewClick={onPreviewClick}
          />
        ))}

        {isSending ? (
          <div className="sb-processing-banner is-alive" role="status" aria-live="polite">
            <div className="sb-spinner" />
            <div className="sb-processing-copy">
              <strong>
                {processingStatus || 'Working on your storyboard…'}
                {phaseLabel
                  ? <span className="sb-processing-phase-tag">{phaseLabel}</span>
                  : null}
                {streamSizeLabel
                  ? <span className="sb-processing-bytes" title="Total bytes streamed from the planner so far">{streamSizeLabel}</span>
                  : null}
                {elapsedLabel
                  ? <span className="sb-processing-elapsed" title="Elapsed since the planner started streaming">{elapsedLabel}</span>
                  : null}
              </strong>
              <small>
                {processingDetail ||
                  (isStreaming ? 'Streaming the AI reply.' : 'Finishing background work.')}
              </small>
              {recentActivity.length > 0 ? (
                <ul className="sb-processing-activity" aria-label="Planner progress">
                  {recentActivity.map((entry) => (
                    <li key={entry.id} data-activity-type={entry.type}>
                      <span className="sb-activity-dot" aria-hidden="true" />
                      <span className="sb-activity-label">{entry.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Compose area ──────────────────────────────────────── */}
      <div className="sb-chat-compose">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          rows={3}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder='Try: "Add a midpoint reveal in scene 4 and raise stakes in sequence 2"'
        />
        <div className="sb-chat-compose-footer">
          <div className="sb-chat-mode-toggle">
            {(chatModeOptions || []).map((option) => (
              <span key={option.id} className="sb-tooltip-anchor">
                <button
                  type="button"
                  data-mode={option.id}
                  className={`sb-mode-btn ${chatMode === option.id ? 'is-active' : ''}`}
                  onClick={(event) => {
                    hideTooltip();
                    event.currentTarget.blur();
                    onChatModeChange?.(option.id);
                  }}
                  aria-describedby={`chat-mode-help-${option.id}`}
                  onMouseEnter={(event) => {
                    if (!option.description) return;
                    scheduleTooltip(option, event.currentTarget);
                  }}
                  onMouseLeave={hideTooltip}
                  onFocus={(event) => {
                    if (!option.description) return;
                    scheduleTooltip(option, event.currentTarget, true);
                  }}
                  onBlur={hideTooltip}
                >
                  {option.label}
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="sb-btn sb-btn-primary sb-send-btn"
            onClick={submit}
            disabled={isSending || !input.trim()}
            title={!input.trim() && !isSending ? 'Type a message first' : undefined}
          >
            {isSending ? <span className="sb-btn-spinner" aria-hidden="true" /> : null}
            {isStreaming ? 'Drafting…' : isSending ? 'Rendering…' : 'Send'}
          </button>
        </div>
      </div>

      {/* Tooltip portal — rendered at document.body to avoid clipping */}
      {tooltip && typeof document !== 'undefined'
        ? createPortal(
          <span
            ref={tooltipRef}
            className={`sb-tooltip-bubble is-visible ${tooltipPlacement === 'bottom' ? 'is-bottom' : 'is-top'}`}
            role="tooltip"
            id={tooltip.id}
            style={tooltipStyle || undefined}
          >
            {tooltip.text}
          </span>,
          document.body
        )
        : null}
    </section>
  );
}
