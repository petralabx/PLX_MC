"use client";

// Enriched sub-task list (EN-001 / WS-3 medium depth): each sub-task keeps the
// prototype's checkbox + single avatar, and gains an expandable detail editor
// for description, assignee (human or agent), due date and status, plus
// reorder (up/down) and promote-to-task. The store owns persistence (DB-only
// tier) — this component is presentational and calls the store actions.

import { useState } from "react";

import { ACTORS, CURRENT_USER, type Subtask, type SubtaskStatus } from "@/lib/mc-data";
import {
  addSubtask,
  promoteSubtaskToTask,
  reorderSubtasks,
  toggleSubtask,
  updateSubtask,
} from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { PeoplePicker } from "./people-picker";

const STATUS_OPTIONS: { key: SubtaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

const statusOf = (s: Subtask): SubtaskStatus => s.status ?? (s.done ? "done" : "todo");

function SubtaskRow({
  taskId,
  subtask,
  index,
  count,
  allowAgents,
  onMove,
  onPromote,
}: {
  taskId: string;
  subtask: Subtask;
  index: number;
  count: number;
  allowAgents: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  onPromote: (subtaskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const assignee = subtask.assignee ?? subtask.who;

  return (
    <div className={`sub rich${subtask.done ? " done" : ""}`}>
      <div className="sub-head">
        <button
          type="button"
          className="box"
          onClick={() => toggleSubtask(taskId, subtask.id)}
          title={subtask.done ? "Mark not done" : "Mark done"}
          aria-label={`Toggle subtask ${subtask.t}`}
          aria-pressed={subtask.done}
        >
          {subtask.done ? "✓" : ""}
        </button>
        <span className="id">{subtask.id}</span>
        <button type="button" className="t sub-title-btn" onClick={() => setOpen((o) => !o)} title="Edit sub-task">
          {subtask.t}
        </button>
        <span className={`sub-status ${statusOf(subtask)}`}>{statusOf(subtask)}</span>
        <span className="who">
          <Avatar id={assignee} size="sm" />
        </span>
        <span className="sub-reorder">
          <button
            type="button"
            className="sub-mv"
            onClick={() => onMove(index, -1)}
            disabled={index === 0}
            aria-label="Move sub-task up"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="sub-mv"
            onClick={() => onMove(index, 1)}
            disabled={index === count - 1}
            aria-label="Move sub-task down"
            title="Move down"
          >
            ↓
          </button>
        </span>
      </div>
      {open && (
        <div className="sub-edit">
          <input
            className="sub-edit-title"
            defaultValue={subtask.t}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== subtask.t) updateSubtask(taskId, subtask.id, { t: v });
            }}
            aria-label="Sub-task title"
          />
          <textarea
            className="sub-edit-desc"
            defaultValue={subtask.description ?? ""}
            placeholder="Add a description…"
            onBlur={(e) => {
              const v = e.target.value;
              if (v !== (subtask.description ?? "")) updateSubtask(taskId, subtask.id, { description: v });
            }}
            aria-label="Sub-task description"
            rows={2}
          />
          <div className="sub-edit-row">
            <label className="sub-edit-field">
              <span className="k">Assignee</span>
              <span className="sub-assignee" style={{ position: "relative" }}>
                <button type="button" className="sub-assignee-btn" onClick={() => setPickerOpen((p) => !p)}>
                  <Avatar id={assignee} size="sm" />
                  <span className="nm">{ACTORS[assignee]?.name ?? assignee}</span>
                </button>
                {pickerOpen && (
                  <PeoplePicker
                    allowAgents={allowAgents}
                    current={subtask.assignee ?? subtask.who}
                    onPick={(actorId) => updateSubtask(taskId, subtask.id, { assignee: actorId ?? subtask.who })}
                    onClose={() => setPickerOpen(false)}
                    style={{ top: "calc(100% + 6px)", left: 0 }}
                  />
                )}
              </span>
            </label>
            <label className="sub-edit-field">
              <span className="k">Due</span>
              <input
                className="sub-edit-due"
                defaultValue={subtask.due ?? ""}
                placeholder="e.g. Jun 22"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (subtask.due ?? "")) updateSubtask(taskId, subtask.id, { due: v });
                }}
                aria-label="Sub-task due date"
              />
            </label>
            <label className="sub-edit-field">
              <span className="k">Status</span>
              <select
                className="sub-edit-status"
                value={statusOf(subtask)}
                onChange={(e) => updateSubtask(taskId, subtask.id, { status: e.target.value as SubtaskStatus })}
                aria-label="Sub-task status"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="sub-edit-acts">
            <button type="button" className="btn ghost sm" onClick={() => onPromote(subtask.id)}>
              Promote to task →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SubtaskList({
  taskId,
  subtasks,
  allowAgents,
  onPromote,
}: {
  taskId: string;
  subtasks: Subtask[];
  allowAgents: boolean;
  onPromote: (subtaskId: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= subtasks.length) return;
    const ids = subtasks.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorderSubtasks(taskId, ids);
  };

  const promote = (subtaskId: string) => {
    const created = promoteSubtaskToTask(taskId, subtaskId);
    if (created) onPromote(created.id);
  };

  return (
    <div className="subs">
      {subtasks.map((subtask, index) => (
        <SubtaskRow
          key={subtask.id}
          taskId={taskId}
          subtask={subtask}
          index={index}
          count={subtasks.length}
          allowAgents={allowAgents}
          onMove={move}
          onPromote={promote}
        />
      ))}
      <div className="sub-add">
        <span className="box" aria-hidden="true" />
        <input
          className="sub-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addSubtask(taskId, draft, CURRENT_USER);
              setDraft("");
            }
          }}
          placeholder="+ Add subtask"
          aria-label="Add a subtask"
        />
      </div>
    </div>
  );
}
