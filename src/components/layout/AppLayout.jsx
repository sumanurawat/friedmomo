import ChatPanel from '../chat/ChatPanel.jsx';
import EntityPanel from '../sidebar/EntityPanel.jsx';
import ProjectList from '../sidebar/ProjectList.jsx';
import SceneDetail from '../storyboard/SceneDetail.jsx';
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
          <article>
            <strong>{stats.scenes}</strong>
            <span>Scenes</span>
          </article>
          <article>
            <strong>{stats.characters}</strong>
            <span>Characters</span>
          </article>
          <article>
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
            {theme === 'dark' ? '☀' : '☽'}
          </button>

          <button
            type="button"
            className="sb-topbar-btn"
            title="Settings"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            ⚙
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
    </main>
  );
}
