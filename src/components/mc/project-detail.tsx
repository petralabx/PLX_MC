"use client";

import { useState, type CSSProperties } from "react";

import { ACTORS, PROJECTS, STAGES, STAGE_IDX, type Project } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks, bucketsForProject, projectById, pushNotice, updateProject } from "@/lib/mc-data/store";

import { Avatar, HealthPill, SyncTick } from "./atoms";
import { PeoplePicker } from "./people-picker";
import type { ScreenProps } from "./route";

const FALLBACK_PROJECT = PROJECTS[0];

// Same labels the New Initiative / New Project modals use for the health seg.
const HEALTH_OPTIONS: Array<{ value: Project["health"]; label: string }> = [
  { value: "track", label: "On track" },
  { value: "risk", label: "At risk" },
  { value: "off", label: "Off track" },
];

export function ProjectDetail({ route, nav }: ScreenProps) {
  useMcVersion();

  const project = projectById(route.projectId ?? FALLBACK_PROJECT.id) ?? FALLBACK_PROJECT;
  const buckets = bucketsForProject(project.id);
  const tasks = allTasks().filter((t) => buckets.some((b) => b.id === t.bucket));

  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");

  // All edits route through updateProject (store) → PATCH /api/projects/{id}:
  // optimistic local apply, reconcile to server truth on success, rollback +
  // non-silent notice on failure — the same contract as updateBucket.
  const commitTarget = (raw: string) => {
    const target = raw.trim() || "—";
    if (target !== project.target) updateProject(project.id, { target });
  };

  return (
    <div className="mc-main" data-testid="project-screen">
      <div className="ph">
        <div>
          <button type="button" className="back" onClick={() => nav("home")}>
            ← Back
          </button>
          <span className="kk bucket-kicker">Project · {project.id}</span>
          <h1>{project.name}</h1>
          {editingDesc ? (
            <div className="desc-edit ph-desc-edit">
              <textarea
                className="desc-input"
                value={descDraft}
                onChange={(event) => setDescDraft(event.target.value)}
                placeholder="What is this project about?"
                aria-label="Edit project description"
                rows={3}
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
                    updateProject(project.id, { desc: descDraft.trim() });
                    setEditingDesc(false);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="sub">
              {project.desc || "No description yet."}{" "}
              <button
                type="button"
                className="tl-link"
                onClick={() => {
                  setDescDraft(project.desc ?? "");
                  setEditingDesc(true);
                }}
              >
                {project.desc ? "Edit" : "Add description"}
              </button>
            </p>
          )}
        </div>
        <div className="r">
          <HealthPill h={project.health} />
          <SyncTick sync={project.sync} />
        </div>
      </div>

      <div className="bk">
        <div className="bkfacts">
          {/* Health — editable via the facts-rail select pattern (.rfact-select,
              the Initiative/Environment rows in task detail); the health pill
              stays in the page header. */}
          <div className="f">
            <span className="k">Health</span>
            <span className="v sm">
              <label className="rfact-select">
                <select
                  value={project.health}
                  onChange={(event) =>
                    updateProject(project.id, { health: event.target.value as Project["health"] })
                  }
                  aria-label="Set project health"
                >
                  {HEALTH_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="caret" aria-hidden="true">▾</span>
              </label>
            </span>
          </div>
          {/* Accountable owner — always human; same field-button + PeoplePicker
              pattern as the task facts rail / New Initiative modal. */}
          <div className="f">
            <span className="k">Accountable owner</span>
            <span className="v sm" style={{ position: "relative" }}>
              <button
                type="button"
                className="ntm-field-btn"
                onClick={() => setOwnerPickerOpen((open) => !open)}
              >
                <span className="who fact-owner">
                  <Avatar id={project.owner} size="sm" />
                  <span className="nm">{ACTORS[project.owner]?.name ?? project.owner}</span>
                </span>
                <span className="caret" aria-hidden="true">▾</span>
              </button>
              {ownerPickerOpen && (
                <PeoplePicker
                  allowAgents={false}
                  current={project.owner}
                  onPick={(actorId) => {
                    // A project always carries a human accountable owner —
                    // an "Unassign" click is blocked with a visible notice.
                    if (actorId) {
                      updateProject(project.id, { owner: actorId });
                      return;
                    }
                    pushNotice("Projects require a human accountable owner.");
                  }}
                  onClose={() => setOwnerPickerOpen(false)}
                  style={{ top: "calc(100% + 6px)", left: 0 }}
                />
              )}
            </span>
          </div>
          {/* Target — inline text edit, commit on blur/Enter (the sub-task due
              pattern) in the underline input skin (.le-input). Keyed on the
              store value so a rollback re-renders the restored target. */}
          <div className="f">
            <span className="k">Target</span>
            <span className="v sm">
              <input
                key={`${project.id}:${project.target}`}
                className="le-input"
                defaultValue={project.target}
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
            </span>
          </div>
          <div className="f">
            <span className="k">Started</span>
            <span className="v sm">{project.started}</span>
          </div>
          <div className="f">
            <span className="k">Initiatives</span>
            <span className="v">{buckets.length}</span>
          </div>
          <div className="f">
            <span className="k">Tasks</span>
            <span className="v">{tasks.length}</span>
          </div>
        </div>

        <div className="bkbody">
          <div className="c">
            <div className="blk">
              <div className="bh">
                <span className="kk">
                  / Initiatives · <b>{buckets.length}</b>
                </span>
              </div>
              {buckets.length === 0 ? (
                <p className="sub">No initiatives under this project yet.</p>
              ) : (
                <div className="init-grid">
                  {buckets.map((bucket) => {
                    const bucketTasks = tasks.filter((t) => t.bucket === bucket.id);
                    const done = bucketTasks.filter(
                      (t) => STAGES[STAGE_IDX[t.stage]].band === "done"
                    ).length;
                    const pct =
                      bucketTasks.length > 0 ? Math.round((done / bucketTasks.length) * 100) : 0;
                    const barStyle = { "--pct": `${pct}%` } as CSSProperties;
                    return (
                      <button
                        type="button"
                        key={bucket.id}
                        className={`init-card ${bucket.health}`}
                        onClick={() =>
                          nav("bucket", { bucketId: bucket.id, projectId: project.id })
                        }
                      >
                        <span className="ih">
                          <span className="id">{bucket.id}</span>
                          <HealthPill h={bucket.health} />
                        </span>
                        <span className="nm">{bucket.name}</span>
                        <span className="prog">
                          <span className="bar" style={barStyle}>
                            <span className="fill" />
                          </span>
                          <span className="ct">
                            {bucketTasks.length === 0
                              ? "No tasks yet"
                              : `${done}/${bucketTasks.length} tasks done`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
