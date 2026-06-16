"use client";

// The Mission Control filter bar — a compact, low-chrome pill row beneath the
// views toolbar. Presentational only: it never reads or writes the store. The
// parent (WorkViews) owns the FilterState and passes the option universes plus
// the live result count; this component renders the controls, popovers, and the
// removable active-filter chips, and reports changes through `onChange`.
//
// Keyboard: the text input clears all filters on Esc when focused (the global
// "/" focus and the no-input Esc-clear are wired in WorkViews via `inputRef`);
// see SPEC §3 for the chord/Esc precedence with PeoplePicker.

import { forwardRef, useEffect, useRef, useState } from "react";

import { ACTORS, PRIORITY, STAGES } from "@/lib/mc-data";
import type { PriorityKey, StageKey } from "@/lib/mc-data";

import type { FilterState } from "./work-views.helpers";
import { UNASSIGNED_KEY, hasActiveFilters } from "./work-views.helpers";

type Facet = "priority" | "assignee" | "label" | "stage";

function toggleValue<T extends string>(values: T[] | undefined, value: T): T[] {
  const current = values ?? [];
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

// A small popover of selectable options for one facet. Closes on outside click.
function FacetPopover({
  label,
  options,
  selected,
  onToggle,
  onClose,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDocPointer);
    return () => window.removeEventListener("mousedown", onDocPointer);
  }, [onClose]);

  return (
    <div className="fb-pop" ref={ref} onClick={(event) => event.stopPropagation()}>
      <div className="fb-pop-hd">{label}</div>
      {options.length === 0 ? (
        <div className="fb-pop-empty">No options</div>
      ) : (
        options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`fb-opt${selected.has(option.value) ? " on" : ""}`}
            onClick={() => onToggle(option.value)}
          >
            <span className="fb-check" aria-hidden>
              {selected.has(option.value) ? "✓" : ""}
            </span>
            {option.label}
          </button>
        ))
      )}
    </div>
  );
}

export interface FilterBarProps {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  resultCount: number;
  labels: string[];
  assignees: string[];
  hasUnassigned: boolean;
}

export const FilterBar = forwardRef<HTMLInputElement, FilterBarProps>(function FilterBar(
  { filters, onChange, resultCount, labels, assignees, hasUnassigned },
  inputRef
) {
  const [openFacet, setOpenFacet] = useState<Facet | null>(null);

  const priorityOptions = (Object.keys(PRIORITY) as PriorityKey[]).map((key) => ({
    value: key,
    label: PRIORITY[key].label,
  }));
  const stageOptions = STAGES.map((stage) => ({ value: stage.key, label: stage.name }));
  const labelOptions = labels.map((label) => ({ value: label, label }));
  const assigneeOptions = [
    ...assignees.map((id) => ({ value: id, label: ACTORS[id]?.name ?? id })),
    ...(hasUnassigned ? [{ value: UNASSIGNED_KEY, label: "Unassigned" }] : []),
  ];

  const active = hasActiveFilters(filters);

  const setText = (text: string) => onChange({ ...filters, text });
  const togglePriority = (value: string) =>
    onChange({ ...filters, priority: toggleValue<PriorityKey>(filters.priority, value as PriorityKey) });
  const toggleStage = (value: string) =>
    onChange({ ...filters, stage: toggleValue<StageKey>(filters.stage, value as StageKey) });
  const toggleLabel = (value: string) =>
    onChange({ ...filters, label: toggleValue(filters.label, value) });
  const toggleAssignee = (value: string) =>
    onChange({ ...filters, assignee: toggleValue(filters.assignee, value) });
  const clearAll = () => onChange({});

  // Active-filter chips (removable, click clears the value); the live count
  // sits to the right and updates as the parent re-derives `resultCount`.
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
  for (const key of filters.priority ?? []) {
    chips.push({
      key: `priority:${key}`,
      label: `Priority · ${PRIORITY[key]?.label ?? key}`,
      onRemove: () => togglePriority(key),
    });
  }
  for (const key of filters.stage ?? []) {
    const stage = STAGES.find((s) => s.key === key);
    chips.push({
      key: `stage:${key}`,
      label: `Stage · ${stage?.name ?? key}`,
      onRemove: () => toggleStage(key),
    });
  }
  for (const id of filters.assignee ?? []) {
    chips.push({
      key: `assignee:${id}`,
      label: `Assignee · ${id === UNASSIGNED_KEY ? "Unassigned" : (ACTORS[id]?.name ?? id)}`,
      onRemove: () => toggleAssignee(id),
    });
  }
  for (const label of filters.label ?? []) {
    chips.push({
      key: `label:${label}`,
      label: `Label · ${label}`,
      onRemove: () => toggleLabel(label),
    });
  }

  const facetButton = (facet: Facet, label: string) => (
    <div className="fb-facet">
      <button
        type="button"
        className={`pill fb-pill${openFacet === facet ? " on" : ""}`}
        onClick={() => setOpenFacet((prev) => (prev === facet ? null : facet))}
      >
        + {label}
      </button>
      {openFacet === facet ? (
        <FacetPopover
          label={label}
          options={
            facet === "priority"
              ? priorityOptions
              : facet === "stage"
                ? stageOptions
                : facet === "assignee"
                  ? assigneeOptions
                  : labelOptions
          }
          selected={
            new Set(
              facet === "priority"
                ? (filters.priority ?? [])
                : facet === "stage"
                  ? (filters.stage ?? [])
                  : facet === "assignee"
                    ? (filters.assignee ?? [])
                    : (filters.label ?? [])
            )
          }
          onToggle={
            facet === "priority"
              ? togglePriority
              : facet === "stage"
                ? toggleStage
                : facet === "assignee"
                  ? toggleAssignee
                  : toggleLabel
          }
          onClose={() => setOpenFacet(null)}
        />
      ) : null}
    </div>
  );

  return (
    <div className="filterbar">
      <div className="fb-search">
        <span className="fb-mag" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          className="fb-input"
          value={filters.text ?? ""}
          placeholder="Filter tasks…"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Esc clears every facet while the input is focused; the global
            // handler in WorkViews mirrors this when no input/picker is focused.
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              clearAll();
              event.currentTarget.blur();
            }
          }}
        />
      </div>

      <div className="fb-facets">
        {facetButton("priority", "Priority")}
        {facetButton("assignee", "Assignee")}
        {facetButton("label", "Label")}
        {facetButton("stage", "Stage")}
      </div>

      {chips.length > 0 ? (
        <div className="fb-chips">
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.key}
              className="fb-chip"
              onClick={chip.onRemove}
              title="Remove filter"
            >
              {chip.label} <span className="rm">✕</span>
            </button>
          ))}
        </div>
      ) : null}

      <span className="fb-count">
        {active ? (
          <>
            <b>{resultCount}</b> match{resultCount === 1 ? "" : "es"}
          </>
        ) : (
          <span className="fb-hint">Press / to filter</span>
        )}
      </span>

      {active ? (
        <button type="button" className="btn ghost fb-clear" onClick={clearAll}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
});
