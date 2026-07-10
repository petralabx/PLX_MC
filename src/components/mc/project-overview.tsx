"use client";

import { useState, type CSSProperties } from "react";

import { STAGES, STAGE_IDX } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";

import { Assignee, HealthPill, Priority } from "./atoms";
import { stageChipTone } from "./project-overview.helpers";
import type { InitiativeRollup } from "./project-overview.helpers";
import type { Nav } from "./route";

// Project Overview lens — the whole project tree on one page: every initiative
// as a collapsible section (health left-rule + progress in the header), its
// tasks as a dense bordered table underneath. Approved mock:
// .orchestrator/design-projects/rollup-mock/index.html.
export function ProjectOverview({
  projectId,
  rollups,
  nav,
}: {
  projectId: string;
  rollups: InitiativeRollup[];
  nav: Nav;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (bucketId: string) =>
    setCollapsed((prev) => ({ ...prev, [bucketId]: !prev[bucketId] }));

  if (rollups.length === 0) {
    return <p className="sub">No initiatives under this project yet.</p>;
  }

  return (
    <div className="pv-roll">
      {rollups.map(({ bucket, tasks, done, pct }) => {
        const isCollapsed = !!collapsed[bucket.id];
        const barStyle = { "--pct": `${pct}%` } as CSSProperties;
        return (
          <section
            key={bucket.id}
            className={`pv-sec ${bucket.health}${isCollapsed ? " closed" : ""}`}
          >
            <div className="pv-sec-h">
              <button
                type="button"
                className="pv-sec-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(bucket.id)}
              >
                <span className="chev" aria-hidden="true">▾</span>
                <span className="nm">{bucket.name}</span>
                <span className="id">{bucket.id}</span>
                <span className="track">
                  <span className="bar" style={barStyle}>
                    <span className="fill" />
                  </span>
                  <span className="ct">
                    {tasks.length === 0 ? "No tasks yet" : `${done} / ${tasks.length} done`}
                  </span>
                </span>
                <HealthPill h={bucket.health} />
              </button>
              <button
                type="button"
                className="pv-open tl-link"
                onClick={() => nav("bucket", { bucketId: bucket.id, projectId })}
              >
                Open →
              </button>
            </div>
            {!isCollapsed &&
              (tasks.length === 0 ? (
                <p className="pv-empty">No tasks in this initiative yet.</p>
              ) : (
                <div className="pv-tt">
                  <div className="pv-thead" aria-hidden="true">
                    <span className="h-id">ID</span>
                    <span>Task</span>
                    <span>Stage</span>
                    <span className="h-pri">Pri</span>
                    <span className="h-who">Executor</span>
                    <span className="h-due">Due</span>
                  </div>
                  {tasks.map((task) => (
                    <TaskRow key={task.id} task={task} nav={nav} />
                  ))}
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

function TaskRow({ task, nav }: { task: Task; nav: Nav }) {
  const stage = STAGES[STAGE_IDX[task.stage]];
  return (
    <button type="button" className="pv-trow" onClick={() => nav("task", { taskId: task.id })}>
      <span className="tid">{task.id}</span>
      <span className="ttl">{task.title}</span>
      <span className={`pv-chip ${stageChipTone(task)}`}>{stage.name}</span>
      <span className="pv-pri">
        <Priority p={task.priority} />
      </span>
      <span className="pv-who">
        <Assignee id={task.assignee} />
      </span>
      <span className={`pv-due${task.blocked ? " hot" : ""}`}>{task.due || "—"}</span>
    </button>
  );
}
