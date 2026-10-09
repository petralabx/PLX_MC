"use client";

// Dashboard (TASK-2565) — delivery progress across projects and buckets: what is
// complete, what remains, where open work sits and which projects need
// attention. One pure read (buildDashboard) over the store's viewer-scoped
// projects, buckets and tasks, re-run after any store change. Selecting a
// project focuses the stages, buckets and task list on it; selecting a stage or
// a bucket filters the task list; a task title opens the task.
//
// Reuses the Insights lane (KPI strip, chart cards, CategoryBar) through the
// .insights wrapper, HealthPill, the project overview's stage chips and the
// Priority atom; mc-dashboard.css adds only what those don't cover.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PRIORITY, STAGES, STAGE_IDX } from "@/lib/mc-data";
import type { PriorityKey } from "@/lib/mc-data";
import { DASHBOARD_SCOPES, buildDashboard, inScope, openStageCounts } from "@/lib/mc-data/dashboard";
import type {
  BucketProgress,
  DashboardScope,
  ProgressCounts,
  ProjectProgress,
  RemainingTask,
  ScopeSummary,
} from "@/lib/mc-data/dashboard";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allBuckets, allProjects, allTasks } from "@/lib/mc-data/store";

import { HealthPill, Priority } from "./atoms";
import { CategoryBar, type ChartSlice } from "./charts";
import { STATUS_COLOR_VAR } from "./charts/chart-tokens";
import { stageChipTone } from "./project-overview.helpers";
import type { ScreenProps } from "./route";

const SCOPE_LABEL: Record<DashboardScope, string> = { active: "Active", closed: "Closed", all: "All" };

type SortKey = "id" | "title" | "stage" | "priority" | "bucket" | "project";
interface Sort {
  key: SortKey;
  dir: 1 | -1;
}
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "Task" },
  { key: "title", label: "Title" },
  { key: "stage", label: "Stage" },
  { key: "priority", label: "Priority" },
  { key: "bucket", label: "Initiative" },
  { key: "project", label: "Project" },
];
// Stage and priority sort most advanced / most urgent first by default.
const DEFAULT_SORT: Sort = { key: "stage", dir: -1 };
const PRIORITY_RANK = Object.fromEntries(
  (Object.keys(PRIORITY) as PriorityKey[]).map((key, i, keys) => [key, keys.length - i])
) as Record<PriorityKey, number>;

const fmt = (n: number) => n.toLocaleString("en-US");
const pctText = (v: number | null, digits = 0) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const widthOf = (v: number | null) => `${((v ?? 0) * 100).toFixed(2)}%`;
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const isAttention = (health: string) => health === "risk" || health === "off";

function sortValue(row: RemainingTask, key: SortKey): number | string {
  switch (key) {
    case "id":
      return Number(row.task.id.replace(/\D/g, "")) || 0;
    case "title":
      return row.task.title;
    case "stage":
      return STAGE_IDX[row.task.stage] ?? -1;
    case "priority":
      return PRIORITY_RANK[row.task.priority] ?? 0;
    case "bucket":
      return row.bucket.name;
    case "project":
      return row.project.name;
  }
}

function compareRows(sort: Sort) {
  return (a: RemainingTask, b: RemainingTask) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), undefined, { numeric: true });
    return (
      c * sort.dir ||
      PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority] ||
      (sortValue(a, "id") as number) - (sortValue(b, "id") as number)
    );
  };
}

// One sentence: project health first, then where the remaining work is.
function takeaway(scope: DashboardScope, s: ScopeSummary, projects: ProjectProgress[]): string {
  const word = scope === "all" ? "" : `${scope} `;
  if (s.projects === 0) return `There are no ${word}projects.`;
  const noun = `${word}${s.projects === 1 ? "project" : "projects"}`;
  const verb = (n: number) => (n === 1 ? "is" : "are");
  let health: string;
  if (s.projectsAtRisk > 0) {
    health = `${fmt(s.projectsAtRisk)} of ${fmt(s.projects)} ${noun} ${verb(s.projectsAtRisk)} at risk`;
    if (s.projectsOffTrack > 0) health += ` and ${fmt(s.projectsOffTrack)} ${verb(s.projectsOffTrack)} off track`;
  } else if (s.projectsOffTrack > 0) {
    health = `${fmt(s.projectsOffTrack)} of ${fmt(s.projects)} ${noun} ${verb(s.projectsOffTrack)} off track`;
  } else {
    health = s.projects === 1 ? `The ${noun} is on track` : `All ${fmt(s.projects)} ${noun} are on track`;
  }
  if (s.remaining === 0) return `${health}, and every task is complete.`;
  const top = projects.reduce((a, b) => (b.remaining > a.remaining ? b : a));
  if (top.remaining === s.remaining) {
    return `${health}; all ${plural(s.remaining, "remaining task is", "remaining tasks are")} in ${top.project.name}.`;
  }
  return `${health}; ${top.project.name} holds ${fmt(top.remaining)} of the ${fmt(s.remaining)} remaining tasks.`;
}

function HealthLine({ atRisk, offTrack }: { atRisk: number; offTrack: number }) {
  if (atRisk === 0 && offTrack === 0) return <>All on track</>;
  return (
    <>
      {atRisk > 0 && <span className="warn">{fmt(atRisk)} at risk</span>}
      {atRisk > 0 && offTrack > 0 && " · "}
      {offTrack > 0 && <span className="hot">{fmt(offTrack)} off track</span>}
    </>
  );
}

function ProgressRow({
  name,
  health,
  counts,
  pressed,
  onSelect,
  children,
}: {
  name: string;
  health: ProjectProgress["project"]["health"];
  counts: ProgressCounts;
  pressed: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="dash-row" aria-pressed={pressed} onClick={onSelect}>
      <span className="nm">{name}</span>
      <HealthPill h={health} />
      <span className="dash-bar" aria-hidden="true">
        <span style={{ width: widthOf(counts.pctDone) }} />
      </span>
      <span className="pct">{pctText(counts.pctDone)}</span>
      <span className="meta">{children}</span>
    </button>
  );
}

function bucketMeta(row: BucketProgress, withProject: boolean) {
  const lead = withProject ? `${row.project.name} · ` : "";
  if (row.total === 0) return `${lead}No tasks yet`;
  if (row.remaining === 0) return `${lead}All ${fmt(row.total)} done`;
  const moving = row.inProgress > 0 ? `, ${fmt(row.inProgress)} in progress` : "";
  return `${lead}${fmt(row.done)} of ${fmt(row.total)} done · ${fmt(row.remaining)} left${moving}`;
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button type="button" className="dash-filter" aria-label={`Clear filter: ${label}`} onClick={onClear}>
      {label}
      <span aria-hidden="true">×</span>
    </button>
  );
}

export function DashboardView({ nav }: ScreenProps) {
  // Re-aggregate after any store mutation, like Insights.
  const version = useMcVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => buildDashboard(allTasks(), allBuckets(), allProjects()), [version]);

  const [scope, setScope] = useState<DashboardScope>("active");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [bucketId, setBucketId] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);

  const summary = model.scopes[scope];
  const projects = model.projects.filter((p) => inScope(p.closed, scope));
  const focus = projects.find((p) => p.project.id === projectId) ?? null;
  const buckets = model.buckets.filter((b) => inScope(b.closed, scope) && (!focus || b.project.id === focus.project.id));
  const bucket = buckets.find((b) => b.bucket.id === bucketId) ?? null;
  const open = model.remaining.filter((r) => inScope(r.closed, scope) && (!focus || r.project.id === focus.project.id));
  const stageCounts = openStageCounts(open);
  const stageName = stageCounts.find((c) => c.stage === stage)?.name ?? null;

  const changeScope = (next: DashboardScope) => {
    setScope(next);
    setProjectId(null);
    setBucketId(null);
  };
  const selectProject = (id: string) => {
    setProjectId(id === projectId ? null : id);
    setBucketId(null);
  };
  const selectBucket = (id: string) => setBucketId(id === bucketId ? null : id);
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "stage" || key === "priority" ? -1 : 1 }));

  if (model.projects.length === 0) {
    return (
      <div className="mc-main" data-testid="dashboard-screen">
        <DashboardHeader scope={scope} onScope={changeScope} sub="Progress across every project and initiative." />
        <div className="empty">
          <h3>Nothing to track yet</h3>
          <p>The dashboard tracks progress across projects and their initiatives. Once there is a project, its progress appears here.</p>
          <div className="acts">
            <button type="button" className="btn ghost" onClick={() => nav("board")}>
              Go to the board
            </button>
          </div>
        </div>
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const rows = open
    .filter((r) => (!bucket || r.bucket.id === bucket.bucket.id) && (!stage || r.task.stage === stage))
    .filter(
      (r) =>
        !needle ||
        `${r.task.id} ${r.task.title} ${r.bucket.name} ${r.project.name}`.toLowerCase().includes(needle)
    )
    .sort(compareRows(sort));
  const attention = projects.filter((p) => isAttention(p.project.health));
  const riskBuckets = buckets
    .filter((b) => isAttention(b.bucket.health))
    .sort((a, b) => Number(b.bucket.health === "off") - Number(a.bucket.health === "off") || b.remaining - a.remaining);
  const groups = groupByProject(buckets);
  const slices: ChartSlice[] = stageCounts.map((c) => ({
    key: c.stage,
    label: c.name,
    value: c.tasks,
    colorVar: STATUS_COLOR_VAR[c.band],
    filter: null,
  }));

  return (
    <div className="mc-main" data-testid="dashboard-screen">
      <DashboardHeader scope={scope} onScope={changeScope} sub={takeaway(scope, summary, projects)} />

      <div className="insights dash">
        {attention.length > 0 && (
          <div className="dash-attn" role="group" aria-label="Projects that need attention">
            <span className="lbl">Needs attention</span>
            {attention.map((p) => (
              <button
                key={p.project.id}
                type="button"
                aria-pressed={focus?.project.id === p.project.id}
                onClick={() => selectProject(p.project.id)}
              >
                <HealthPill h={p.project.health} />
                <span>{p.project.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="kpis">
          <div className="kpi">
            <span className="v">{fmt(summary.done)}</span>
            <span className="k">Tasks complete</span>
            <span className="dash-bar" aria-hidden="true">
              <span style={{ width: widthOf(summary.pctDone) }} />
            </span>
            <span className="dash-sub">
              {summary.total > 0 ? `${pctText(summary.pctDone, 1)} of ${plural(summary.total, "task", "tasks")}` : "No tasks yet"}
            </span>
          </div>
          <div className="kpi">
            <span className="v">{fmt(summary.remaining)}</span>
            <span className="k">Tasks remaining</span>
            <span className="dash-sub">
              {fmt(summary.inProgress)} in progress · {fmt(summary.notStarted)} not started
            </span>
          </div>
          <div className="kpi">
            <span className="v">{fmt(summary.projects)}</span>
            <span className="k">Projects</span>
            <span className="dash-sub">
              <HealthLine atRisk={summary.projectsAtRisk} offTrack={summary.projectsOffTrack} />
            </span>
          </div>
          <div className="kpi">
            <span className="v">{fmt(summary.buckets)}</span>
            <span className="k">Initiatives</span>
            <span className="dash-sub">
              <HealthLine atRisk={summary.bucketsAtRisk} offTrack={summary.bucketsOffTrack} />
            </span>
          </div>
        </div>

        <div className="dash-grid">
          <section className="chartcard" aria-labelledby="dash-projects-title">
            <h2 className="chartcard-title" id="dash-projects-title">
              Project progress
            </h2>
            <p className="dash-note">
              Share of each project’s tasks that are complete, most remaining work first. Select a project to focus the
              stages, initiatives and task list on it.
            </p>
            <div className="dash-rows">
              {projects.length === 0 ? (
                <p className="dash-empty">No {scope === "all" ? "" : `${scope} `}projects.</p>
              ) : (
                projects.map((p) => (
                  <ProgressRow
                    key={p.project.id}
                    name={p.project.name}
                    health={p.project.health}
                    counts={p}
                    pressed={focus?.project.id === p.project.id}
                    onSelect={() => selectProject(p.project.id)}
                  >
                    {fmt(p.done)} of {fmt(p.total)} done · {fmt(p.remaining)} left · {plural(p.buckets, "initiative", "initiatives")}
                  </ProgressRow>
                ))
              )}
            </div>
          </section>

          <div className="dash-side">
            <section className="chartcard" aria-label="Remaining tasks by stage">
              <CategoryBar
                title="Remaining tasks by stage"
                slices={slices}
                onSlice={(slice) => setStage(slice.key === stage ? null : slice.key)}
              />
              {(focus || stageName) && (
                <div className="dash-focus">
                  {focus && <FilterChip label={focus.project.name} onClear={() => selectProject(focus.project.id)} />}
                  {stageName && <FilterChip label={`Task list: ${stageName}`} onClear={() => setStage(null)} />}
                  {focus && (
                    <button type="button" className="tl-link" onClick={() => nav("project", { projectId: focus.project.id })}>
                      Open project
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="chartcard" aria-labelledby="dash-attention-title">
              <h2 className="chartcard-title" id="dash-attention-title">
                Initiatives needing attention
              </h2>
              <div className="dash-rows">
                {riskBuckets.length === 0 ? (
                  <p className="dash-empty">No initiatives in this view are at risk or off track.</p>
                ) : (
                  riskBuckets.map((b) => (
                    <ProgressRow
                      key={b.bucket.id}
                      name={b.bucket.name}
                      health={b.bucket.health}
                      counts={b}
                      pressed={bucket?.bucket.id === b.bucket.id}
                      onSelect={() => selectBucket(b.bucket.id)}
                    >
                      {bucketMeta(b, true)}
                    </ProgressRow>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        <section className="chartcard" aria-labelledby="dash-buckets-title">
          <h2 className="chartcard-title" id="dash-buckets-title">
            Initiative progress
          </h2>
          <p className="dash-note">
            Share of each initiative’s tasks that are complete, grouped by project. Select an initiative to filter the task list.
          </p>
          {groups.length === 0 ? (
            <p className="dash-empty">No initiatives in this view.</p>
          ) : (
            <div className={`dash-groups${groups.length === 1 ? " single" : ""}`}>
              {groups.map((group) => (
                <section key={group.project.id} className="dash-group" aria-label={group.project.name}>
                  <div className="dash-group-h">
                    <h3>{group.project.name}</h3>
                    <button type="button" className="tl-link" onClick={() => nav("project", { projectId: group.project.id })}>
                      Open project
                    </button>
                  </div>
                  <div className="dash-rows">
                    {group.buckets.map((b) => (
                      <ProgressRow
                        key={b.bucket.id}
                        name={b.bucket.name}
                        health={b.bucket.health}
                        counts={b}
                        pressed={bucket?.bucket.id === b.bucket.id}
                        onSelect={() => selectBucket(b.bucket.id)}
                      >
                        {bucketMeta(b, false)}
                      </ProgressRow>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <section className="chartcard" aria-labelledby="dash-tasks-title">
          <h2 className="chartcard-title" id="dash-tasks-title">
            Remaining tasks
          </h2>
          <p className="dash-note">Every task not yet Merged or Verified. Select a column heading to sort.</p>
          <div className="dash-tools">
            <input
              id="dash-task-search"
              className="dash-search"
              type="search"
              value={query}
              placeholder="Search by task, title, initiative or project"
              aria-label="Search remaining tasks"
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
            {focus && <FilterChip label={focus.project.name} onClear={() => selectProject(focus.project.id)} />}
            {bucket && <FilterChip label={bucket.bucket.name} onClear={() => setBucketId(null)} />}
            {stageName && <FilterChip label={stageName} onClear={() => setStage(null)} />}
          </div>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`c-${c.key}`}
                      aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    >
                      <button type="button" onClick={() => sortBy(c.key)}>
                        {c.label}
                        {sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.task.id}>
                    <td className="c-id">{r.task.id}</td>
                    <td className="c-title">
                      <button type="button" className="dash-link" onClick={() => nav("task", { taskId: r.task.id })}>
                        {r.task.title}
                      </button>
                    </td>
                    <td className="c-stage">
                      <span className={`pv-chip ${stageChipTone(r.task)}`}>{STAGES[STAGE_IDX[r.task.stage]].name}</span>
                    </td>
                    <td className="c-priority">
                      <Priority p={r.task.priority} />
                    </td>
                    <td className="c-bucket">{r.bucket.name}</td>
                    <td className="c-project">{r.project.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="dash-empty">
                {needle || bucket || stage || focus ? "No remaining tasks match these filters." : "No remaining tasks in this view."}
              </p>
            )}
          </div>
        </section>

        <section className="dash-notes" aria-labelledby="dash-notes-title">
          <h2 id="dash-notes-title">How these numbers work</h2>
          <ul>
            <li>
              <b>Complete</b> means Merged or Verified. <b>In progress</b> means In Progress, In QA or In Review.{" "}
              <b>Not started</b> means Backlog, Specced, Approved or Planned.
            </li>
            <li>A project’s figures are the sum of its initiatives. Closed projects appear under Closed and All.</li>
            {model.unfiled.tasks > 0 && (
              <li>
                {plural(model.unfiled.tasks, "task", "tasks")} ({fmt(model.unfiled.open)} still open){" "}
                {model.unfiled.tasks === 1 ? "is" : "are"} filed under an initiative that isn’t part of any project, so none
                of the figures above include {model.unfiled.tasks === 1 ? "it" : "them"}.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function DashboardHeader({
  scope,
  onScope,
  sub,
}: {
  scope: DashboardScope;
  onScope: (scope: DashboardScope) => void;
  sub: string;
}) {
  return (
    <div className="ph ph-compact">
      <div>
        <span className="kk">Dashboard</span>
        <h1>
          Project <em>tracker</em>
        </h1>
        <p className="sub">{sub}</p>
      </div>
      <div className="r">
        <div className="pv-seg" role="group" aria-label="Projects to include">
          {DASHBOARD_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={scope === s ? "on" : ""}
              aria-pressed={scope === s}
              onClick={() => onScope(s)}
            >
              {SCOPE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function groupByProject(buckets: BucketProgress[]): { project: ProjectProgress["project"]; buckets: BucketProgress[] }[] {
  const groups: { project: ProjectProgress["project"]; buckets: BucketProgress[] }[] = [];
  for (const b of buckets) {
    const last = groups[groups.length - 1];
    if (last && last.project.id === b.project.id) last.buckets.push(b);
    else groups.push({ project: b.project, buckets: [b] });
  }
  return groups;
}
