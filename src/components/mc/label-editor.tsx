"use client";

// Shared inline label editor — the chip-group + draft-input + add/remove logic
// extracted from new-task-modal.tsx (the original inline block) so the task
// detail and the New Task modal share ONE implementation (Pillar 3: Reuse
// Before Create). Presentational + controlled: it owns no task state, only the
// transient draft string; the parent owns `labels` and persists via `onChange`.
//
// Styling: neutral `.le-*` classes (mc-task.css) so it renders correctly in
// both `.ntm` (modal) and `.td` (task detail) surfaces — the prior block was
// `.ntm`-scoped and not reusable.

import { useState } from "react";
import { KIND_PREFIX, KIND_LABELS, TASK_KIND_DEFAULT, isKindLabel, kindsOf, withKind } from "@/lib/tasks/kind-labels";

// Pure normalize used by the draft-add path — exported so the rule (trim +
// lowercase, drop blanks, dedupe) is unit-testable without rendering React
// (the repo's tests are pure-function/store only — vitest.config.ts).
export function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase();
}

// Pure: append a normalized label to a set, idempotently. Returns the SAME
// array reference when the label is blank or already present, so callers can
// cheaply detect a no-op.
export function addLabelTo(labels: string[], raw: string): string[] {
  const normalized = normalizeLabel(raw);
  if (!normalized || labels.includes(normalized)) return labels;
  // One kind per task: a new kind:* label replaces the existing one.
  if (isKindLabel(normalized)) return withKind(labels, normalized);
  return [...labels, normalized];
}

export function removeLabelFrom(labels: string[], label: string): string[] {
  return labels.filter((l) => l !== label);
}

export function LabelEditor({
  labels,
  onChange,
  placeholder = "+ label",
}: {
  labels: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const next = addLabelTo(labels, draft);
    if (next !== labels) onChange(next);
    setDraft("");
  };

  const remove = (label: string) => onChange(removeLabelFrom(labels, label));

  return (
    <div className="le-row">
      {labels.map((label) => (
        <button
          type="button"
          key={label}
          className="le-chip"
          onClick={() => remove(label)}
          title={`Remove ${label}`}
          aria-label={`Remove label ${label}`}
        >
          {label} <span className="le-rm" aria-hidden="true">✕</span>
        </button>
      ))}
      <input
        className="le-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
        onBlur={commitDraft}
        placeholder={placeholder}
        aria-label="Add a label"
      />
    </div>
  );
}

const kindName = (label: string) => {
  const name = label.slice(KIND_PREFIX.length).replace(/-/g, " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
};

// Required Kind select: swaps the task's kind:* label instead of appending a
// second one. Shows the default when the task carries no kind yet.
export function KindSelect({ labels, onChange }: { labels: string[]; onChange: (next: string[]) => void }) {
  return (
    <select
      value={kindsOf(labels)[0] ?? TASK_KIND_DEFAULT}
      onChange={(event) => onChange(withKind(labels, event.target.value))}
      aria-label="Task kind"
    >
      {KIND_LABELS.map((label) => (
        <option key={label} value={label}>{kindName(label)}</option>
      ))}
    </select>
  );
}
