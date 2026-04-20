import { useState, useEffect } from 'react';

export default function ApiKeysPage({
  providers,
  providerKeys,
  validationStatus,
  onSetProviderKey,
  onValidateKey,
}) {
  return (
    <div className="sb-api-keys-page">
      <p className="sb-settings-desc">
        Add API keys to connect to AI providers. Keys are stored locally on your machine and never sent anywhere except directly to the provider.
      </p>

      {providers.map((provider) => (
        <ProviderKeyCard
          key={provider.id}
          provider={provider}
          currentKey={providerKeys?.[provider.id] || ''}
          status={validationStatus?.[provider.id] || 'unknown'}
          onSave={(key) => onSetProviderKey?.(provider.id, key)}
          onValidate={() => onValidateKey?.(provider.id)}
        />
      ))}
    </div>
  );
}

function ProviderKeyCard({ provider, currentKey, status, onSave, onValidate }) {
  const [draft, setDraft] = useState(currentKey || '');
  const [justSaved, setJustSaved] = useState(false);

  // Validate on mount if key exists
  useEffect(() => {
    if (currentKey) onValidate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSave() {
    onSave?.(draft);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
    // Validate after a brief delay for the store to persist
    setTimeout(() => onValidate?.(), 300);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
  }

  const statusLabel = {
    unknown: { text: 'Not configured', className: 'sb-status-neutral' },
    validating: { text: 'Validating...', className: 'sb-status-pending' },
    valid: { text: 'Connected', className: 'sb-status-success' },
    invalid: { text: 'Invalid key', className: 'sb-status-error' },
  }[status] || { text: 'Unknown', className: 'sb-status-neutral' };

  return (
    <div className="sb-provider-card">
      <div className="sb-provider-card-header">
        <div>
          <h4 className="sb-provider-card-title">{provider.name}</h4>
          <p className="sb-provider-card-desc">{provider.description}</p>
        </div>
        <span className={`sb-status-badge ${statusLabel.className}`}>
          {statusLabel.text}
        </span>
      </div>

      <div className="sb-provider-card-body">
        <div className="sb-key-input-row">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={provider.keyPlaceholder}
            className="sb-input sb-key-input"
            autoComplete="off"
          />
          <button type="button" className="sb-btn sb-btn-primary" onClick={handleSave}>
            {justSaved ? 'Saved' : 'Save'}
          </button>
        </div>
        <p className="sb-hint">
          Get a key at{' '}
          <a href={provider.keyUrl} target="_blank" rel="noreferrer">
            {provider.keyUrl.replace('https://', '')}
          </a>
        </p>
      </div>
    </div>
  );
}
