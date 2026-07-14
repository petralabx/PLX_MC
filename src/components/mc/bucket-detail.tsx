"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
// Type-only import — keeps node-only loader/source code out of the client bundle.
import type { BucketProjection } from "@/lib/loop-ledgers";
import {
  ACTORS,
  BUCKETS,
  CURRENT_USER,
  MILESTONES,
  PRDS,
  STAGES,
  STAGE_IDX,
  TRACE,
  type Milestone,
  type Risk,
  type Task,
  type Trace,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  addBucketComment,
  allRepos,
  allRisks,
  allTasks,
  allProjects,
  bucketById,
  commentsForBucket,
  deleteBucketComment,
  editBucketComment,
  mentionables,
  projectById,
  updateBucket,
} from "@/lib/mc-data/store";

import { Avatar, AvatarStack, HealthPill, PMark, ReqChip, SyncTick } from "./atoms";
import type { ScreenProps } from "./route";
import { Timeline } from "./timeline";

// A static fallback (first fixture initiative) so the detail view always
// resolves to a real bucket; live resolution goes through bucketById (EN-005).
const FALLBACK_BUCKET = BUCKETS[0];

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

  const parentProject = bucket.project ? projectById(bucket.project) : undefined;
  const rollups = rollupsForBucket(bucket.id, allTasks(), MILESTONES, allRisks());
  const prd = bucket.prd ? PRDS[bucket.prd] : null;

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
            Every bucket carries a PRD: problem, testable requirements, acceptance criteria,
            non-goals, and rollback. Drafting stays in the authoring lane.
          </p>
          <div className="acts">
            <button type="button" className="btn acc" title="coming soon">
              Draft PRD with Scribe
            </button>
            <button type="button" className="btn ghost" title="coming soon">
              Start blank
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <button type="button" className="back" onClick={() => nav("home")}>
            ← Back
          </button>
          <span className="kk bucket-kicker">Initiative · {bucket.id}</span>
          {parentProject ? (
            <button
              type="button"
              className="kk bucket-kicker"
              style={{ marginLeft: 8 }}
              onClick={() => nav("project", { projectId: parentProject.id, bucketId: bucket.id })}
            >
              Project · {parentProject.name}
            </button>
          ) : null}
          <h1>{bucket.name}</h1>
          <p className="sub">{bucket.desc}</p>
        </div>
        <div className="r">
          <HealthPill h={bucket.health} />
          <div className="vsw">
            <button type="button" onClick={() => nav("board", { bucketId: bucket.id })}>
              board
            </button>
            <button type="button" onClick={() => nav("list", { bucketId: bucket.id })}>
              list
            </button>
            <button type="button" onClick={() => nav("timeline", { bucketId: bucket.id })}>
              timeline
            </button>
          </div>
        </div>
      </div>

      <div className="bk">
        <div className="bkfacts">
          <div className="f">
            <span className="k">Health</span>
            <span className="v sm">
              <HealthPill h={bucket.health} />
            </span>
          </div>
          <div className="f">
            <span className="k">Accountable owner</span>
            <span className="v sm fact-owner">
              <Avatar id={bucket.owner} size="sm" />
              {ACTORS[bucket.owner].name}
            </span>
          </div>
          <div className="f">
            <span className="k">Target</span>
            <span className="v sm">{bucket.target}</span>
          </div>
          <div className="f">
            <span className="k">Started</span>
            <span className="v sm">{bucket.started}</span>
          </div>
          <div className="f">
            <span className="k">Project</span>
            <span className="v sm">
              <select
                value={bucket.project ?? ""}
                onChange={(event) => updateBucket(bucket.id, { project: event.target.value || null })}
              >
                <option value="">No project</option>
                {allProjects().map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="f">
            <span className="k">Tasks</span>
            <span className="v">{rollups.tasks.length}</span>
          </div>
        </div>

        <div className="bkbody">
          <div className="c">
            {prd && (
              <div className="blk">
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
              <div className="bh">
                <span className="kk">
                  / ToDos · SharePoint mirror · <b>{rollups.tasks.length}</b>
                </span>
                <button
                  type="button"
                  className="splink"
                  onClick={() => nav("board", { bucketId: bucket.id })}
                >
                  Open board →
                </button>
              </div>
              <div className="splist">
                <div className="splist-head">
                  <span className="src">
                    <span className="ic">▦</span>
                    ToDos (MS List) · {bucket.name}
                  </span>
                  <span className="ms-source">MS List</span>
                </div>
                <div className="splist-table">
                  <div className="sprow head">
                    <span>Task ID</span>
                    <span>Title</span>
                    <span>Status</span>
                    <span>Assigned To</span>
                    <span>Sync</span>
                  </div>
                  {rollups.tasks.map((task) => {
                    const assignees = [task.assignee, ...task.coassignees].filter(
                      (id): id is string => !!id
                    );
                    return (
                      <button
                        type="button"
                        className="sprow"
                        key={task.id}
                        onClick={() => nav("task", { taskId: task.id })}
                      >
                        <span className="id">{task.id}</span>
                        <span className="ti">{task.title}</span>
                        <span className="st">{STAGES[STAGE_IDX[task.stage]].name}</span>
                        <span className="asg">
                          {assignees.length > 0 ? (
                            <AvatarStack ids={assignees} lead={task.assignee ?? undefined} />
                          ) : (
                            <span className="none">—</span>
                          )}
                        </span>
                        <span className="sycell">
                          <SyncTick sync={task.sync} showTs={false} />
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="splist-foot">
                  <span>Mirrors two-way to ToDos columns</span>
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
                currentUser={CURRENT_USER}
                onAdd={(body) => addBucketComment(bucket.id, body)}
                onEdit={(commentId, body) => editBucketComment(bucket.id, commentId, body)}
                onDelete={(commentId) => deleteBucketComment(bucket.id, commentId)}
              />
            </div>
          </div>

          <div className="c">
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
                <button type="button" className="dl" title="coming soon">
                  <span className="ic">▦</span>
                  <span className="t">Project Plan</span>
                  <span className="ms">MS List</span>
                  <span className="ext">↗</span>
                </button>
                <button type="button" className="dl" title="coming soon">
                  <span className="ic">▷</span>
                  <span className="t">Roadmap</span>
                  <span className="ms">MS List</span>
                  <span className="ext">↗</span>
                </button>
                <button type="button" className="dl" title="coming soon">
                  <span className="ic">◆</span>
                  <span className="t">Milestone Register</span>
                  <span className="ms">MS List</span>
                  <span className="ext">↗</span>
                </button>
                <button type="button" className="dl" title="coming soon">
                  <span className="ic">△</span>
                  <span className="t">Risk Register</span>
                  <span className="ms">MS List</span>
                  <span className="ext">↗</span>
                </button>
                <button type="button" className="dl" onClick={() => nav("files")}>
                  <span className="ic">❒</span>
                  <span className="t">Project Documents</span>
                  <span className="ms">Library</span>
                  <span className="ext">↗</span>
                </button>
                {bucket.repos.map((repoId) => (
                  <button type="button" className="dl" key={repoId} onClick={() => nav("repos")}>
                    <span className="ic">{"</>"}</span>
                    <span className="t">{allRepos()[repoId]?.name ?? repoId}</span>
                    <span className="ms">GitHub</span>
                    <span className="ext">↗</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="blk">
              <div className="bh">
                <span className="kk">/ Milestones</span>
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
                    <span className="okflag">{traceSummary.satisfied} satisfied</span>
                    <span className="pill info">
                      <span className="dot" />
                      {traceSummary.inFlight} in flight
                    </span>
                    {traceSummary.gaps > 0 && <span className="gapflag">{traceSummary.gaps} gap</span>}
                  </div>
                  {traceFromLedger && <span className="kk">Quality Ledger · read-only</span>}
                </>
              ) : (
                <p className="trace-empty">No traceability rows are mapped for this initiative yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
