import { useState, useEffect, useRef } from 'react';

/**
 * First-run onboarding wizard.
 *
 * Shown in place of the main app when the user has no OpenRouter API key
 * configured. Walks them through three steps:
 *   1. Welcome      — what Storyboarder does, what they'll need
 *   2. API key      — link to openrouter.ai, paste field, Test button
 *   3. Pick model   — defaults to cheap Gemini Flash, can upgrade later
 *
 * On completion: persists the key + model via the settings store and
 * triggers the normal app boot path.
 *
 * Props:
 *   suggestedModels  — array of { id, label, tier } from providers.js
 *   defaultModel     — preselected model id (should be cheap/fast)
 *   onValidate(key)  — async (key) => ({ valid: boolean, error?: string })
 *   onComplete({ apiKey, model })
 */
export default function OnboardingWizard({
  suggestedModels = [],
  defaultModel = '',
  onValidate,
  onComplete,
}) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [keyValid, setKeyValid] = useState(null); // null | true | false
  const [errorMsg, setErrorMsg] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [submitting, setSubmitting] = useState(false);
  const keyInputRef = useRef(null);

  useEffect(() => {
    // Auto-focus key input when step 1 is shown.
    if (step === 1 && keyInputRef.current) keyInputRef.current.focus();
  }, [step]);

  async function handleTest() {
    const clean = apiKey.trim();
    if (!clean) return;
    setTesting(true);
    setErrorMsg('');
    setKeyValid(null);
    try {
      const result = await onValidate?.(clean);
      if (result?.valid) {
        setKeyValid(true);
      } else {
        setKeyValid(false);
        setErrorMsg(result?.error || 'Key rejected by OpenRouter.');
      }
    } catch (err) {
      setKeyValid(false);
      setErrorMsg(err?.message || 'Could not reach OpenRouter. Check your network.');
    } finally {
      setTesting(false);
    }
  }

  async function handleFinish() {
    setSubmitting(true);
    try {
      await onComplete?.({ apiKey: apiKey.trim(), model });
    } finally {
      setSubmitting(false);
    }
  }

  const fastModels = suggestedModels.filter((m) => m.tier === 'Fast');
  const strongModels = suggestedModels.filter((m) => m.tier === 'Strong' || m.tier === 'Flagship');

  return (
    <div className="sb-onboard">
      <div className="sb-onboard-card">
        <div className="sb-onboard-steps" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`sb-onboard-dot ${i === step ? 'is-active' : i < step ? 'is-done' : ''}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="sb-onboard-step">
            <h1 className="sb-onboard-title">Welcome to Storyboarder</h1>
            <p className="sb-onboard-lede">
              Turn one sentence into a complete 3-act storyboard — characters, locations, eight
              shootable panels — in about 90 seconds.
            </p>

            <div className="sb-onboard-what-youll-need">
              <h3>Before you start</h3>
              <p>
                Storyboarder uses AI models through <strong>OpenRouter</strong>, a single account
                that gives you access to Claude, Gemini, GPT, and more. You pay OpenRouter directly
                for usage — usually a few cents per story.
              </p>
              <p className="sb-onboard-reassure">
                Everything runs on your laptop. Your stories never leave your machine. The only
                network traffic is from you to OpenRouter, using your own key.
              </p>
            </div>

            <div className="sb-onboard-actions">
              <span />
              <button type="button" className="sb-onboard-primary" onClick={() => setStep(1)}>
                Get started →
              </button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="sb-onboard-step">
            <h1 className="sb-onboard-title">Connect your OpenRouter key</h1>
            <p className="sb-onboard-lede">
              If you don't have one yet, OpenRouter accounts are free and take about a minute to
              create. You'll add a small amount of credit ($5 goes a long way) and copy the API key
              back here.
            </p>

            <ol className="sb-onboard-steps-list">
              <li>
                <button
                  type="button"
                  className="sb-onboard-link"
                  onClick={() => {
                    try {
                      window.open('https://openrouter.ai/keys', '_blank', 'noopener,noreferrer');
                    } catch { /* noop */ }
                  }}
                >
                  Open openrouter.ai/keys ↗
                </button>
              </li>
              <li>Sign in (Google or email), create an API key.</li>
              <li>Paste it below and click Test.</li>
            </ol>

            <label className="sb-onboard-label">
              OpenRouter API key
              <input
                ref={keyInputRef}
                type="password"
                className="sb-onboard-input"
                placeholder="sk-or-v1-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyValid(null);
                  setErrorMsg('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && apiKey.trim()) handleTest();
                }}
                spellCheck={false}
                autoComplete="off"
              />
            </label>

            <div className="sb-onboard-test-row">
              <button
                type="button"
                className="sb-onboard-secondary"
                onClick={handleTest}
                disabled={!apiKey.trim() || testing}
              >
                {testing ? 'Testing…' : keyValid === true ? 'Re-test' : 'Test key'}
              </button>
              {keyValid === true && (
                <span className="sb-onboard-ok">✓ Key works. OpenRouter accepted it.</span>
              )}
              {keyValid === false && (
                <span className="sb-onboard-bad">✗ {errorMsg}</span>
              )}
            </div>

            <div className="sb-onboard-actions">
              <button
                type="button"
                className="sb-onboard-ghost"
                onClick={() => setStep(0)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="sb-onboard-primary"
                onClick={() => setStep(2)}
                disabled={keyValid !== true}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="sb-onboard-step">
            <h1 className="sb-onboard-title">Pick a planning model</h1>
            <p className="sb-onboard-lede">
              This is the model that reads your prompts and writes your storyboard. You can change
              this any time from <strong>Settings → Models</strong>.
            </p>

            <div className="sb-onboard-model-group">
              <h3>Fast + cheap — recommended to start</h3>
              <p className="sb-onboard-group-detail">
                Usually a few cents per turn. Great for brainstorming and first drafts.
              </p>
              <div className="sb-onboard-models">
                {fastModels.map((m) => (
                  <label
                    key={m.id}
                    className={`sb-onboard-model ${model === m.id ? 'is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.id}
                      checked={model === m.id}
                      onChange={() => setModel(m.id)}
                    />
                    <span className="sb-onboard-model-label">{m.label}</span>
                    <span className="sb-onboard-model-id">{m.id}</span>
                  </label>
                ))}
              </div>
            </div>

            {strongModels.length > 0 && (
              <details className="sb-onboard-more-models">
                <summary>Use a bigger model (Claude Opus, Gemini Pro, GPT-4) — higher quality, higher cost</summary>
                <div className="sb-onboard-models">
                  {strongModels.map((m) => (
                    <label
                      key={m.id}
                      className={`sb-onboard-model ${model === m.id ? 'is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="model"
                        value={m.id}
                        checked={model === m.id}
                        onChange={() => setModel(m.id)}
                      />
                      <span className="sb-onboard-model-label">{m.label}</span>
                      <span className="sb-onboard-model-id">{m.id}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}

            <div className="sb-onboard-actions">
              <button
                type="button"
                className="sb-onboard-ghost"
                onClick={() => setStep(1)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="sb-onboard-primary"
                onClick={handleFinish}
                disabled={!model || submitting}
              >
                {submitting ? 'Saving…' : 'Start storyboarding'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
