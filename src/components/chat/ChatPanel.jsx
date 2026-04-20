import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import MessageBubble from './MessageBubble.jsx';
import { confirm as confirmDialog } from '../../store/dialog-store.js';

export default function ChatPanel({
  messages,
  streamingText,
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

  // Phase tag shown inline in the banner
  const phaseLabel =
    processingPhase === 'planning'
      ? 'Planning'
      : processingPhase === 'drafting'
        ? 'Drafting'
        : processingPhase === 'rendering'
          ? 'Rendering'
          : null;

  // Auto-scroll when new messages arrive or banner appears/disappears
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [displayMessages.length, streamingText, isSending]);

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
          <div className="sb-processing-banner" role="status" aria-live="polite">
            <div className="sb-spinner" />
            <div className="sb-processing-copy">
              <strong>
                {processingStatus || 'Working on your storyboard…'}
                {phaseLabel
                  ? <span className="sb-processing-phase-tag">{phaseLabel}</span>
                  : null}
              </strong>
              <small>
                {processingDetail ||
                  (isStreaming ? 'Streaming the AI reply.' : 'Finishing background work.')}
              </small>
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
