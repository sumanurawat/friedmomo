import { useMemo, useState } from 'react';

export default function ProjectList({
  projects,
  activeProjectId,
  onSwitch,
  onCreate,
  isCreating,
  onDelete,
  onRename,
}) {
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const ordered = useMemo(() => {
    const safe = Array.isArray(projects) ? projects : [];
    return [...safe].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }, [projects]);

  return (
    <section className="sb-project-list">
      <header className="sb-section-head">
        <h3>Stories</h3>
        <button type="button" className="sb-btn sb-btn-xs sb-btn-primary" onClick={onCreate} disabled={isCreating}>
          {isCreating ? 'Creating...' : 'New'}
        </button>
      </header>

      <div className="sb-project-items">
        {ordered.length === 0 ? <p className="sb-hint">No story projects yet.</p> : null}
        {ordered.map((project) => {
          const active = project.id === activeProjectId;
          const isEditing = editingProjectId === project.id;
          return (
            <article key={project.id} className={`sb-project-item ${active ? 'active' : ''}`}>
              {isEditing ? (
                <div className="sb-project-edit">
                  <input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        onRename?.(project.id, editingName);
                        setEditingProjectId(null);
                      }
                      if (event.key === 'Escape') {
                        setEditingProjectId(null);
                        setEditingName('');
                      }
                    }}
                    autoFocus
                  />
                </div>
              ) : (
                <button type="button" className="sb-project-main" onClick={() => onSwitch?.(project.id)}>
                  <strong>{project.name}</strong>
                  <span>{formatRelativeTime(project.updatedAt)}</span>
                </button>
              )}
              <div className="sb-project-actions">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="sb-btn sb-btn-xs"
                      onClick={() => {
                        onRename?.(project.id, editingName);
                        setEditingProjectId(null);
                        setEditingName('');
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="sb-btn sb-btn-xs"
                      onClick={() => {
                        setEditingProjectId(null);
                        setEditingName('');
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="sb-btn sb-btn-xs"
                    onClick={() => {
                      setEditingProjectId(project.id);
                      setEditingName(String(project.name || ''));
                    }}
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  className="sb-btn sb-btn-xs sb-btn-danger"
                  onClick={() => onDelete?.(project.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return 'Unknown';
  }

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return `${diffH}h ago`;
  }

  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}
