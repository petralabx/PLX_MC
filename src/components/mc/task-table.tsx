"use client";

// TaskTable — task rows whose columns tier by the table's own width (container queries; card rows below 600px), capped at `cap` rows (outstanding and revealed closed rows each) with a show-all footer and an optional closed-rows reveal; props: tasks, nav, closed?, emptyText, cap?.
import { useState } from "react";
import { Eye, EyeOff, Hand } from "lucide-react";

import { ACTORS, PRIORITY, STAGES, STAGE_IDX, hasHumanAccountableOwner, inputRequired } from "@/lib/mc-data";
import type { PriorityKey, Task } from "@/lib/mc-data";
import { isStewardBlocked, needsVince, uatBlockCauses } from "@/lib/tasks/uat-labels";

import { Assignee } from "./atoms";
import { cappedRows, isDoneStage, isOutstanding, stageChipTone } from "./project-overview.helpers";
import type { Nav } from "./route";

const PRIORITY_KEYS = Object.keys(PRIORITY) as PriorityKey[];

export function TaskTable({
  tasks,
  nav,
  closed,
  emptyText,
  cap = 8,
}: {
  tasks: Task[];
  nav: Nav;
  /** Closed rows the footer can reveal (Outstanding mode); omit to hide the reveal. */
  closed?: Task[];
  emptyText: string;
  cap?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const shownClosed = showClosed && closed ? closed : [];
  const rows = [...tasks, ...shownClosed];
  const visible = showAll ? rows : cappedRows(tasks, shownClosed, cap);
  const hidden = rows.length - visible.length;
  const closedDone = closed?.filter(isDoneStage).length ?? 0;
  const closedCancelled = (closed?.length ?? 0) - closedDone;

  return (
    <div className="pv-tt">
      {rows.length === 0 ? (
        <p className="pv-empty">{emptyText}</p>
      ) : (
        <>
          <div className="pv-thead" aria-hidden="true">
            <span className="h-id">ID</span>
            <span>Task</span>
            <span>Stage</span>
            <span className="h-pri">Pri</span>
            <span className="h-who">Executor</span>
            <span className="h-due">Due</span>
          </div>
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} nav={nav} />
          ))}
        </>
      )}
      {hidden > 0 && (
        <button type="button" className="pv-tfoot more" onClick={() => setShowAll(true)}>
          Show all {rows.length} · {hidden} more ↓
        </button>
      )}
      {closed && closed.length > 0 && (
        <button type="button" className="pv-tfoot" onClick={() => setShowClosed((open) => !open)}>
          {showClosed ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
          {showClosed ? "Hide" : "Show"} {closed.length} closed · {closedDone} merged · {closedCancelled} cancelled
        </button>
      )}
    </div>
  );
}

// Why a row would sit under "Needs a human": blocked (a flag, or Steward's
// uat:blocked with its uat:cause:* causes), needs-vince, a pending approval
// gate (Verify), or open with no human accountable owner.
function TaskTags({ task }: { task: Task }) {
  const stewardBlocked = isStewardBlocked(task);
  const causes = stewardBlocked ? uatBlockCauses(task.labels) : [];
  return (
    <>
      {(task.blocked || stewardBlocked) && (
        <span className="pv-tag warn">{causes.length > 0 ? `Blocked · ${causes.join(", ")}` : "Blocked"}</span>
      )}
      {needsVince(task) && <span className="pv-tag warn">Needs Vince</span>}
      {inputRequired(task) && (
        <span className="pv-tag info">
          <Hand size={9} aria-hidden="true" />
          Verify
        </span>
      )}
      {isOutstanding(task) && !hasHumanAccountableOwner(task) && <span className="pv-tag muted">No owner</span>}
    </>
  );
}

// Four bars rising left to right; the filled count is the priority level.
function PriorityBars({ p }: { p: PriorityKey }) {
  const cfg = PRIORITY[p];
  if (!cfg) return null;
  const level = PRIORITY_KEYS.length - PRIORITY_KEYS.indexOf(p);
  return (
    <span className={`pv-pribars ${cfg.cls}`} title={`Priority · ${cfg.label}`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= level ? "on" : ""} />
      ))}
    </span>
  );
}

function TaskRow({ task, nav }: { task: Task; nav: Nav }) {
  const stage = STAGES[STAGE_IDX[task.stage]];
  const who = task.assignee ? (ACTORS[task.assignee]?.name ?? task.assignee) : "Unassigned";
  return (
    <button type="button" className="pv-trow" onClick={() => nav("task", { taskId: task.id })}>
      <span className="tid">{task.id}</span>
      <span className="tmain">
        <span className="tline">
          <span className="ttl">{task.title}</span>
          <TaskTags task={task} />
        </span>
        <span className="tmeta">
          <span>{task.id}</span>
          <span>·</span>
          <span>{who}</span>
          <span>·</span>
          <span className={task.blocked ? "hot" : ""}>{task.due || "—"}</span>
          <TaskTags task={task} />
        </span>
      </span>
      <span className={`pv-chip ${stageChipTone(task)}`}>{stage.name}</span>
      <span className="pv-pri">
        <PriorityBars p={task.priority} />
      </span>
      <span className="pv-who">
        <Assignee id={task.assignee} />
      </span>
      <span className={`pv-due${task.blocked ? " hot" : ""}`}>{task.due || "—"}</span>
    </button>
  );
}
