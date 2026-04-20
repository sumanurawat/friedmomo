import { useEffect, useRef, useState } from 'react';

const STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Storyboarder',
    body: "Your AI-powered filmmaking companion. Let's take a quick tour so you can hit the ground running.",
    hint: null,
    target: null,
    cardPos: 'center',
    actionLabel: "Let's go →",
  },
  {
    id: 'chat',
    title: 'Your AI Story Assistant',
    body: 'Start here. Describe your story — a premise, genre, characters, or just a title. The AI will plan your sequences and shots automatically.',
    hint: 'Try typing a quick story premise and pressing Enter!',
    target: 'sb-chat-column',
    cardPos: 'chat',
    actionLabel: 'Next →',
  },
  {
    id: 'chat-mode',
    title: 'Auto-Generate vs. I Know What I\'m Doing',
    body: 'These two buttons at the bottom of the chat control how the AI responds. Auto-Generate extrapolates freely — great when you have a rough idea and want the AI to fill in the story. "I know what I\'m doing" keeps updates tight and deliberate — best when you have a clear script and want precise edits.',
    hint: 'You can switch modes at any time. Your choice is saved between sessions.',
    target: 'sb-chat-mode-toggle',
    cardPos: 'chat',
    actionLabel: 'Next →',
  },
  {
    id: 'board',
    title: 'Your Storyboard',
    body: 'As you chat, sequences and shots appear here. You can drag them to reorder, rename them, or generate shots for any scene.',
    hint: 'Click the + button in the board header to add a new sequence.',
    target: 'sb-board-column',
    cardPos: 'board',
    actionLabel: 'Next →',
  },
  {
    id: 'images',
    title: 'Image Generation',
    body: 'The Images ON/OFF toggle controls whether each shot gets an AI-generated thumbnail. When ON, every new shot is rendered with the app’s fixed storyboard image model. Turn it OFF to skip rendering and save API quota while you focus on structure.',
    hint: 'You can also regenerate or upload a custom image per shot in the inspector panel.',
    target: 'sb-topbar-switch',
    cardPos: 'topbar',
    actionLabel: 'Next →',
  },
  {
    id: 'inspector',
    title: 'Shot Inspector',
    body: 'Click any shot card to open this panel. Edit shot details, link characters, upload or generate AI images — all here.',
    hint: 'Click a shot card in the storyboard to see this in action.',
    target: 'sb-inspector-column',
    cardPos: 'inspector',
    actionLabel: 'Next →',
  },
  {
    id: 'workspace',
    title: 'Workspace Controls',
    body: 'Tap this button to open your workspace hub — projects, characters, locations, and settings all live here.',
    hint: null,
    target: 'sb-account-btn',
    cardPos: 'workspace',
    actionLabel: 'Next →',
  },
  {
    id: 'stories',
    title: 'Your Projects',
    body: 'The Stories tab lists all your storyboard projects. Switch between them, create new ones, rename, or delete. Each project keeps its own chat history, sequences, and character roster.',
    hint: null,
    target: 'sb-hub-panel',
    cardPos: 'center',
    hubTab: 'stories',
    actionLabel: 'Next →',
  },
  {
    id: 'entities',
    title: 'Characters & Locations',
    body: 'The Entities tab is your cast list. Add recurring characters with descriptions so the AI keeps them consistent across every scene. Locations work the same way.',
    hint: 'Link characters to individual shots in the inspector panel.',
    target: 'sb-hub-panel',
    cardPos: 'center',
    hubTab: 'entities',
    actionLabel: 'Next →',
  },
  {
    id: 'settings',
    title: 'AI Settings & API Key',
    body: 'Add your OpenRouter API key here if you want to use your own quota. Storyboarder uses a fixed planning model for story updates and a fixed image model for storyboard frames so the experience stays consistent across the app.',
    hint: 'Get a key at openrouter.ai/keys. It stays in your browser unless you choose hosted demo mode.',
    target: 'sb-hub-panel',
    cardPos: 'center',
    hubTab: 'settings',
    actionLabel: 'Next →',
  },
  {
    id: 'done',
    title: "You're ready to create!",
    body: 'Start by typing your story premise in the chat panel. The AI will build out your full storyboard structure. You can refine it as you go.',
    hint: null,
    target: null,
    cardPos: 'center',
    actionLabel: "Let's create!",
  },
];

export default function TutorialOverlay({ onDone, onOpenHub }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [spotlightRadius, setSpotlightRadius] = useState('20px');
  const cardRef = useRef(null);

  const current = STEPS[step];
  const currentId = current.id;
  const currentTarget = current.target;
  const currentHubTab = current.hubTab;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (currentHubTab && onOpenHub) {
      onOpenHub(currentHubTab);
    }
  }, [currentHubTab, onOpenHub]);

  useEffect(() => {
    if (!currentTarget) {
      const frame = window.requestAnimationFrame(() => {
        setTargetRect(null);
        setSpotlightRadius('20px');
      });
      return () => window.cancelAnimationFrame(frame);
    }

    function measure() {
      const el = document.querySelector(`.${currentTarget}`);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        setSpotlightRadius(window.getComputedStyle(el).borderRadius || '20px');
      } else {
        setTargetRect(null);
        setSpotlightRadius('20px');
      }
    }

    // Measure immediately for elements already in the DOM, then retry after a
    // short delay to catch elements that need a React render cycle to appear
    // (e.g. the hub panel rendered after setHubOpen(true) flushes).
    measure();
    const timer = setTimeout(measure, 80);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [currentId, currentTarget]);

  function handleNext() {
    if (isLast) {
      onDone();
    } else {
      setStep((s) => s + 1);
    }
  }

  function getCardStyle() {
    const pos = current.cardPos;
    // Use absolute positioning (parent is position:fixed inset:0, so absolute == fixed coords)
    if (pos === 'center') {
      return {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    if (!targetRect) {
      return {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const margin = 16;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isLower = targetRect.top > vh / 2;

    if (pos === 'chat') {
      if (isLower) {
        return {
          position: 'absolute',
          bottom: Math.max(margin, vh - targetRect.top + margin),
          left: Math.max(margin, targetRect.right + margin),
        };
      }
      return {
        position: 'absolute',
        top: Math.max(margin, targetRect.top + 16),
        left: Math.max(margin, targetRect.right + margin),
      };
    }

    if (pos === 'board') {
      return {
        position: 'absolute',
        top: targetRect.top + 56,
        left: targetRect.left + margin,
      };
    }

    if (pos === 'inspector') {
      if (isLower) {
        return {
          position: 'absolute',
          bottom: Math.max(margin, vh - targetRect.top + margin),
          right: Math.max(margin, vw - targetRect.left + margin),
        };
      }
      return {
        position: 'absolute',
        top: Math.max(margin, targetRect.top + 16),
        right: Math.max(margin, vw - targetRect.left + margin),
      };
    }

    if (pos === 'topbar') {
      return {
        position: 'absolute',
        top: targetRect.bottom + margin,
        left: Math.max(margin, targetRect.left + targetRect.width / 2 - 160),
      };
    }

    if (pos === 'workspace') {
      return {
        position: 'absolute',
        top: targetRect.bottom + margin,
        right: Math.max(margin, vw - targetRect.right),
      };
    }

    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  }

  const cardStyle = getCardStyle();

  return (
    <div className={`sb-tutorial-backdrop${targetRect ? '' : ' no-spotlight'}`} role="dialog" aria-modal="true" aria-label="App tutorial">
      {targetRect ? (
        <div
          className="sb-tutorial-spotlight"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            borderRadius: spotlightRadius,
          }}
        />
      ) : null}

      <div className={`sb-tutorial-card${current.cardPos === 'center' ? ' sb-tutorial-card--center' : ''}`} style={cardStyle} ref={cardRef}>
        <div className="sb-tutorial-progress">
          {STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`sb-tutorial-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
            />
          ))}
        </div>

        <h3 className="sb-tutorial-title">{current.title}</h3>
        <p className="sb-tutorial-body">{current.body}</p>

        {current.hint ? (
          <div className="sb-tutorial-hint">
            <span className="sb-tutorial-hint-icon">💡</span>
            {current.hint}
          </div>
        ) : null}

        <div className="sb-tutorial-actions">
          <button
            type="button"
            className="sb-btn sb-btn-xs"
            onClick={onDone}
          >
            {isFirst ? 'Skip tour' : 'End tour'}
          </button>

          {!isFirst ? (
            <button
              type="button"
              className="sb-btn sb-btn-xs"
              onClick={() => setStep((s) => s - 1)}
            >
              ← Back
            </button>
          ) : null}

          <button
            type="button"
            className="sb-btn sb-btn-xs sb-btn-primary"
            onClick={handleNext}
          >
            {current.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
