import { useState, useEffect, useMemo } from 'react';
import { getSuggestedModels } from '../../config/providers.js';

export default function ModelsPage({
  providers,
  providerKeys,
  planningProvider,
  planningModel,
  imageProvider,
  imageModel,
  availableModels,
  modelsFetching,
  onSetPlanningProvider,
  onSetPlanningModel,
  onSetImageProvider,
  onSetImageModel,
  onFetchModels,
}) {
  const configuredProviders = providers.filter((p) => Boolean(providerKeys?.[p.id]));

  return (
    <div className="sb-models-page">
      {configuredProviders.length === 0 && (
        <div className="sb-settings-empty">
          <p>No API keys configured yet. Add one in the <strong>API Keys</strong> page first.</p>
        </div>
      )}

      <section className="sb-model-section">
        <h4 className="sb-model-section-title">Planning Model</h4>
        <p className="sb-settings-desc">Used for story writing, scene generation, and chat conversations.</p>
        <ModelPicker
          providers={configuredProviders}
          selectedProvider={planningProvider}
          selectedModel={planningModel}
          modelType="planning"
          availableModels={availableModels}
          modelsFetching={modelsFetching}
          onProviderChange={onSetPlanningProvider}
          onModelChange={onSetPlanningModel}
          onFetchModels={onFetchModels}
          providerKeys={providerKeys}
        />
      </section>

      <section className="sb-model-section">
        <h4 className="sb-model-section-title">Image Model</h4>
        <p className="sb-settings-desc">Used for generating storyboard frame images.</p>
        <ModelPicker
          providers={configuredProviders}
          selectedProvider={imageProvider}
          selectedModel={imageModel}
          modelType="image"
          availableModels={availableModels}
          modelsFetching={modelsFetching}
          onProviderChange={onSetImageProvider}
          onModelChange={onSetImageModel}
          onFetchModels={onFetchModels}
          providerKeys={providerKeys}
        />
      </section>
    </div>
  );
}

function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  modelType,
  availableModels,
  modelsFetching,
  onProviderChange,
  onModelChange,
  onFetchModels,
  providerKeys,
}) {
  const [search, setSearch] = useState('');
  const isFetching = Boolean(modelsFetching?.[selectedProvider]);

  // Fetch models when provider changes (if we have a key and haven't fetched yet)
  useEffect(() => {
    if (selectedProvider && providerKeys?.[selectedProvider] && !availableModels?.[selectedProvider]) {
      onFetchModels?.(selectedProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider]);

  const liveModels = availableModels?.[selectedProvider] || [];
  const suggested = getSuggestedModels(selectedProvider, modelType);

  // Merge: suggested models first (already marked with `recommended` as set
  // in providers.js), then live models not already in the suggested set.
  //
  // For the image picker specifically, we filter the live list down to models
  // that actually generate images (output_modalities includes 'image') — the
  // rest of OpenRouter's catalog is chat models and would be misleading here.
  const allModels = useMemo(() => {
    const suggestedIds = new Set(suggested.map((m) => m.id));
    const merged = suggested.map((m) => ({ ...m, suggested: true }));

    for (const m of liveModels) {
      if (suggestedIds.has(m.id)) continue;
      if (modelType === 'image') {
        const outs = Array.isArray(m.outputModalities) ? m.outputModalities : [];
        if (!outs.includes('image')) continue;
      }
      merged.push({
        id: m.id,
        name: m.name || m.id,
        label: m.name || m.id,
        suggested: false,
      });
    }

    return merged;
  }, [suggested, liveModels, modelType]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allModels;
    const q = search.toLowerCase();
    return allModels.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.label || '').toLowerCase().includes(q) ||
        (m.name || '').toLowerCase().includes(q)
    );
  }, [allModels, search]);

  if (providers.length === 0) return null;

  return (
    <div className="sb-model-picker">
      <div className="sb-model-picker-row">
        <div className="sb-model-picker-field">
          <label className="sb-label">Provider</label>
          <select
            value={selectedProvider}
            onChange={(e) => {
              onProviderChange?.(e.target.value);
              setSearch('');
            }}
            className="sb-select"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="sb-model-picker-field sb-model-picker-field-grow">
          <label className="sb-label">
            Model
            {isFetching && <span className="sb-fetch-indicator"> (loading models...)</span>}
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={selectedModel || 'Search models...'}
            className="sb-input sb-model-search"
          />
        </div>
      </div>

      {selectedModel && (
        <div className="sb-current-model">
          Current: <strong>{selectedModel}</strong>
        </div>
      )}

      <div className="sb-model-list">
        {filtered.length === 0 && (
          <div className="sb-model-list-empty">
            {search ? 'No models match your search.' : 'No models available.'}
          </div>
        )}
        {filtered.slice(0, 50).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`sb-model-list-item ${m.id === selectedModel ? 'active' : ''} ${m.suggested ? 'suggested' : ''}`}
            onClick={() => {
              onModelChange?.(m.id);
              setSearch('');
            }}
          >
            <span className="sb-model-list-name">{m.label || m.name || m.id}</span>
            <span className="sb-model-list-id">{m.id}</span>
            {m.recommended && <span className="sb-model-list-badge">Recommended</span>}
            {m.tier && <span className="sb-model-list-tier">{m.tier}</span>}
          </button>
        ))}
        {filtered.length > 50 && (
          <div className="sb-model-list-more">
            Showing 50 of {filtered.length} models. Use search to narrow down.
          </div>
        )}
      </div>

      <button
        type="button"
        className="sb-btn-link"
        onClick={() => onFetchModels?.(selectedProvider)}
        disabled={isFetching}
      >
        {isFetching ? 'Refreshing...' : 'Refresh model list'}
      </button>
    </div>
  );
}
