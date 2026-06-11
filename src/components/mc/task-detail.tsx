"use client";

import { useState } from "react";

import {
  ACTORS,
  BUCKET_IDX,
  PRIORITY,
  STAGES,
  STAGE_IDX,
  confidenceOf,
  type SpColumn,
  type SyncDirection,
  type Task,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  applyInbound,
  markAllSynced,
  openConflicts,
  reassignTask,
  resolveConflict,
  spLists,
  taskById,
} from "@/lib/mc-data/store";

import {
  Assignee,
  Avatar,
  Estimate,
  Label,
  Priority,
  RepoChip,
  ReqChip,
  Slate,
  SyncTick,
} from "./atoms";
import { NotifyTrail, PeoplePicker } from "./people-picker";
import type { ScreenProps } from "./route";

export const SOR_FIELD_NAMES = ["Status", "Assigned To", "Due Date", "Priority"] as const;
type SorFieldName = (typeof SOR_FIELD_NAMES)[number];

const SUBMITTED_STAGES = new Set(["review", "merged", "verified"]);

export interface EvidenceProgress {
  done: number;
  total: number;
  reason: string;
  ready: boolean;
}

export function syncDirectionGlyph(direction: SyncDirection): "↔" | "→" | "←" {
  if (direction === "push") return "→";
  if (direction === "pull") return "←";
  return "↔";
}

export function sorDirectionForField(
  fieldName: SorFieldName,
  columns: Array<Pick<SpColumn, "name" | "dir">>
): "↔" | "→" | "←" {
  const mapped = columns.find((column) => column.name === fieldName);
  return syncDirectionGlyph(mapped?.dir ?? "two-way");
}

export function deriveEvidenceProgress(task: Task): EvidenceProgress {
  const items = task.evidence?.items ?? [];
  const done = items.filter((item) => item.done).length;
  const total = items.length;
  if (!total) {
    return { done: 0, total: 0, ready: true, reason: "No evidence checklist attached." };
  }
  if (SUBMITTED_STAGES.has(task.stage)) {
    return {
      done,
      total,
      ready: true,
      reason: `Submitted — ${confidenceOf(task).label}.`,
    };
  }
  if (done === total) {
    return { done, total, ready: true, reason: "All evidence complete. Ready to submit." };
  }
  const remaining = total - done;
  return {
    done,
    total,
    ready: false,
    reason: `${remaining} item${remaining === 1 ? "" : "s"} remaining · gate closed`,
  };
}

function fieldValue(fieldName: SorFieldName, task: Task): string {
  if (fieldName === "Status") {
    return STAGES[STAGE_IDX[task.stage]]?.name ?? task.stage;
  }
  if (fieldName === "Assigned To") {
    return task.assignee ? (ACTORS[task.assignee]?.name ?? task.assignee) : "Unassigned";
  }
  if (fieldName === "Due Date") return task.due;
  return PRIORITY[task.priority]?.label ?? task.priority;
}

export function TaskDetailView({ route, nav }: ScreenProps) {
  useMcVersion();
  const taskId = route.taskId ?? "TASK-214";
  const task = taskById(taskId);
  const [resolved, setResolved] = useState<{ taskId: string; winner: "mc" | "sp" } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reassigned, setReassigned] = useState<{ taskId: string; actorId: string } | null>(null);

  if (!task) {
    return (
      <div className="mc-main">
        <div className="empty">
          <div className="glyph">?</div>
          <h3>Task not found</h3>
          <p>
            {taskId} is not in this workspace snapshot. Use the board to pick another task, or
            open the default task detail view.
          </p>
          <div className="acts">
            <button type="button" className="btn ghost" onClick={() => nav("board")}>
              Go to board
            </button>
            <button type="button" className="btn" onClick={() => nav("task", { taskId: "TASK-214" })}>
              Open TASK-214
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bucket = BUCKET_IDX[task.bucket];
  const stageIdx = STAGE_IDX[task.stage] ?? 0;
  const todos = spLists().find((list) => list.key === "todos");
  const sharePointItem = task.sync.sp.split("· ")[1] ?? task.sync.sp;
  const progress = deriveEvidenceProgress(task);
  const conflict = openConflicts().find((entry) => entry.entityId === task.id);

  const syncNow = () => {
    markAllSynced();
    applyInbound();
  };

  const resolveTaskConflict = (winner: "mc" | "sp") => {
    if (!conflict) return;
    resolveConflict(conflict.id, winner);
    setResolved({ taskId: task.id, winner });
  };

  const resolvedWinner = resolved?.taskId === task.id ? resolved.winner : null;

  return (
    <div className="mc-main">
      <div className="task-top">
        <button type="button" className="back" onClick={() => nav("board")}>
          ← Back
        </button>
      </div>
      <div className="td">
        <div className="main">
          <div className="thead blk">
            <div className="kk">
              <span>{task.id}</span>
              <span>·</span>
              <span>{bucket?.name ?? task.bucket}</span>
              <span>·</span>
              <SyncTick sync={task.sync} showTs={false} />
            </div>
            <h1>{task.title}</h1>
            <div className="meta">
              <Priority p={task.priority} />
              {task.reqs.map((req) => (
                <ReqChip key={req} id={req} />
              ))}
              {task.repos.map((repo) => (
                <RepoChip key={repo} id={repo} />
              ))}
              {task.labels.map((label) => (
                <Label key={label} text={label} />
              ))}
              <Estimate v={task.estimate} />
              <span className="asgwrap">
                <Assignee
                  id={task.assignee}
                  onClick={() => setPickerOpen((open) => !open)}
                />
                {pickerOpen && (
                  <PeoplePicker
                    current={task.assignee}
                    onPick={(actorId) => {
                      reassignTask(task.id, actorId);
                      setReassigned(actorId ? { taskId: task.id, actorId } : null);
                    }}
                    onClose={() => setPickerOpen(false)}
                    style={{ top: "calc(100% + 6px)", left: 0 }}
                  />
                )}
              </span>
            </div>
            {reassigned?.taskId === task.id && <NotifyTrail id={reassigned.actorId} />}
          </div>

          {task.description && (
            <div className="blk">
              <div className="bh">
                <span className="kk">/ Description</span>
              </div>
              <div className="prose">{task.description}</div>
            </div>
          )}

          {task.evidence && (
            <div className="blk">
              <div className="bh">
                <span className="kk">
                  / Evidence bundle · <b>{progress.done}</b>/{progress.total}
                </span>
              </div>
              <div className="ev">
                <div className="evlist">
                  {task.evidence.items.map((item) => (
                    <div className={`evitem${item.done ? " done" : ""}`} key={item.key}>
                      <span className="box">{item.done ? "✓" : ""}</span>
                      <span className="lab">{item.label}</span>
                      <span className="st">{item.done ? "Done" : "Open"}</span>
                    </div>
                  ))}
                </div>
                <div className="evfoot">
                  <span className={`reason${progress.ready ? " ok" : ""}`}>{progress.reason}</span>
                </div>
              </div>
              <div className="evpanels">
                <div className="evp">
                  <div className="eph">
                    <span className="k">Summary — what the agent did</span>
                  </div>
                  <div className="epb">
                    <div className="txt">{task.evidence.summary}</div>
                  </div>
                </div>
                <div className="evp">
                  <div className="eph">
                    <span className="k">Before / after</span>
                    <span className="k">
                      {task.evidence.shots?.length ? "captured during work" : "not captured"}
                    </span>
                  </div>
                  <div className="epb">
                    {task.evidence.shots?.length ? (
                      <div className="shots">
                        {task.evidence.shots.map((shot, index) => (
                          <Slate key={`${shot.label}-${index}`} label={shot.label} cap={shot.cap} />
                        ))}
                      </div>
                    ) : (
                      <div className="txt muted">No screenshots captured yet.</div>
                    )}
                  </div>
                </div>
                <div className="evp">
                  <div className="eph">
                    <span className="k">E2E QA · {task.evidence.qa?.suite ?? "Not run"}</span>
                    <span className="k">{task.evidence.qa?.ran ?? "No run timestamp"}</span>
                  </div>
                  <div className="epb qa">
                    {task.evidence.qa ? (
                      <>
                        <div className="qhd">
                          <span className="pass">{task.evidence.qa.pass} passed</span>
                          {task.evidence.qa.fail > 0 && (
                            <span className="fail">{task.evidence.qa.fail} failed</span>
                          )}
                          <span className="meta">
                            {task.evidence.qa.pass}/{task.evidence.qa.total} total
                          </span>
                        </div>
                        {task.evidence.qa.tests.map((test, index) => (
                          <div className={`qrow ${test.status}`} key={`${test.name}-${index}`}>
                            <span className="d" />
                            <span>{test.name}</span>
                            <span className="res">{test.status}</span>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="txt muted">QA results are not attached yet.</div>
                    )}
                  </div>
                </div>
                <div className="evp">
                  <div className="eph">
                    <span className="k">PR links</span>
                    <span className="k">{task.prs.length} total</span>
                  </div>
                  <div className="epb">
                    {task.prs.length ? (
                      <div className="prs">
                        {task.prs.map((pr) => (
                          <div className="pr" key={`${pr.repo}-${pr.num}`}>
                            <span className="pid">#{pr.num}</span>
                            <div>
                              <div className="t">{pr.title}</div>
                              <div className="sub">{pr.repo}</div>
                            </div>
                            <span className="pill muted">
                              <span className="dot" />
                              {pr.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="txt muted">No PR links attached yet.</div>
                    )}
                  </div>
                </div>
                <div className="evp">
                  <div className="eph">
                    <span className="k">Rollback plan</span>
                  </div>
                  <div className="epb">
                    <div className="txt">{task.evidence.rollback ?? "Not yet written."}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {task.subtasks.length > 0 && (
            <div className="blk">
              <div className="bh">
                <span className="kk">
                  / Subtasks · <b>{task.subtasks.filter((subtask) => subtask.done).length}</b>/
                  {task.subtasks.length}
                </span>
              </div>
              <div className="subs">
                {task.subtasks.map((subtask) => (
                  <div className={`sub${subtask.done ? " done" : ""}`} key={subtask.id}>
                    <span className="box">{subtask.done ? "✓" : ""}</span>
                    <span className="id">{subtask.id}</span>
                    <span className="t">{subtask.t}</span>
                    <span className="who">
                      <Avatar id={subtask.who} size="sm" />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="blk">
            <div className="bh">
              <span className="kk">/ Activity</span>
            </div>
            <div className="log">
              {task.activity.length ? (
                task.activity.map((entry, index) => {
                  const actor = ACTORS[entry.who];
                  return (
                    <div className="logrow" key={`${entry.what}-${index}`}>
                      <span>
                        {actor ? <Avatar id={entry.who} size="sm" /> : <span className="fallback" />}
                      </span>
                      <span className="body">
                        <b>{actor?.name ?? entry.who}</b> {entry.what}
                      </span>
                      <span className="age">{entry.age}</span>
                    </div>
                  );
                })
              ) : (
                <div className="logempty">No activity yet.</div>
              )}
            </div>
          </div>
        </div>

        <div className="rail">
          <div className="blk">
            <div className="bh">
              <span className="kk">/ Lifecycle</span>
              <span className="kk">
                <b>{STAGES[stageIdx].n}</b> / 09
              </span>
            </div>
            <div className="vstep">
              {STAGES.map((stage, index) => {
                const cls =
                  task.stage === "verified"
                    ? index <= stageIdx
                      ? "done"
                      : ""
                    : index < stageIdx
                      ? "done"
                      : index === stageIdx
                        ? "now"
                        : "";
                return (
                  <div className={`s ${cls}`} key={stage.key}>
                    <div className="gut">
                      <span className="mk" />
                      <span className="line" />
                    </div>
                    <div className="lab">
                      <div className="n">{stage.n}</div>
                      <div className="nm">
                        {stage.name}
                        {stage.gate && <span className="gate">{stage.gate}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="blk">
            <div className="bh">
              <span className="kk">/ Facts</span>
            </div>
            <div className="rfacts">
              <div className="rfact">
                <span className="k">Due</span>
                <span className="v">{task.due}</span>
              </div>
              <div className="rfact">
                <span className="k">Estimate</span>
                <span className="v">
                  <Estimate v={task.estimate} />
                </span>
              </div>
              <div className="rfact">
                <span className="k">Reporter</span>
                <span className="v">{ACTORS[task.reporter]?.name ?? task.reporter}</span>
              </div>
              <div className="rfact">
                <span className="k">Repos</span>
                <span className="v">
                  {task.repos.length ? task.repos.map((repo) => <RepoChip key={repo} id={repo} />) : "—"}
                </span>
              </div>
              <div className="rfact">
                <span className="k">Labels</span>
                <span className="v">
                  {task.labels.length
                    ? task.labels.map((label) => <Label key={label} text={label} />)
                    : "—"}
                </span>
              </div>
              <div className="rfact">
                <span className="k">SharePoint ref</span>
                <span className="v">{task.sync.sp}</span>
              </div>
            </div>
          </div>

          <div className="blk">
            <div className="bh">
              <span className="kk">/ TaskRecord</span>
            </div>
            <div className="sor">
              <div className="sor-top">
                <span className="sor-list">
                  {todos?.title ?? "ToDos"} · <b>{sharePointItem}</b>
                </span>
                <a
                  className="splink"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                  }}
                >
                  Open in SharePoint ↗
                </a>
              </div>
              <div className="sor-fields">
                {SOR_FIELD_NAMES.map((fieldName) => (
                  <div className="sorf" key={fieldName}>
                    <span className="f">{fieldName}</span>
                    <span className="dir">{sorDirectionForField(fieldName, todos?.columns ?? [])}</span>
                    <span className="v">{fieldValue(fieldName, task)}</span>
                  </div>
                ))}
              </div>
              <div className="sor-foot">
                <span className="note">Last sync · {task.sync.ts}</span>
                <button type="button" className="btn ghost sm" onClick={syncNow}>
                  Sync now
                </button>
              </div>
            </div>

            {conflict && (
              <div className="sor-conflict">
                <div className="sch">
                  <span className="dot" />
                  Conflict · {conflict.field} edited on both sides
                </div>
                <div className="scb">
                  <div className="side">
                    <div className="k">Mission Control</div>
                    <div className="v">{conflict.mcVal}</div>
                  </div>
                  <div className="side">
                    <div className="k">SharePoint</div>
                    <div className="v">{conflict.spVal}</div>
                  </div>
                </div>
                <div className="scf">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => resolveTaskConflict("mc")}
                  >
                    Keep Mission Control
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => resolveTaskConflict("sp")}
                  >
                    Keep SharePoint
                  </button>
                </div>
              </div>
            )}
            {!conflict && resolvedWinner && (
              <div className="sor-resolved">
                <span className="d" />
                Resolved · kept {resolvedWinner === "mc" ? "Mission Control" : "SharePoint"} value
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
