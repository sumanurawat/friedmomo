export default function GeneralPage({
  chatMode,
  chatModeOptions,
  onChatModeChange,
  theme,
  onToggleTheme,
}) {
  return (
    <div className="sb-general-page">
      <section className="sb-general-section">
        <h4 className="sb-general-section-title">Chat Mode</h4>
        <p className="sb-settings-desc">Controls how aggressively the AI generates storyboard content.</p>
        <div className="sb-chat-mode-options">
          {chatModeOptions.map((option) => (
            <label
              key={option.id}
              className={`sb-chat-mode-card ${chatMode === option.id ? 'active' : ''}`}
            >
              <input
                type="radio"
                name="chatMode"
                value={option.id}
                checked={chatMode === option.id}
                onChange={() => onChatModeChange?.(option.id)}
                className="sb-radio-hidden"
              />
              <strong>{option.label}</strong>
              <p>{option.description}</p>
            </label>
          ))}
        </div>
      </section>

      <section className="sb-general-section">
        <h4 className="sb-general-section-title">Appearance</h4>
        <div className="sb-theme-toggle-row">
          <span>Theme</span>
          <button
            type="button"
            className="sb-btn"
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? '☀ Switch to Light' : '☽ Switch to Dark'}
          </button>
        </div>
      </section>

      <section className="sb-general-section">
        <h4 className="sb-general-section-title">About</h4>
        <p className="sb-settings-desc">
          Storyboarder v0.1.0 — A conversation-first desktop studio for storyboarding.
          All data is stored locally on your machine.
        </p>
      </section>
    </div>
  );
}
