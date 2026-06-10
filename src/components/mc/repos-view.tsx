"use client";

import { useState } from "react";

import { REPOS } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import { allTasks } from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { deriveRepoRows } from "./record-logic";
import type { ScreenProps } from "./route";

const PR_STATUS_TONE: Record<"open" | "merged" | "closed", "acc" | "ok" | "muted"> = {
  open: "acc",
  merged: "ok",
  closed: "muted",
};

export function ReposView({ nav }: ScreenProps) {
  useMcVersion();
  const [openRepoId, setOpenRepoId] = useState<string | null>(null);
  const repoRows = deriveRepoRows(REPOS, allTasks());

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">System of record · code</span>
          <h1>Repos</h1>
          <p className="sub">
            The codebases this workspace tracks. Tasks can span repos; pull requests land where the
            work lives.
          </p>
        </div>
        <div className="r">
          <span className="count">
            <b>{repoRows.length}</b> repos
          </span>
        </div>
      </div>

      <div className="repos">
        {repoRows.map((row) => {
          const isOpen = openRepoId === row.repo.id;
          return (
            <div className="repo-row" key={row.repo.id}>
              <button
                type="button"
                className="rh"
                onClick={() => setOpenRepoId(isOpen ? null : row.repo.id)}
              >
                <span className="glyph">❮❯</span>
                <span>
                  <span className="nm">{row.repo.name}</span>
                  <span className="lang">
                    {row.repo.lang} · default {row.repo.def}
                  </span>
                </span>
                <span className="ct">
                  <b>{row.openPrCount}</b> open PRs
                </span>
                <span className="ct">
                  <b>{row.tasks.length}</b> tasks · {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen && (
                <div className="rbody">
                  {row.prs.map((pr) => (
                    <button
                      type="button"
                      className="ritem"
                      key={`${row.repo.id}-${pr.num}-${pr.taskId}`}
                      onClick={() => nav("task", { taskId: pr.taskId })}
                    >
                      <span className="id">#{pr.num}</span>
                      <span>{pr.title}</span>
                      <span className={`pill ${PR_STATUS_TONE[pr.status]}`}>
                        <span className="dot" />
                        {pr.status}
                      </span>
                      <span className="id">{pr.taskId}</span>
                    </button>
                  ))}
                  {row.tasks.map((task) => (
                    <button
                      type="button"
                      className="ritem"
                      key={`${row.repo.id}-${task.id}`}
                      onClick={() => nav("task", { taskId: task.id })}
                    >
                      <span className="id">{task.id}</span>
                      <span>{task.title}</span>
                      {task.repoCount > 1 && (
                        <span className="reqchip" title="Spans multiple repos">
                          ×{task.repoCount} repos
                        </span>
                      )}
                      {task.assignee && <Avatar id={task.assignee} size="sm" />}
                    </button>
                  ))}
                  {row.prs.length === 0 && row.tasks.length === 0 && (
                    <div className="colempty">No linked tasks or pull requests.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
