"use client";

import { useState } from "react";

import {
  ACTORS,
  AGENTS,
  CURRENT_USER,
  PRIORITY,
  STAGES,
  STAGE_IDX,
  TARGET_ENV,
  confidenceOf,
  type PriorityKey,
  type SpColumn,
  type SyncDirection,
  type TargetEnv,
  type Task,
} from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  addComment,
  allBuckets,
  allTasks,
  bucketById,
  deleteComment,
  editComment,
  markAllSynced,
  mentionables,
  openConflicts,
  reassignTask,
  resolveConflict,
  setAccountableOwner,
  setAgentRunApproved,
  setCoassignees,
  setHumanOnly,
  setTaskBucket,
  setTaskDescription,
  setTaskLabels,
  setTaskPriority,
  setTaskRepos,
  setTaskStage,
  setTaskTargetEnv,
  spLists,
  taskById,
} from "@/lib/mc-data/store";

import {
  Assignee,
  Avatar,
  AvatarStack,
  Estimate,
  Label,
  Priority,
  RepoChip,
  ReqChip,
  Slate,
  SyncTick,
} from "./atoms";
import { LabelEditor } from "./label-editor";
import { NotifyTrail, PeoplePicker } from "./people-picker";
import { repoEditMode } from "./record-logic";
import { RepoEditor } from "./repo-editor";
import type { ScreenProps } from "./route";
import { SubtaskList } from "./subtask-list";
import { Timeline } from "./timeline";

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

function RepoFact({ task }: { task: Task }) {
  const [unlocked, setUnlocked] = useState(false);
  const [retargeting, setRetargeting] = useState(false);
  const [reason, setReason] = useState("");

  const editable = repoEditMode(task.stage, task.repos.length > 0) === "open" || unlocked;

  if (editable) {
    return (
      <RepoEditor
        repos={task.repos}
        onChange={(repos) => {
          const pending = reason.trim();
          if (unlocked && pending) {
            setTaskRepos(task.id, repos, { reason: pending });
            setReason("");
            return;
          }
          setTaskRepos(task.id, repos);
        }}
      />
    );
  }

  return (
    <span className="repo-locked">
      {task.repos.map((repo) => (
        <RepoChip key={repo} id={repo} />
      ))}
      {!retargeting ? (
        <button
          type="button"
          className="repo-retarget"
          onClick={() => setRetargeting(true)}
          title="Target is locked once work is in flight — retarget with a reason"
        >
          Retarget
        </button>
      ) : (
        <span className="repo-retarget-form">
          <input
            className="le-input"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for retarget"
            aria-label="Reason for retargeting repos"
          />
          <button
            type="button"
            className="btn ghost sm"
            disabled={!reason.trim()}
            onClick={() => {
              setUnlocked(true);
              setRetargeting(false);
            }}
          >
            Unlock
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setRetargeting(false);
              setReason("");
            }}
          >
            Cancel
          </button>
        </span>
      )}
    </span>
  );
}

export function TaskDetailView({ route, nav }: ScreenProps) {
  useMcVersion();
  const taskId = route.taskId ?? allTasks()[0]?.id ?? "";
  const task = taskById(taskId);
  const [resolved, setResolved] = useState<{ taskId: string; winner: "mc" | "sp" } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [accountablePickerOpen, setAccountablePickerOpen] = useState(false);
  const [coPickerOpen, setCoPickerOpen] = useState(false);
  const [reassigned, setReassigned] = useState<{ taskId: string; actorId: string } | null>(null);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  if (!task) {
    return (
      <div className="mc-main">
        <div className="empty">
          <div className="glyph">?</div>
          <h3>Task not found</h3>
          <p>
            {taskId || "This task"} is not in this workspace snapshot. Use the board to pick
            another task.
          </p>
          <div className="acts">
            <button type="button" className="btn ghost" onClick={() => nav("board")}>
              Go to board
            </button>
          </div>
        </div>
      </div>
    );
  }

  const bucket = bucketById(task.bucket);
  const stageIdx = STAGE_IDX[task.stage] ?? 0;
  const todos = spLists().find((list) => list.key === "todos");
  const sharePointItem = task.sync.sp.split("· ")[1] ?? task.sync.sp;
  const progress = deriveEvidenceProgress(task);
  const conflict = openConflicts().find((entry) => entry.entityId === task.id);
  // Approve-mode agent executor needs an explicit operator approval before the
  // task advances into the doing band (EN-005). null when the executor isn't a
  // needs-approval agent (the `?.` guards a human/empty assignee at runtime).
  const runApprovalAgent =
    task.assignee && AGENTS[task.assignee]?.mode === "approve" ? AGENTS[task.assignee] : null;

  // Real engine sweep; the demo inbound simulation is gone.
  const syncNow = () => {
    markAllSynced();
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
                    // Human-only tasks hide agents from the executor picker (EN-003).
                    allowAgents={!task.humanOnly}
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
              {runApprovalAgent && (
                <span className="asgwrap">
                  <button
                    type="button"
                    className={`btn sm ${task.agentRunApproved ? "ok" : "acc"}`}
                    onClick={() => setAgentRunApproved(task.id, !task.agentRunApproved)}
                    title={`${runApprovalAgent.name} runs in needs-approval mode — operator approval gates advance into In Progress`}
                  >
                    {task.agentRunApproved
                      ? `${runApprovalAgent.name} run approved ✓`
                      : `Approve ${runApprovalAgent.name} run`}
                  </button>
                </span>
              )}
              <span className="asgwrap coasg">
                {task.coassignees.length > 0 && <AvatarStack ids={task.coassignees} />}
                <button
                  type="button"
                  className="coasg-add"
                  onClick={() => setCoPickerOpen((open) => !open)}
                  title="Add a co-assignee"
                  aria-label="Add a co-assignee"
                >
                  +<span className="coasg-lab">Co-assign</span>
                </button>
                {coPickerOpen && (
                  <PeoplePicker
                    // Humans-only for coassignees (§5 Module C recommendation).
                    allowAgents={false}
                    current={null}
                    onPick={(actorId) => {
                      // Accumulate: the picker is single-pick, so toggle the
                      // chosen id into the existing set; the store dedupes and
                      // drops the primary assignee (setCoassignees).
                      if (!actorId) return;
                      const next = task.coassignees.includes(actorId)
                        ? task.coassignees.filter((id) => id !== actorId)
                        : [...task.coassignees, actorId];
                      setCoassignees(task.id, next);
                    }}
                    onClose={() => setCoPickerOpen(false)}
                    style={{ top: "calc(100% + 6px)", left: 0 }}
                  />
                )}
              </span>
            </div>
            {reassigned?.taskId === task.id && <NotifyTrail id={reassigned.actorId} />}
          </div>

          <div className="blk">
            <div className="bh">
              <span className="kk">/ Description</span>
              {!editingDesc && (
                <button
                  type="button"
                  className="tl-link"
                  onClick={() => {
                    setDescDraft(task.description ?? "");
                    setEditingDesc(true);
                  }}
                >
                  {task.description ? "Edit" : "Add description"}
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="desc-edit">
                <textarea
                  className="desc-input"
                  value={descDraft}
                  onChange={(event) => setDescDraft(event.target.value)}
                  placeholder="Describe the work — mirrors to the SharePoint Description column."
                  aria-label="Edit description"
                  rows={4}
                  autoFocus
                />
                <div className="desc-edit-acts">
                  <button type="button" className="btn ghost sm" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setTaskDescription(task.id, descDraft.trim());
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : task.description ? (
              <div className="prose">{task.description}</div>
            ) : (
              <div className="prose muted">No description yet.</div>
            )}
          </div>

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

          <div className="blk">
            <div className="bh">
              <span className="kk">
                / Subtasks · <b>{task.subtasks.filter((subtask) => subtask.done).length}</b>/
                {task.subtasks.length}
              </span>
            </div>
            <SubtaskList
              taskId={task.id}
              subtasks={task.subtasks}
              // Human-only tasks hide agents from the sub-task assignee picker too.
              allowAgents={!task.humanOnly}
              onPromote={(newTaskId) => nav("task", { taskId: newTaskId })}
            />
          </div>

          <div className="blk">
            <div className="bh">
              <span className="kk">/ Timeline · comments + activity</span>
            </div>
            <Timeline
              comments={task.comments ?? []}
              activity={task.activity}
              people={mentionables()}
              currentUser={CURRENT_USER}
              onAdd={(body) => addComment(task.id, body)}
              onEdit={(commentId, body) => editComment(task.id, commentId, body)}
              onDelete={(commentId) => deleteComment(task.id, commentId)}
            />
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
                const isCurrent = stage.key === task.stage;
                return (
                  // Editable lifecycle rail (R7 non-drag path for `stage`):
                  // clicking a step sets the task's stage via the spine wrapper.
                  // Stays keyboard-accessible (a real <button>); the current
                  // stage is a no-op (aria-current marks it).
                  <button
                    type="button"
                    className={`s ${cls}`}
                    key={stage.key}
                    onClick={() => {
                      if (!isCurrent) setTaskStage(task.id, stage.key);
                    }}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-label={`Set stage to ${stage.name}`}
                    title={isCurrent ? `Current stage · ${stage.name}` : `Move to ${stage.name}`}
                  >
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
                  </button>
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
              {/* Accountable owner — always human (EN-003). A task can't advance
                  past Planned without one (enforced in the store + server). */}
              <div className="rfact">
                <span className="k">Accountable owner</span>
                <span className="v" style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="ntm-field-btn"
                    onClick={() => setAccountablePickerOpen((open) => !open)}
                  >
                    {task.accountableOwner ? (
                      <span className="who" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <Avatar id={task.accountableOwner} size="sm" />
                        <span className="nm">{ACTORS[task.accountableOwner]?.name ?? task.accountableOwner}</span>
                      </span>
                    ) : (
                      <span className="unassigned">+ Assign accountable owner</span>
                    )}
                    <span className="caret" aria-hidden="true">▾</span>
                  </button>
                  {accountablePickerOpen && (
                    <PeoplePicker
                      allowAgents={false}
                      current={task.accountableOwner}
                      onPick={(actorId) => setAccountableOwner(task.id, actorId)}
                      onClose={() => setAccountablePickerOpen(false)}
                      style={{ top: "calc(100% + 6px)", left: 0 }}
                    />
                  )}
                </span>
              </div>
              <div className="rfact">
                <span className="k">Human-only</span>
                <span className="v">
                  <label className="rfact-toggle">
                    <input
                      type="checkbox"
                      checked={!!task.humanOnly}
                      onChange={(event) => setHumanOnly(task.id, event.target.checked)}
                      aria-label="Toggle human-only assignment policy"
                    />
                    <span>{task.humanOnly ? "Agents blocked" : "Agents allowed"}</span>
                  </label>
                </span>
              </div>
              {/* Priority — editable (R7 non-drag path); SP-tier, mirrors. */}
              <div className="rfact">
                <span className="k">Priority</span>
                <span className="v">
                  <label className="rfact-select">
                    <Priority p={task.priority} />
                    <select
                      value={task.priority}
                      onChange={(event) =>
                        setTaskPriority(task.id, event.target.value as PriorityKey)
                      }
                      aria-label="Set priority"
                    >
                      {(Object.entries(PRIORITY) as [PriorityKey, (typeof PRIORITY)[PriorityKey]][]).map(
                        ([key, cfg]) => (
                          <option key={key} value={key}>
                            {cfg.label}
                          </option>
                        )
                      )}
                    </select>
                    <span className="caret" aria-hidden="true">▾</span>
                  </label>
                </span>
              </div>
              {/* Initiative (bucket) — editable, DB-only (Initiative is an SP
                  Lookup → Roadmap; the lookup-id write lands with the directory
                  increment, so no sync claim here). This is also the non-drag /
                  touch-reachable path for `bucket` (R7). */}
              <div className="rfact">
                <span className="k">Initiative</span>
                <span className="v">
                  <label className="rfact-select">
                    <select
                      value={task.bucket}
                      onChange={(event) => setTaskBucket(task.id, event.target.value)}
                      aria-label="Set initiative"
                    >
                      {allBuckets().map((bucketOption) => (
                        <option key={bucketOption.id} value={bucketOption.id}>
                          {bucketOption.name}
                        </option>
                      ))}
                    </select>
                    <span className="caret" aria-hidden="true">▾</span>
                  </label>
                  <span
                    className="rfact-note"
                    title="Initiative mirror lands with the directory/lookup increment"
                  >
                    mirror deferred
                  </span>
                </span>
              </div>
              {/* Repos — editable target (PUSHED). Lifecycle-gated: free while
                  planning / unset, locked behind Retarget once in flight. */}
              <div className="rfact">
                <span className="k">Repos</span>
                <span className="v">
                  <RepoFact key={task.id} task={task} />
                </span>
              </div>
              {/* Target environment — editable (PUSHED). Not lifecycle-locked:
                  staging → production is normal progression toward go-live. */}
              <div className="rfact">
                <span className="k">Environment</span>
                <span className="v">
                  <label className="rfact-select">
                    <select
                      value={task.targetEnv ?? "staging"}
                      onChange={(event) =>
                        setTaskTargetEnv(task.id, event.target.value as TargetEnv)
                      }
                      aria-label="Set target environment"
                    >
                      {(Object.entries(TARGET_ENV) as [TargetEnv, (typeof TARGET_ENV)[TargetEnv]][]).map(
                        ([key, cfg]) => (
                          <option key={key} value={key}>
                            {cfg.label}
                          </option>
                        )
                      )}
                    </select>
                    <span className="caret" aria-hidden="true">▾</span>
                  </label>
                </span>
              </div>
              {/* Labels — editable inline (DB-only, no sync claim). Shares the
                  LabelEditor with the New Task modal (Pillar 3). */}
              <div className="rfact">
                <span className="k">Labels</span>
                <span className="v">
                  <LabelEditor
                    labels={task.labels}
                    onChange={(labels) => setTaskLabels(task.id, labels)}
                  />
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
