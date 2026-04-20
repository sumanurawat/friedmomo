import { useState } from 'react';

export default function EntityPanel({
  entities,
  onCreateCharacter,
  activeCharacterId,
}) {
  const characters = Array.isArray(entities?.characters) ? entities.characters : [];
  const locations = Array.isArray(entities?.locations) ? entities.locations : [];
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState('Supporting');

  return (
    <section className="sb-entity-panel">
      <header className="sb-section-head">
        <h3>Characters (This Story)</h3>
      </header>

      <div className="sb-entity-create">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder="Description"
        />
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="Protagonist">Protagonist</option>
          <option value="Supporting">Supporting</option>
          <option value="Antagonist">Antagonist</option>
        </select>
        <button
          type="button"
          className="sb-btn sb-btn-primary"
          onClick={async () => {
            const createdId = await onCreateCharacter?.({ name, description, role });
            if (createdId) {
              setName('');
              setDescription('');
              setRole('Supporting');
            }
          }}
        >
          Add Character
        </button>
      </div>

      <div className="sb-entity-group">
        {characters.length === 0 ? <p className="sb-hint">No characters yet.</p> : null}
        {characters.map((character) => (
          <article
            key={character.id}
            className={`sb-entity-card ${
              String(activeCharacterId || '') === String(character.id || '') ? 'is-active' : ''
            }`}
          >
            <div className="sb-entity-head">
              <span className="sb-entity-dot" style={{ background: character.color || '#8ab4f8' }} />
              <strong>{character.name}</strong>
            </div>
            <p>{character.description || 'No description yet.'}</p>
            <small>{character.role || 'Supporting'}</small>
          </article>
        ))}
      </div>

      <header className="sb-section-head">
        <h3>Locations (This Story)</h3>
      </header>

      <div className="sb-entity-group">
        {locations.length === 0 ? <p className="sb-hint">No locations yet.</p> : null}
        {locations.map((location) => (
          <article key={location.id} className="sb-entity-card">
            <div className="sb-entity-head">
              <strong>{location.name}</strong>
            </div>
            <p>{location.description || 'No description yet.'}</p>
            <small>{location.mood || 'No mood'}</small>
          </article>
        ))}
      </div>

    </section>
  );
}
