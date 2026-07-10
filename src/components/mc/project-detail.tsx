"use client";

import type { CSSProperties } from "react";

import { ACTORS, PROJECTS, STAGES, STAGE_IDX } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks, bucketsForProject, projectById } from "@/lib/mc-data/store";

import { Avatar, HealthPill, SyncTick } from "./atoms";
import type { ScreenProps } from "./route";

const FALLBACK_PROJECT = PROJECTS[0];

export function ProjectDetail({ route, nav }: ScreenProps) {
  useMcVersion();

  const project = projectById(route.projectId ?? FALLBACK_PROJECT.id) ?? FALLBACK_PROJECT;
  const buckets = bucketsForProject(project.id);
  const tasks = allTasks().filter((t) => buckets.some((b) => b.id === t.bucket));

  return (
    <div className="mc-main" data-testid="project-screen">
      <div className="ph">
        <div>
          <button type="button" className="back" onClick={() => nav("home")}>
            ← Back
          </button>
          <span className="kk bucket-kicker">Project · {project.id}</span>
          <h1>{project.name}</h1>
          <p className="sub">{project.desc}</p>
        </div>
        <div className="r">
          <HealthPill h={project.health} />
          <SyncTick sync={project.sync} />
        </div>
      </div>

      <div className="bk">
        <div className="bkfacts">
          <div className="f">
            <span className="k">Health</span>
            <span className="v sm">
              <HealthPill h={project.health} />
            </span>
          </div>
          <div className="f">
            <span className="k">Accountable owner</span>
            <span className="v sm fact-owner">
              <Avatar id={project.owner} size="sm" />
              {ACTORS[project.owner]?.name ?? project.owner}
            </span>
          </div>
          <div className="f">
            <span className="k">Target</span>
            <span className="v sm">{project.target}</span>
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
