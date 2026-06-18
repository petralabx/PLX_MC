"use client";

import { useState } from "react";

import { CURRENT_USER, isApprover } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  actorById,
  allRepos,
  allTasks,
  approveRepo,
  rejectRepo,
  repoRequests,
  requestRepo,
} from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { deriveRepoRows } from "./record-logic";
import type { ScreenProps } from "./route";

const PR_STATUS_TONE: Record<"open" | "merged" | "closed", "acc" | "ok" | "muted"> = {
  open: "acc",
  merged: "ok",
  closed: "muted",
};

const REQUEST_STATUS_TONE: Record<"pending" | "approved" | "rejected", "warn" | "ok" | "muted"> = {
  pending: "warn",
  approved: "ok",
  rejected: "muted",
};

export function ReposView({ nav }: ScreenProps) {
  useMcVersion();
  const [openRepoId, setOpenRepoId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [repoName, setRepoName] = useState("");
  const [repoScope, setRepoScope] = useState("");
  const registry = allRepos();
  const repoRows = deriveRepoRows(registry, allTasks());
  const requests = repoRequests();
  const approver = isApprover(actorById(CURRENT_USER));

  const submitRequest = () => {
    if (!repoName.trim()) return;
    requestRepo({ name: repoName, scope: repoScope });
    setRepoName("");
    setRepoScope("");
    setRequesting(false);
  };

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">System of record · code</span>
          <h1>Repos</h1>
          <p className="sub">
            The codebases this workspace tracks. The registry is the allow-list — humans and agents
            may only attach repos that live here. New repos go through request → approve.
          </p>
        </div>
        <div className="r">
          <span className="count">
            <b>{repoRows.length}</b> repos
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setRequesting((prev) => !prev)}
          >
            {requesting ? "Cancel" : "+ Request repo"}
          </button>
        </div>
      </div>

      {requesting && (
        <div className="repo-req-form">
          <input
            className="repo-req-input"
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
            placeholder="Repository name (validated against the GitHub org)"
            aria-label="Repository name"
          />
          <input
            className="repo-req-input"
            value={repoScope}
            onChange={(event) => setRepoScope(event.target.value)}
            placeholder="What it's for (optional)"
            aria-label="Repository scope"
          />
          <button type="button" className="btn acc sm" disabled={!repoName.trim()} onClick={submitRequest}>
            Request →
          </button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="repo-reqs">
          <div className="bh sec">
            <span className="kk">Repo requests</span>
          </div>
          {requests.map((req) => (
            <div className="repo-req-row" key={req.id}>
              <span className="nm">{req.name}</span>
              <span className="repo-req-meta">
                {req.owner} · requested by {actorById(req.requestedBy)?.name ?? req.requestedBy}
                {req.note ? ` · ${req.note}` : ""}
              </span>
              <span className={`pill ${req.verified ? "ok" : "muted"}`}>
                <span className="dot" />
                {req.verified ? "verified" : "unverified"}
              </span>
              <span className={`pill ${REQUEST_STATUS_TONE[req.status]}`}>
                <span className="dot" />
                {req.status}
              </span>
              {approver && req.status === "pending" && (
                <span className="repo-req-acts">
                  <button
                    type="button"
                    className="btn acc sm"
                    disabled={!req.verified}
                    title={req.verified ? undefined : "Unverified against the GitHub org — can't be approved"}
                    onClick={() => approveRepo(req.id)}
                  >
                    Approve
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => rejectRepo(req.id)}>
                    Reject
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

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
                    {row.repo.lang} · default {row.repo.def} · {row.repo.visibility}
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
