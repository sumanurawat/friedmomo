import { useState } from 'react';
import ApiKeysPage from './ApiKeysPage.jsx';
import ModelsPage from './ModelsPage.jsx';
import GeneralPage from './GeneralPage.jsx';

const PAGES = [
  { id: 'api-keys', label: 'API Keys', icon: '🔑' },
  { id: 'models', label: 'Models', icon: '🧠' },
  { id: 'general', label: 'General', icon: '⚙' },
];

export default function SettingsPage({ onClose, settingsStore, theme, onToggleTheme }) {
  const [activePage, setActivePage] = useState('api-keys');

  return (
    <div className="sb-settings-page">
      <aside className="sb-settings-nav">
        <div className="sb-settings-nav-header">
          <button type="button" className="sb-settings-back" onClick={onClose} aria-label="Back to workspace">
            ← Back
          </button>
          <h2>Settings</h2>
        </div>
        <nav className="sb-settings-nav-list">
          {PAGES.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`sb-settings-nav-item ${activePage === page.id ? 'active' : ''}`}
              onClick={() => setActivePage(page.id)}
            >
              <span className="sb-settings-nav-icon">{page.icon}</span>
              <span>{page.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="sb-settings-content">
        <header className="sb-settings-content-header">
          <h3>{PAGES.find((p) => p.id === activePage)?.label}</h3>
        </header>

        <div className="sb-settings-content-body">
          {activePage === 'api-keys' && (
            <ApiKeysPage
              providers={settingsStore.providers}
              providerKeys={settingsStore.providerKeys}
              validationStatus={settingsStore.validationStatus}
              onSetProviderKey={settingsStore.setProviderKey}
              onValidateKey={settingsStore.validateProviderKey}
            />
          )}
          {activePage === 'models' && (
            <ModelsPage
              providers={settingsStore.providers}
              providerKeys={settingsStore.providerKeys}
              planningProvider={settingsStore.planningProvider}
              planningModel={settingsStore.planningModel}
              imageProvider={settingsStore.imageProvider}
              imageModel={settingsStore.imageModel}
              availableModels={settingsStore.availableModels}
              modelsFetching={settingsStore.modelsFetching}
              onSetPlanningProvider={settingsStore.setPlanningProvider}
              onSetPlanningModel={settingsStore.setPlanningModel}
              onSetImageProvider={settingsStore.setImageProvider}
              onSetImageModel={settingsStore.setImageModel}
              onFetchModels={settingsStore.fetchAvailableModels}
            />
          )}
          {activePage === 'general' && (
            <GeneralPage
              chatMode={settingsStore.chatMode}
              chatModeOptions={settingsStore.chatModeOptions}
              onChatModeChange={settingsStore.setChatMode}
              theme={theme}
              onToggleTheme={onToggleTheme}
            />
          )}
        </div>
      </main>
    </div>
  );
}
