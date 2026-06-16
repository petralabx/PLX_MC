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

import { Fragment, forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ACTORS, PRIORITY, STAGES } from "@/lib/mc-data";
import type { PriorityKey, StageKey } from "@/lib/mc-data";

import type { FilterState } from "./work-views.helpers";
import { UNASSIGNED_KEY, hasActiveFilters } from "./work-views.helpers";

type Facet = "priority" | "assignee" | "label" | "stage";

// Facets in toolbar order. The per-facet option universe, current selection,
// and toggle handler are looked up from one config map below (one source — no
// 4-way ternary fan-out per facet, no per-facet JSX fork).
const FACET_ORDER: Array<{ facet: Facet; label: string }> = [
  { facet: "priority", label: "Priority" },
  { facet: "assignee", label: "Assignee" },
  { facet: "label", label: "Label" },
  { facet: "stage", label: "Stage" },
];

interface FacetConfig {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onToggle: (value: string) => void;
}

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
    // Esc closes just this popover (keyboard parity with the outside-click
    // close, mirroring PeoplePicker). Capture phase + stopPropagation so it does
    // not also reach the global no-field Esc-clear in WorkViews — closing the
    // open facet takes precedence over clearing all filters (SPEC §3).
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDocPointer);
    window.addEventListener("keydown", onEsc, true);
    return () => {
      window.removeEventListener("mousedown", onDocPointer);
      window.removeEventListener("keydown", onEsc, true);
    };
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

  // Option universes per facet. Priority/stage are static; label/assignee are
  // derived from the parent-supplied universes, so memoize on those inputs (the
  // parent re-derives them only when its task base changes).
  const priorityOptions = useMemo(
    () => (Object.keys(PRIORITY) as PriorityKey[]).map((key) => ({ value: key, label: PRIORITY[key].label })),
    []
  );
  const stageOptions = useMemo(
    () => STAGES.map((stage) => ({ value: stage.key, label: stage.name })),
    []
  );
  const labelOptions = useMemo(() => labels.map((label) => ({ value: label, label })), [labels]);
  const assigneeOptions = useMemo(
    () => [
      ...assignees.map((id) => ({ value: id, label: ACTORS[id]?.name ?? id })),
      ...(hasUnassigned ? [{ value: UNASSIGNED_KEY, label: "Unassigned" }] : []),
    ],
    [assignees, hasUnassigned]
  );

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
  // Stable so FacetPopover's outside-click effect isn't re-bound every render.
  const closeFacet = useCallback(() => setOpenFacet(null), []);

  // One config map: facet → { label, options, selection, toggle }. Both the
  // facet buttons and the active-filter chips read from this, so adding a 5th
  // facet is a single entry, not a new ternary arm in three places.
  const facetConfig: Record<Facet, FacetConfig> = {
    priority: { label: "Priority", options: priorityOptions, selected: new Set(filters.priority ?? []), onToggle: togglePriority },
    assignee: { label: "Assignee", options: assigneeOptions, selected: new Set(filters.assignee ?? []), onToggle: toggleAssignee },
    label: { label: "Label", options: labelOptions, selected: new Set(filters.label ?? []), onToggle: toggleLabel },
    stage: { label: "Stage", options: stageOptions, selected: new Set(filters.stage ?? []), onToggle: toggleStage },
  };

  // Active-filter chips (removable, click clears the value); the live count
  // sits to the right and updates as the parent re-derives `resultCount`. Only
  // the facet selections drive the chips, so they re-derive only when those
  // change (typing in the text input no longer rebuilds the chip row).
  const chips = useMemo(() => {
    const out: Array<{ key: string; label: string; onRemove: () => void }> = [];
    for (const key of filters.priority ?? []) {
      out.push({ key: `priority:${key}`, label: `Priority · ${PRIORITY[key]?.label ?? key}`, onRemove: () => togglePriority(key) });
    }
    for (const key of filters.stage ?? []) {
      const stage = STAGES.find((s) => s.key === key);
      out.push({ key: `stage:${key}`, label: `Stage · ${stage?.name ?? key}`, onRemove: () => toggleStage(key) });
    }
    for (const id of filters.assignee ?? []) {
      out.push({
        key: `assignee:${id}`,
        label: `Assignee · ${id === UNASSIGNED_KEY ? "Unassigned" : (ACTORS[id]?.name ?? id)}`,
        onRemove: () => toggleAssignee(id),
      });
    }
    for (const label of filters.label ?? []) {
      out.push({ key: `label:${label}`, label: `Label · ${label}`, onRemove: () => toggleLabel(label) });
    }
    return out;
    // togglePriority/etc. close over `filters` + `onChange`; `filters` is the
    // real input, so depend on the four selection arrays (re-derive on change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.priority, filters.stage, filters.assignee, filters.label]);

  const facetButton = (facet: Facet) => {
    const config = facetConfig[facet];
    return (
      <div className="fb-facet">
        <button
          type="button"
          className={`pill fb-pill${openFacet === facet ? " on" : ""}`}
          onClick={() => setOpenFacet((prev) => (prev === facet ? null : facet))}
        >
          + {config.label}
        </button>
        {openFacet === facet ? (
          <FacetPopover
            label={config.label}
            options={config.options}
            selected={config.selected}
            onToggle={config.onToggle}
            onClose={closeFacet}
          />
        ) : null}
      </div>
    );
  };

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
        {FACET_ORDER.map(({ facet }) => (
          <Fragment key={facet}>{facetButton(facet)}</Fragment>
        ))}
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
