"use client";

import { useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, CircleDot, FileText, SquareCheck } from "lucide-react";

import type { Bucket } from "@/lib/mc-data";
import { docLinkFromPrd, docLinkKind } from "@/lib/mc-data/doc-links";

import { HealthPill } from "./atoms";
import { PrdLinkField } from "./bucket-detail";
import {
  dueCounts,
  filterCounts,
  filterDue,
  filterTasks,
  isOutstanding,
  needsHuman,
  type DueFilterKey,
  type InitiativeRollup,
  type TaskFilterKey,
} from "./project-overview.helpers";
import type { Nav } from "./route";
import { DueFilter, TaskFilter } from "./task-filter";
import { TaskTable } from "./task-table";

// Project Overview lens — the whole project tree on one page: every initiative
// as a collapsible section (health left-rule, spec link, progress in the
// header), its tasks as a tiered table underneath, all filtered by one
// Outstanding / Needs a human / All switch. Design: TASK-3174 handoff,
// "Screen 1 — Project page".
export function ProjectOverview({
  projectId,
  rollups,
  nav,
}: {
  projectId: string;
  rollups: InitiativeRollup[];
  nav: Nav;
}) {
  const [filter, setFilter] = useState<TaskFilterKey>("open");
  const [due, setDue] = useState<DueFilterKey>("any");
  // Explicit per-section choices; a section without one starts collapsed only
  // when the filter leaves it nothing to show.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (rollups.length === 0) {
    return <p className="sub">No initiatives under this project yet.</p>;
  }

  const allTasks = rollups.flatMap((r) => r.tasks);
  const counts = filterCounts(allTasks);
  const now = new Date();
  // The Due counts are within the status filter, so each one is what choosing it shows.
  const dueCountsNow = dueCounts(filterTasks(allTasks, filter), now);
  const setAll = (value: boolean) =>
    setCollapsed(Object.fromEntries(rollups.map((r) => [r.bucket.id, value])));

  return (
    <>
      <div className="bh pv-ovh">
        <span className="kk">
          / Overview · <b>{rollups.length}</b>
        </span>
        <TaskFilter
          value={filter}
          counts={counts}
          onChange={(next) => {
            setFilter(next);
            setCollapsed({});
          }}
        />
        <DueFilter
          value={due}
          counts={dueCountsNow}
          onChange={(next) => {
            setDue(next);
            setCollapsed({});
          }}
        />
        <span className="pv-ovh-acts">
          <button type="button" className="pv-textbtn" onClick={() => setAll(false)}>
            Expand all
          </button>
          <button type="button" className="pv-textbtn" onClick={() => setAll(true)}>
            Collapse all
          </button>
        </span>
      </div>
      <div className="pv-roll">
        {rollups.map((rollup) => {
          const pool = filterDue(filterTasks(rollup.tasks, filter), due, now);
          const isCollapsed = collapsed[rollup.bucket.id] ?? pool.length === 0;
          return (
            <InitiativeSection
              key={rollup.bucket.id}
              rollup={rollup}
              filter={filter}
              due={due}
              now={now}
              pool={pool}
              collapsed={isCollapsed}
              onToggle={() => setCollapsed((prev) => ({ ...prev, [rollup.bucket.id]: !isCollapsed }))}
              projectId={projectId}
              nav={nav}
            />
          );
        })}
      </div>
    </>
  );
}

// The status filter speaks first: the Due message shows only when the status
// filter left rows and the Due choice took them all.
function emptyText(filter: TaskFilterKey, due: DueFilterKey, total: number, statusRows: number): string {
  if (total === 0) return "No tasks in this initiative yet.";
  if (due !== "any" && statusRows > 0) {
    return due === "none" ? "Nothing here is missing a due date." : "Nothing here is due in these dates.";
  }
  if (filter === "human") return "Nothing waiting on a human.";
  return `Nothing outstanding · all ${total} tasks closed.`;
}

function InitiativeSection({
  rollup,
  filter,
  due,
  now,
  pool,
  collapsed,
  onToggle,
  projectId,
  nav,
}: {
  rollup: InitiativeRollup;
  filter: TaskFilterKey;
  due: DueFilterKey;
  now: Date;
  pool: InitiativeRollup["tasks"];
  collapsed: boolean;
  onToggle: () => void;
  projectId: string;
  nav: Nav;
}) {
  const { bucket, tasks, done, cancelled, unconfirmed, closedTasks, remaining, total, pct } = rollup;
  const barStyle = { "--pct": `${pct}%` } as CSSProperties;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section className={`pv-sec ${bucket.health}${collapsed ? " closed" : ""}`}>
      <div className="pv-sec-h">
        <button
          type="button"
          className="pv-sec-chev"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${bucket.name}`}
          onClick={onToggle}
        >
          <Chevron size={14} aria-hidden="true" />
        </button>
        <div className="pv-sec-title">
          <button type="button" className="nm" onClick={onToggle} title={bucket.name}>
            {bucket.name}
          </button>
          <span className="pv-sec-meta">
            <span className="id">{bucket.id}</span>
            <span className="sep" aria-hidden="true">
              |
            </span>
            <SpecLink bucket={bucket} />
          </span>
        </div>
        <div className="pv-sec-r">
          <span className="track">
            <span className="bar" style={barStyle}>
              <span className="fill" />
            </span>
            <span className="ct">
              {total === 0 ? (
                "No tasks yet"
              ) : filter === "human" ? (
                `${tasks.filter(needsHuman).length} need a human · ${remaining} outstanding`
              ) : (
                <>
                  <span className="long">
                    {remaining} outstanding · {closedTasks} / {total} closed · {done} done · {cancelled} cancelled
                    {unconfirmed > 0 && ` · ${unconfirmed} unconfirmed`}
                  </span>
                  <span className="short">
                    {remaining} open · {closedTasks} / {total} closed
                  </span>
                </>
              )}
            </span>
          </span>
          <HealthPill h={bucket.health} />
          <button
            type="button"
            className="pv-open tl-link"
            onClick={() => nav("bucket", { bucketId: bucket.id, projectId })}
          >
            Open →
          </button>
        </div>
      </div>
      {!collapsed && (
        <TaskTable
          // A filter switch starts each table fresh (row cap + closed reveal).
          key={`${filter}-${due}`}
          tasks={pool}
          closed={filter === "open" ? filterDue(tasks.filter((t) => !isOutstanding(t)), due, now) : undefined}
          emptyText={emptyText(filter, due, total, filterTasks(tasks, filter).length)}
          nav={nav}
        />
      )}
    </section>
  );
}

/** Spec link icon by link kind (docLinkKind). */
export const SPEC_ICON = { task: SquareCheck, issue: CircleDot, doc: FileText };

// The initiative's spec lives with it: the bucket `prd` link, or an inline
// "+ Add spec" that opens the same PrdLinkField the initiative page uses.
function SpecLink({ bucket }: { bucket: Bucket }) {
  const [adding, setAdding] = useState(false);
  const link = docLinkFromPrd(bucket.prd);
  if (link) {
    const Icon = SPEC_ICON[docLinkKind(link)];
    return (
      <a className="pv-spec" href={link.href} target="_blank" rel="noopener noreferrer" title={`Spec · ${link.label}`}>
        <Icon size={11} aria-hidden="true" />
        <span className="lb">{link.label}</span>
      </a>
    );
  }
  return (
    <span className="pv-spec-add">
      <button type="button" className="pv-textbtn" aria-expanded={adding} onClick={() => setAdding((open) => !open)}>
        + Add spec
      </button>
      {adding && (
        <span className="pv-spec-pop">
          <PrdLinkField key={`${bucket.id}:${bucket.prd ?? ""}`} bucketId={bucket.id} prd={bucket.prd} />
          <button type="button" className="btn ghost sm" onClick={() => setAdding(false)}>
            Done
          </button>
        </span>
      )}
    </span>
  );
}
