import { useState } from 'react';

export default function JudgesPanel({ appMode, onSetAppMode, onUnlockJudgesMode }) {
  const isJudges = appMode === 'judges';
  const [passcode, setPasscode] = useState('');
  const [unlockStatus, setUnlockStatus] = useState('');

  const handleUnlock = async () => {
    const success = await onUnlockJudgesMode?.(passcode);
    if (success) {
      setUnlockStatus('Judge Mode Unlocked! 🚀');
      setPasscode('');
    } else {
      setUnlockStatus('Invalid passcode. Please try again.');
    }
    setTimeout(() => setUnlockStatus(''), 3000);
  };

  return (
    <section className="sb-judges-panel">
      <header className="sb-section-head">
        <h3>Judges Mode</h3>
      </header>

      {isJudges ? (
        <div className="sb-judges-mode-card is-active">
          <div className="sb-judges-mode-status">
            <span className="sb-judges-mode-dot" />
            <strong>Judges Mode Active</strong>
          </div>
          <p className="sb-hint">
            Both chat and image generation are running on the app's shared backend. If Vertex AI quota is exhausted, chat automatically falls back to OpenRouter.
          </p>
          <button
            type="button"
            className="sb-btn"
            style={{ marginTop: '0.75rem', width: '100%' }}
            onClick={() => onSetAppMode?.('free')}
          >
            Switch back to Free Mode
          </button>
        </div>
      ) : (
        <div className="sb-judges-mode-card">
          <div className="sb-judges-mode-status">
            <strong>Passcode Required</strong>
          </div>
          <p className="sb-hint">
            Reviewers and hackathon judges can use the passcode to unlock premium features without an API key.
          </p>
          
          <div className="sb-field" style={{ marginTop: '0.75rem' }}>
            <div className="sb-row">
              <input
                type="password"
                className="sb-input"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode..."
              />
              <button
                type="button"
                className="sb-btn sb-btn-primary"
                onClick={handleUnlock}
              >
                Unlock
              </button>
            </div>
            {unlockStatus && <p className="sb-hint" style={{ color: unlockStatus.includes('Unlocked') ? '#2fd6a3' : 'var(--sb-danger)', marginTop: '0.5rem' }}>{unlockStatus}</p>}
          </div>
        </div>
      )}

      <div className="sb-field" style={{ marginTop: '1.25rem' }}>
        <label className="sb-label">What is Judges Mode?</label>
        <p className="sb-hint">
          Enable full AI features — text planning and image generation — without requiring a personal API key. The app falls back to a secondary AI provider (OpenRouter) if primary Vertex AI quota runs out, ensuring a smooth demo experience.
        </p>
      </div>
    </section>
  );
}

