import { useState, useEffect, useRef } from 'react';

/**
 * First-run onboarding wizard.
 *
 * Shown in place of the main app when the user has no OpenRouter API key
 * configured. Walks them through two steps:
 *   0. Welcome — what Storyboarder does, what they'll need
 *   1. API key — link to openrouter.ai, paste field, Test button
 *
 * The planning model is set to the app default (Claude Opus 4.7) — no model
 * picker during onboarding. Users can change it any time in Settings → Models.
 *
 * On completion: persists the key via the settings store and triggers the
 * normal app boot path.
 *
 * Props:
 *   onValidate(key)  — async (key) => ({ valid: boolean, error?: string })
 *   onComplete({ apiKey })
 */
export default function OnboardingWizard({ onValidate, onComplete }) {
  const [step, setStep] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [keyValid, setKeyValid] = useState(null); // null | true | false
  const [errorMsg, setErrorMsg] = useState('');
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
    if (keyValid !== true) return;
    setSubmitting(true);
    try {
      await onComplete?.({ apiKey: apiKey.trim() });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sb-onboard">
      <div className="sb-onboard-card">
        <div className="sb-onboard-steps" aria-hidden="true">
          {[0, 1].map((i) => (
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
                Everything runs on your device. Your stories never leave your browser. The only
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

            <div className="sb-onboard-safety">
              <strong>Where does this key live?</strong>
              <p>
                In your browser on this device — nowhere else. There's no Storyboarder server, so
                we physically can't see it: requests go from here straight to OpenRouter. You can
                revoke or rotate it any time at{' '}
                <button
                  type="button"
                  className="sb-onboard-link sb-onboard-link-inline"
                  onClick={() => {
                    try {
                      window.open('https://openrouter.ai/keys', '_blank', 'noopener,noreferrer');
                    } catch { /* noop */ }
                  }}
                >
                  openrouter.ai/keys
                </button>
                , and we recommend capping credit on the key for extra peace of mind.
              </p>
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
                onClick={handleFinish}
                disabled={keyValid !== true || submitting}
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
