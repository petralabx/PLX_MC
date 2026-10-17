"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  CornerLeftUp,
  FileText,
  Flag,
  Folder,
  GitBranch,
  ListChecks,
  Map as MapIcon,
  Pencil,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { api } from "@/lib/api";
// Type-only import — keeps node-only loader/source code out of the client bundle.
import type { BucketProjection } from "@/lib/loop-ledgers";
import {
  ACTORS,
  BUCKETS,
  MILESTONES,
  PRDS,
  TRACE,
  type Milestone,
  type Risk,
  type Task,
  type Trace,
} from "@/lib/mc-data";
import {
  SHAREPOINT_REGISTERS,
  docLinkFromPrd,
  normalizeBucketPrd,
  type SharePointRegisterKey,
} from "@/lib/mc-data/doc-links";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  addBucketComment,
  allRepos,
  allRisks,
  allTasks,
  bucketById,
  commentsForBucket,
  deleteBucketComment,
  editBucketComment,
  mentionables,
  pickerProjects,
  projectById,
  pushNotice,
  updateBucket,
  viewerId,
} from "@/lib/mc-data/store";

import { Avatar, HealthPill, PMark, ReqChip, SyncTick } from "./atoms";
import { OverviewStrip, StripFact, StripHealthSelect } from "./overview-strip";
import { PeoplePicker } from "./people-picker";
import {
  filterCounts,
  filterTasks,
  isOutstanding,
  parseMcDate,
  projectProgress,
  shortDate,
  type TaskFilterKey,
} from "./project-overview.helpers";
import type { ScreenProps } from "./route";
import { TaskFilter } from "./task-filter";
import { TaskTable } from "./task-table";
import { Timeline } from "./timeline";

// A static fallback (first fixture initiative) so the detail view always
// resolves to a real bucket; live resolution goes through bucketById (EN-005).
const FALLBACK_BUCKET = BUCKETS[0];

const REGISTER_ICON: Record<SharePointRegisterKey, LucideIcon> = {
  plan: ListChecks,
  roadmap: MapIcon,
  milestones: Flag,
  risks: TriangleAlert,
  documents: Folder,
};

interface BucketRollups {
  tasks: Task[];
  milestones: Milestone[];
  risks: Risk[];
}

interface TraceSummary {
  satisfied: number;
  gaps: number;
  inFlight: number;
}

export function rollupsForBucket(
  bucketId: string,
  tasks: Task[],
  milestones: Milestone[],
  risks: Risk[]
): BucketRollups {
  return {
    tasks: tasks.filter((t) => t.bucket === bucketId),
    milestones: milestones.filter((m) => m.bucket === bucketId),
    risks: risks.filter((r) => r.bucket === bucketId),
  };
}

export function summarizeTrace(trace: Trace | null): TraceSummary {
  if (!trace) return { satisfied: 0, gaps: 0, inFlight: 0 };
  const satisfied = trace.rows.filter((r) => r.status === "satisfied").length;
  const gaps = trace.rows.filter((r) => r.status === "gap").length;
  return { satisfied, gaps, inFlight: trace.rows.length - satisfied - gaps };
}

/**
 * Merge fixture rollup milestones with ledger-projected milestones. Fixture
 * rows render first; ledger rows (col=0, list-only) follow. No dedupe — the
 * id namespaces differ (fixture M-*, ledger LM-*).
 */
export function mergeMilestones(fixture: Milestone[], ledger: Milestone[]): Milestone[] {
  return [...fixture, ...ledger];
}

/**
 * The spec the header kicker links to: a URL spec (docLinkFromPrd), a built-in
 * PRD id (rendered in the body's PRD block), or nothing yet.
 */
export type BucketSpec =
  | { kind: "url"; href: string; label: string }
  | { kind: "prd"; id: string }
  | { kind: "none" };

export function specForBucket(prd: string | null): BucketSpec {
  if (prd && PRDS[prd]) return { kind: "prd", id: prd };
  const link = docLinkFromPrd(prd);
  return link ? { kind: "url", ...link } : { kind: "none" };
}

export interface DocRow {
  key: string;
  icon: LucideIcon;
  label: string;
  source: "MS List" | "Library" | "GitHub";
  target: "files" | "repos" | null; // null = SharePoint list not wired yet
}

/** The five SharePoint registers, then one GitHub row per bucket repo. */
export function docRowsForBucket(repos: string[], repoName: (id: string) => string): DocRow[] {
  return [
    ...SHAREPOINT_REGISTERS.map((register): DocRow => ({
      key: register.key,
      icon: REGISTER_ICON[register.key],
      label: register.label,
      source: register.source,
      target: register.key === "documents" ? "files" : null,
    })),
    ...repos.map((id): DocRow => ({
      key: `repo:${id}`,
      icon: GitBranch,
      label: repoName(id),
      source: "GitHub",
      target: "repos",
    })),
  ];
}

// Same wording as the project page's initiative sections.
function taskEmptyText(filter: TaskFilterKey, total: number): string {
  if (total === 0) return "No tasks in this initiative yet.";
  if (filter === "human") return "Nothing waiting on a human.";
  return `Nothing outstanding · all ${total} tasks closed.`;
}

export function PrdLinkField({ bucketId, prd }: { bucketId: string; prd: string | null }) {
  const [draft, setDraft] = useState(prd ?? "");
  const [message, setMessage] = useState<string | null>(null);

  function save(raw: string) {
    const normalized = normalizeBucketPrd(raw);
    if (!normalized.ok || normalized.value === undefined) {
      setMessage("Paste an http or https URL.");
      return;
    }
    if ((normalized.value ?? null) === (prd ?? null)) {
      setMessage(null);
      return;
    }
    updateBucket(bucketId, { prd: normalized.value });
    setMessage(null);
  }

  return (
    <div className="f">
      <span className="k">PRD link</span>
      <span className="v sm">
        <input
          className="le-input"
          type="url"
          value={draft}
          placeholder="https://"
          aria-label="PRD link"
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage(null);
          }}
          onBlur={(event) => save(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        {message ? <span className="kk">{message}</span> : null}
      </span>
    </div>
  );
}

export function BucketDetail({ route, nav }: ScreenProps) {
  useMcVersion();

  const bucket = bucketById(route.bucketId ?? FALLBACK_BUCKET.id) ?? FALLBACK_BUCKET;

  // Ledger projection for bound buckets (read-only; null until fetched).
  // The result is keyed by bucket id so a stale response never renders under
  // another bucket. Unbound buckets get { bound: false } and render exactly as
  // before; a failed fetch leaves null — same rendering, never a crash.
  const [projectionState, setProjectionState] = useState<{
    bucketId: string;
    data: BucketProjection;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<BucketProjection>(`/loop-ledgers/bucket/${encodeURIComponent(bucket.id)}`)
      .then((data) => {
        if (!cancelled) setProjectionState({ bucketId: bucket.id, data });
      })
      .catch(() => {
        /* projection unavailable — render without ledger rows */
      });
    return () => {
      cancelled = true;
    };
  }, [bucket.id]);
  const projection = projectionState?.bucketId === bucket.id ? projectionState.data : null;

  // The PrdLinkField editor stays open only for the prd value it was opened
  // on — a save changes bucket.prd, so the editor closes by itself.
  const specKey = `${bucket.id}:${bucket.prd ?? ""}`;
  const [specEditFor, setSpecEditFor] = useState<string | null>(null);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilterKey>("open");
  const editingSpec = specEditFor === specKey;

  const parentProject = bucket.project ? projectById(bucket.project) : undefined;
  const rollups = rollupsForBucket(bucket.id, allTasks(), MILESTONES, allRisks());
  const prd = bucket.prd ? PRDS[bucket.prd] : null;
  // A prd that isn't a built-in PRD id may be a URL to a spec elsewhere
  // (e.g. a tracked repo's docs); the header kicker links it.
  const spec = specForBucket(bucket.prd);
  const progress = projectProgress(rollups.tasks);
  const blocked = rollups.tasks.filter((t) => t.blocked && isOutstanding(t)).length;
  const started = parseMcDate(bucket.started, new Date().getFullYear());
  const commitTarget = (raw: string) => {
    const target = raw.trim() || "—";
    if (target !== bucket.target) updateBucket(bucket.id, { target });
  };
  const docRows = docRowsForBucket(bucket.repos, (id) => allRepos()[id]?.name ?? id);

  const ledgerMilestones = projection?.bound ? projection.milestones : [];
  const ledgerTrace = projection?.bound ? projection.trace : null;
  const degradedSources = projection?.bound
    ? projection.sources.filter((s) => s.degraded)
    : [];
  const milestones = mergeMilestones(rollups.milestones, ledgerMilestones);

  // Fixture TRACE still wins for buckets that have it; the ledger projection
  // fills in for bound buckets without a fixture matrix.
  const fixtureTrace = TRACE.bucket === bucket.id ? TRACE : null;
  const trace = fixtureTrace ?? ledgerTrace;
  const traceFromLedger = !fixtureTrace && ledgerTrace !== null;
  const traceSummary = summarizeTrace(trace);
  const reqStatus = new Map(trace?.rows.map((row) => [row.req, row.status]) ?? []);

  if (bucket.empty) {
    return (
      <div className="mc-main">
        <div className="ph">
          <div>
            <button type="button" className="back" onClick={() => nav("home")}>
              ← Back
            </button>
            <span className="kk bucket-kicker">Initiative · {bucket.id}</span>
            <h1>{bucket.name}</h1>
            <p className="sub">{bucket.desc}</p>
          </div>
          <div className="r">
            <HealthPill h={bucket.health} />
          </div>
        </div>
        <div className="empty">
          <span className="glyph">
            <PMark />
          </span>
          <h3>
            This initiative needs a <em className="empty-accent">PRD</em>
          </h3>
          <p>
            Paste an https URL for the PRD. The high-risk gate accepts that link.
          </p>
          <PrdLinkField key={`${bucket.id}:${bucket.prd ?? ""}`} bucketId={bucket.id} prd={bucket.prd} />
        </div>
      </div>
    );
  }

  return (
    <div className="mc-main ini-page">
      <div className="ph">
        <div className="ini-ph-main">
          <button type="button" className="back" onClick={() => nav("home")}>
            ← Back
          </button>
          {/* Kicker line: id · parent project · the initiative's spec. The spec
              lives here now — the standalone "/ Spec" block is gone. */}
          <div className="kk ini-kicker" data-testid="bucket-kicker">
            <span>Initiative · {bucket.id}</span>
            {parentProject ? (
              <button
                type="button"
                className="ini-klink"
                onClick={() => nav("project", { projectId: parentProject.id, bucketId: bucket.id })}
              >
                <CornerLeftUp size={11} aria-hidden="true" />
                Project · {parentProject.name}
              </button>
            ) : null}
            {spec.kind === "url" ? (
              <a
                className="ini-klink ini-spec"
                href={spec.href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Spec · ${spec.label}`}
                data-testid="bucket-spec-link"
              >
                <FileText size={11} aria-hidden="true" />
                {spec.label}
                <ArrowUpRight size={10} aria-hidden="true" />
              </a>
            ) : spec.kind === "prd" ? (
              <a className="ini-klink ini-spec" href="#bucket-prd" data-testid="bucket-spec-link">
                <FileText size={11} aria-hidden="true" />
                {spec.id}
              </a>
            ) : null}
            <button
              type="button"
              className="ini-klink ini-spec-edit"
              aria-expanded={editingSpec}
              aria-label={spec.kind === "none" ? "Add spec link" : "Edit spec link"}
              onClick={() => setSpecEditFor(editingSpec ? null : specKey)}
            >
              {spec.kind === "none" ? "+ Add spec" : <Pencil size={10} aria-hidden="true" />}
            </button>
          </div>
          <h1>{bucket.name}</h1>
          <p className="sub">{bucket.desc}</p>
          {editingSpec && (
            <div className="ini-spec-field">
              <PrdLinkField key={specKey} bucketId={bucket.id} prd={bucket.prd} />
            </div>
          )}
        </div>
        <div className="r">
          <HealthPill h={bucket.health} />
          <SyncTick sync={bucket.sync} />
          <nav className="vsw" aria-label="Views">
            <button type="button" onClick={() => nav("board", { bucketId: bucket.id })}>
              Board
            </button>
            <button type="button" onClick={() => nav("list", { bucketId: bucket.id })}>
              List
            </button>
            <button type="button" onClick={() => nav("timeline", { bucketId: bucket.id })}>
              Timeline
            </button>
          </nav>
        </div>
      </div>

      <div className="bk">
        <OverviewStrip
          factColumns={3}
          progress={progress}
          started={bucket.started}
          target={bucket.target}
          subline={
            <>
              {progress.total} tasks · {progress.done} done · {progress.cancelled} cancelled · {progress.doing} in
              flight · <span className={blocked > 0 ? "warn" : ""}>{blocked} blocked</span>
            </>
          }
        >
          {/* All edits route through updateBucket (store) → PATCH: optimistic
              apply, reconcile on success, rollback + notice on failure. */}
          <StripFact label="Health">
            <StripHealthSelect
              value={bucket.health}
              label="Set initiative health"
              onChange={(health) => updateBucket(bucket.id, { health })}
            />
          </StripFact>
          {/* Accountable owner — always human; the project page's field-button
              + PeoplePicker pattern. */}
          <StripFact label="Accountable owner">
            <span className="pv-owner">
              <button type="button" className="ntm-field-btn" onClick={() => setOwnerPickerOpen((open) => !open)}>
                <span className="who fact-owner">
                  <Avatar id={bucket.owner} size="sm" />
                  <span className="nm">{ACTORS[bucket.owner]?.name ?? bucket.owner}</span>
                </span>
                <ChevronDown size={11} className="caret" aria-hidden="true" />
              </button>
              {ownerPickerOpen && (
                <PeoplePicker
                  allowAgents={false}
                  current={bucket.owner}
                  onPick={(actorId) => {
                    if (actorId) {
                      updateBucket(bucket.id, { owner: actorId });
                      return;
                    }
                    pushNotice("Initiatives require a human accountable owner.");
                  }}
                  onClose={() => setOwnerPickerOpen(false)}
                  style={{ top: "calc(100% + 6px)", left: 0 }}
                />
              )}
            </span>
          </StripFact>
          <StripFact label="Project">
            <label className="ini-project-select">
              <select
                value={bucket.project ?? ""}
                aria-label="Change project"
                onChange={(event) => updateBucket(bucket.id, { project: event.target.value || null })}
              >
                <option value="">No project</option>
                {pickerProjects(bucket.project).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={11} className="caret" aria-hidden="true" />
            </label>
          </StripFact>
          <StripFact label="Started">{started ? shortDate(started) : bucket.started}</StripFact>
          {/* Target — commit on blur/Enter; keyed on the store value so a
              rollback re-renders the restored target. */}
          <StripFact label="Target">
            <span className="pv-target">
              <input
                key={`${bucket.id}:${bucket.target}`}
                className="le-input"
                defaultValue={bucket.target}
                onBlur={(event) => commitTarget(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
                placeholder="e.g. Aug 01"
                aria-label="Set target"
              />
              <Pencil size={11} aria-hidden="true" />
            </span>
          </StripFact>
        </OverviewStrip>

        {/* Two columns at ≥1100px of main-content width (@container main in
            mc-initiative.css), stacked below. */}
        <div className="ini-body">
          <div className="ini-main">
            {prd && (
              <div className="blk" id="bucket-prd">
                <div className="bh">
                  <span className="kk">
                    / PRD · <b>{prd.id}</b>
                  </span>
                  <span className="kk">
                    drafted by {ACTORS[prd.drafted].name} · approved by {ACTORS[prd.approvedBy].name}
                  </span>
                </div>
                <div className="prd">
                  <div className="ph2">
                    <span className="t">{prd.title}</span>
                    <span className="pill acc">
                      <span className="dot" />
                      {prd.status}
                    </span>
                  </div>
                  <div className="sec">
                    <div className="k">Problem</div>
                    <div className="txt">{prd.problem}</div>
                  </div>
                  <div className="sec">
                    <div className="k">Requirements</div>
                    {prd.reqs.map((req) => (
                      <div className="req" key={req.id}>
                        <span className="req-link">
                          <ReqChip id={req.id} gap={reqStatus.get(req.id) === "gap"} />
                        </span>
                        <div>
                          <div className="rt">{req.text}</div>
                          <div className="crit">Acceptance · {req.crit}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="sec">
                    <div className="k">Non-goals</div>
                    <ul className="nongoals">
                      {prd.nonGoals.map((goal) => (
                        <li key={goal}>{goal}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="sec">
                    <div className="k">Rollback plan</div>
                    <div className="txt">{prd.rollback}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="blk">
              <div className="bh pv-ovh">
                <span className="kk">
                  / Tasks · <b>{rollups.tasks.length}</b> · SharePoint mirror
                </span>
                <TaskFilter value={filter} counts={filterCounts(rollups.tasks)} onChange={setFilter} />
                <button
                  type="button"
                  className="splink ini-open-board"
                  onClick={() => nav("board", { bucketId: bucket.id })}
                >
                  Open board →
                </button>
              </div>
              <div className="ini-tasks">
                <TaskTable
                  key={filter}
                  tasks={filterTasks(rollups.tasks, filter)}
                  closed={filter === "open" ? rollups.tasks.filter((t) => !isOutstanding(t)) : undefined}
                  emptyText={taskEmptyText(filter, rollups.tasks.length)}
                  nav={nav}
                />
                <div className="ini-mirror">
                  <span>Mirrors two-way to the ToDos list columns</span>
                  <span>Last sync {bucket.sync.ts}</span>
                </div>
              </div>
            </div>

            <div className="blk">
              <div className="bh">
                <span className="kk">/ Discussion</span>
                <span className="kk">app-only thread</span>
              </div>
              <Timeline
                comments={commentsForBucket(bucket.id)}
                people={mentionables()}
                currentUser={viewerId()}
                onAdd={(body) => addBucketComment(bucket.id, body)}
                onEdit={(commentId, body) => editBucketComment(bucket.id, commentId, body)}
                onDelete={(commentId) => deleteBucketComment(bucket.id, commentId)}
              />
            </div>
          </div>

          <aside className="ini-aside">
            <div className="blk">
              <div className="bh">
                <span className="kk">/ Documents &amp; Links</span>
                <span className="kk">
                  <span className="sync">
                    <span className="d" />
                    SharePoint
                  </span>
                </span>
              </div>
              <div className="doclinks">
                {docRows.map((row) => {
                  const Icon = row.icon;
                  const target = row.target;
                  return (
                    <button
                      type="button"
                      className="dl"
                      key={row.key}
                      title={target ? row.label : "coming soon"}
                      onClick={target ? () => nav(target) : undefined}
                    >
                      <span className="ic">
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span className="t">{row.label}</span>
                      <span className="ms">{row.source}</span>
                      <span className="ext">
                        <ArrowUpRight size={12} aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="blk">
              <div className="bh">
                <span className="kk">
                  / Milestones · <b>{milestones.length}</b>
                </span>
              </div>
              <div className="mlist">
                {milestones.length > 0 ? (
                  milestones.map((milestone) => (
                    <div className="risk milestone" key={milestone.id}>
                      <div>
                        <div className="t">{milestone.name}</div>
                        <div className="mit">{milestone.sp}</div>
                      </div>
                      <span
                        className={`pill ${
                          milestone.state === "now"
                            ? "acc"
                            : milestone.state === "risk"
                              ? "warn"
                              : "muted"
                        }`}
                      >
                        <span className="dot" />
                        {milestone.state === "now"
                          ? "Active"
                          : milestone.state === "risk"
                            ? "At risk"
                            : "Upcoming"}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="colempty">No milestones</div>
                )}
                {degradedSources.map((s) => (
                  <div className="colempty" key={`${s.repo}/${s.module}`}>
                    ledger unavailable: {s.degraded}
                  </div>
                ))}
              </div>
            </div>

            <div className="blk">
              <div className="bh">
                <span className="kk">
                  / Risks · <b>{rollups.risks.length}</b>
                </span>
                <span className="kk">→ Risk Register</span>
              </div>
              <div className="risks">
                {rollups.risks.length > 0 ? (
                  rollups.risks.map((risk) => (
                    <div className="risk" key={risk.id}>
                      <div>
                        <div className="t">{risk.title}</div>
                        <div className="mit">{risk.mit}</div>
                        <div className="li">
                          <span className="x">Likelihood {risk.like}</span>
                          <span className="x">Impact {risk.impact}</span>
                          <span className="x owner-pill">
                            <Avatar id={risk.owner} size="sm" />
                            {ACTORS[risk.owner].name.split(" ")[0]}
                          </span>
                        </div>
                      </div>
                      <SyncTick sync={risk.sync} showTs={false} />
                    </div>
                  ))
                ) : (
                  <div className="colempty">No open risks</div>
                )}
              </div>
            </div>

            <div className="blk overview-trace-block">
              <div className="bh">
                <span className="kk">/ Traceability</span>
                <button type="button" className="splink" onClick={() => nav("matrix")}>
                  Full matrix →
                </button>
              </div>
              {trace ? (
                <>
                  <div className="trace-summary">
                    <span className="pill ok">
                      <span className="dot" />
                      {traceSummary.satisfied} satisfied
                    </span>
                    <span className="pill info">
                      <span className="dot" />
                      {traceSummary.inFlight} in flight
                    </span>
                    <span className={`pill ${traceSummary.gaps > 0 ? "warn" : "muted"}`}>
                      <span className="dot" />
                      {traceSummary.gaps} gap
                    </span>
                  </div>
                  {traceFromLedger && <span className="kk">Quality Ledger · read-only</span>}
                </>
              ) : (
                <p className="trace-empty">No traceability rows are mapped for this initiative yet.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
