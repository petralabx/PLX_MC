"use client";

// Inline repo editor (EN-005 / WS-5) — edit a task's repos post-creation,
// constrained to the registry allow-list. Unlike the free-text LabelEditor, the
// add control is a SELECT whose options ARE the registry, so an off-list repo
// can't be chosen in the first place; the store action + server re-validate
// against the same allow-list as defense in depth. Presentational + controlled:
// the parent owns `repos` and persists via `onChange`. Reuses the neutral .le-*
// / .rfact-select chrome (no new CSS), like RepoChip reads the runtime registry.

import { allRepos } from "@/lib/mc-data/store";

export function RepoEditor({
  repos,
  onChange,
}: {
  repos: string[];
  onChange: (next: string[]) => void;
}) {
  const registry = allRepos();
  const available = Object.values(registry).filter((r) => !repos.includes(r.id));

  const add = (id: string) => {
    if (!id || repos.includes(id) || !(id in registry)) return;
    onChange([...repos, id]);
  };
  const remove = (id: string) => onChange(repos.filter((r) => r !== id));

  return (
    <div className="le-row">
      {repos.map((id) => {
        const r = registry[id];
        const name = r ? r.name : id;
        return (
          <button
            type="button"
            key={id}
            className="le-chip"
            onClick={() => remove(id)}
            title={`Remove ${name}`}
            aria-label={`Remove repo ${name}`}
          >
            {name} <span className="le-rm" aria-hidden="true">✕</span>
          </button>
        );
      })}
      {available.length > 0 && (
        <label className="rfact-select le-add">
          <select
            value=""
            onChange={(event) => add(event.target.value)}
            aria-label="Add a repo from the registry"
          >
            <option value="" disabled>
              + repo
            </option>
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <span className="caret" aria-hidden="true">▾</span>
        </label>
      )}
    </div>
  );
}
