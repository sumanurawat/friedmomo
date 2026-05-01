import ChatPanel from '../chat/ChatPanel.jsx';
import EntityPanel from '../sidebar/EntityPanel.jsx';
import ProjectList from '../sidebar/ProjectList.jsx';
import SceneDetail from '../storyboard/SceneDetail.jsx';
import ShotImageLightbox from '../storyboard/ShotImageLightbox.jsx';
import StoryboardGrid from '../storyboard/StoryboardGrid.jsx';

export default function AppLayout({
  hubOpen,
  setHubOpen,
  sidebarTab,
  setSidebarTab,
  projectProps,
  chatProps,
  storyboardProps,
  sceneDetailProps,
  entityProps,
  projectName,
  stats,
  onRestartTutorial,
  onOpenSettings,
  theme,
  onToggleTheme,
}) {
  return (
    <main className="sb-shell">
      <header className="sb-topbar">
        <div className="sb-topbar-brand">
          <div className="sb-logo">◧</div>
          <div>
            <strong>Storyboarder</strong>
            <p>{projectName || 'Untitled Story'}</p>
          </div>
        </div>

        <div className="sb-topbar-stats">
          <article title="Shots — one drawn frame per Sequence">
            <strong>{stats.scenes}</strong>
            <span>Shots</span>
          </article>
          <article title="Characters — reusable visual anchors">
            <strong>{stats.characters}</strong>
            <span>Characters</span>
          </article>
          <article title="Locations — reusable world anchors">
            <strong>{stats.locations}</strong>
            <span>Locations</span>
          </article>
        </div>

        <div className="sb-topbar-actions">
          <button
            type="button"
            className="sb-theme-btn"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <button
            type="button"
            className="sb-topbar-btn"
            title="Settings"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            <GearIcon />
          </button>

          <button
            type="button"
            className="sb-help-btn"
            title="Restart app tour"
            onClick={onRestartTutorial}
          >
            ? Help
          </button>

          <button
            type="button"
            className="sb-account-btn"
            onClick={() => setHubOpen((value) => !value)}
            aria-expanded={hubOpen}
            aria-label="Open workspace controls"
          >
            <span>☰</span>
          </button>
        </div>
      </header>

      <section className="sb-workspace">
        <section className="sb-chat-column">
          <ChatPanel {...chatProps} />
        </section>

        <section className="sb-board-column">
          <StoryboardGrid {...storyboardProps} />
        </section>

        <section className="sb-inspector-column">
          <SceneDetail key={sceneDetailProps.scene?.id || 'empty'} {...sceneDetailProps} />
        </section>
      </section>

      {hubOpen ? (
        <div className="sb-hub-overlay" onClick={() => setHubOpen(false)}>
          <aside className="sb-hub-panel" onClick={(event) => event.stopPropagation()}>
            <header className="sb-hub-head">
              <strong>Workspace</strong>
              <button type="button" className="sb-btn sb-btn-xs" onClick={() => setHubOpen(false)}>
                Close
              </button>
            </header>

            <div className="sb-sidebar-tabs">
              <button
                type="button"
                className={sidebarTab === 'stories' ? 'active' : ''}
                onClick={() => setSidebarTab('stories')}
                aria-pressed={sidebarTab === 'stories'}
              >
                Stories
              </button>
              <button
                type="button"
                className={sidebarTab === 'entities' ? 'active' : ''}
                onClick={() => setSidebarTab('entities')}
                aria-pressed={sidebarTab === 'entities'}
              >
                Entities
              </button>
            </div>

            <div className="sb-hub-content">
              {sidebarTab === 'stories' ? <ProjectList {...projectProps} /> : null}
              {sidebarTab === 'entities' ? <EntityPanel {...entityProps} /> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {/* Full-size image overlay — subscribes to useLightbox store, so any
          shot thumbnail anywhere in the tree can pop it open without prop
          threading. Renders a portal to document.body. */}
      <ShotImageLightbox />
    </main>
  );
}

// -----------------------------------------------------------------------------
// Topbar icons — inline Lucide-style SVGs in place of the old Unicode glyphs
// (☀ / ☽ / ⚙) which rendered with mixed fonts across browsers and looked
// noticeably less crisp than the rest of the icon set. Stroke + currentColor
// so they pick up the button's text colour and hover state automatically.
// -----------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sb-topbar-icon">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M6.34 17.66l-1.41 1.41" />
      <path d="M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sb-topbar-icon">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sb-topbar-icon">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
