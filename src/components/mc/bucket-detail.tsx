import {
  ACTORS,
  BUCKETS,
  BUCKET_IDX,
  MILESTONES,
  PRDS,
  REPOS,
  STAGES,
  STAGE_IDX,
  TRACE,
  type Milestone,
  type Risk,
  type Task,
  type Trace,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allRisks, allTasks } from "@/lib/mc-data/store";

import { Avatar, AvatarStack, HealthPill, PMark, ReqChip, SyncTick } from "./atoms";
import type { ScreenProps } from "./route";

const FALLBACK_BUCKET_ID = BUCKETS[0].id;

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

export function BucketDetail({ route, nav }: ScreenProps) {
  useMcVersion();

  const bucket = BUCKET_IDX[route.bucketId ?? FALLBACK_BUCKET_ID] ?? BUCKET_IDX[FALLBACK_BUCKET_ID];
  const rollups = rollupsForBucket(bucket.id, allTasks(), MILESTONES, allRisks());
  const prd = bucket.prd ? PRDS[bucket.prd] : null;
  const trace = TRACE.bucket === bucket.id ? TRACE : null;
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
                    <span className="t">{REPOS[repoId].name}</span>
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
                {rollups.milestones.length > 0 ? (
                  rollups.milestones.map((milestone) => (
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
                <div className="trace-summary">
                  <span className="okflag">{traceSummary.satisfied} satisfied</span>
                  <span className="pill info">
                    <span className="dot" />
                    {traceSummary.inFlight} in flight
                  </span>
                  {traceSummary.gaps > 0 && <span className="gapflag">{traceSummary.gaps} gap</span>}
                </div>
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
