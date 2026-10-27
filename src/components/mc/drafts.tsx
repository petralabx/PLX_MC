"use client";

// Drafts screen (Draft Projects step 3, TASK-4071; PRD docs/product/PRD-draft-projects.md).
// `?screen=drafts` lists the drafts the viewer can see; `&draftId=DRF-n` opens
// one: the plan tree with preflight badges, the research, the reviews and the
// frozen versions. Reviewers comment, raise findings, approve or ask for
// changes on the current version. The author, and only the author, accepts it,
// after a confirmation that states what Accept creates. Everything comes from
// the /api/drafts session routes; agents use the mc_*_draft tools instead.
// Text from a draft is shown as text, never as HTML, and only http(s) links
// become links.

import { useCallback, useEffect, useMemo, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type {
  Draft,
  DraftContent,
  DraftIssue,
  DraftPlanTask,
  DraftReview,
  DraftReviewKind,
  DraftStatus,
  DraftVersion,
} from "@/lib/drafts";

import type { ScreenProps } from "./route";

interface DraftRow {
  id: string;
  title: string;
  status: DraftStatus;
  author: string;
  version: number;
  buckets: number;
  tasks: number;
  openFindings: number;
  openBlockingFindings: number;
  updatedAt: string;
}

interface DraftDetail {
  draft: Omit<Draft, "reviews"> & { reviews: (DraftReview & { stale: boolean })[] };
  versions: { version: number; digest: string; frozenBy: string; frozenAt: string }[];
  version: DraftVersion | null;
  preflight: DraftIssue[];
  viewer: {
    email: string;
    isAuthor: boolean;
    openBlockingFindings: string[];
    unsubmittedEdits: boolean;
    acceptInProgress: boolean;
    canReview: boolean;
    canAccept: boolean;
  };
}

type ListFilter = "open" | "needsMyReview" | "mine" | "all";

const STATUS_LABEL: Record<DraftStatus, string> = {
  drafting: "drafting",
  in_review: "in review",
  accepted: "accepted",
  withdrawn: "withdrawn",
};

const STATUS_PILL: Record<DraftStatus, string> = {
  drafting: "muted",
  in_review: "warn",
  accepted: "ok",
  withdrawn: "muted",
};

const REVIEW_LABEL: Record<DraftReviewKind, string> = {
  comment: "Comment",
  finding: "Finding",
  approve: "Approve",
  request_changes: "Request changes",
};

const isWebLink = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);
const shortDigest = (digest: string | null) => (digest ? digest.slice(7, 19) : "—");
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

function errorText(err: unknown): string {
  return err instanceof ApiClientError || err instanceof Error ? err.message : "Something went wrong.";
}

export function DraftsView({ route, nav }: ScreenProps) {
  // Keyed by draft and version, so a new record starts from a clean state.
  return route.draftId ? (
    <DraftRecord
      key={`${route.draftId}@${route.version ?? ""}`}
      id={route.draftId}
      version={route.version ? Number(route.version) : null}
      nav={nav}
    />
  ) : (
    <DraftList nav={nav} />
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

function DraftList({ nav }: Pick<ScreenProps, "nav">) {
  const [filter, setFilter] = useState<ListFilter>("open");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (next: ListFilter) => {
    if (next === filter) return;
    setRows(null);
    setError(null);
    setFilter(next);
  };

  useEffect(() => {
    let live = true;
    const qs =
      filter === "needsMyReview" ? "?needsMyReview=true" : filter === "mine" ? "?mine=true&status=all" : filter === "all" ? "?status=all" : "";
    api<{ drafts: DraftRow[] }>(`/drafts${qs}`)
      .then((data) => live && setRows(data.drafts))
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [filter]);

  return (
    <div className="mc-main dr-page" data-testid="drafts-screen">
      <div className="ph">
        <div>
          <span className="kk">Plan · drafts</span>
          <h1>
            Draft <em>projects</em>
          </h1>
          <p className="sub">
            Plans waiting for review before they go live: a project, its buckets and tasks, and the research behind
            them. Reviewers check them here. The author accepts a draft, and Mission Control creates the records.
          </p>
        </div>
      </div>

      <div className="dr-filters" role="tablist" aria-label="Which drafts">
        {(
          [
            ["open", "Open"],
            ["needsMyReview", "Needs my review"],
            ["mine", "Mine"],
            ["all", "All"],
          ] as [ListFilter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`btn sm ${filter === key ? "acc" : "ghost"}`}
            onClick={() => choose(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="dr-banner bad">{error}</div>}
      {!error && rows === null && <div className="colempty">Loading drafts…</div>}
      {rows && rows.length === 0 && <div className="colempty">No drafts here yet. Agents add them with mc_save_draft.</div>}
      {rows && rows.length > 0 && (
        <ul className="dr-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="dr-row" onClick={() => nav("drafts", { draftId: row.id })}>
                <span className="id">{row.id}</span>
                <span className="dr-row-title">{row.title}</span>
                <span className={`pill ${STATUS_PILL[row.status]}`}>
                  <span className="dot" />
                  {STATUS_LABEL[row.status]}
                </span>
                <span className="dr-row-meta">
                  v{row.version} · {row.buckets} buckets · {row.tasks} tasks · {row.author}
                </span>
                {row.openBlockingFindings > 0 && (
                  <span className="pill hot">
                    <span className="dot" />
                    {row.openBlockingFindings} blocking
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Record ──────────────────────────────────────────────────────────────────

function DraftRecord({ id, version, nav }: { id: string; version: number | null; nav: ScreenProps["nav"] }) {
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let live = true;
    api<DraftDetail>(`/drafts/${encodeURIComponent(id)}${version ? `?version=${version}` : ""}`)
      .then((data) => {
        if (!live) return;
        setError(null);
        setDetail(data);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [id, version, tick]);

  if (error) {
    return (
      <div className="mc-main dr-page" data-testid="drafts-screen">
        <button type="button" className="btn ghost sm dr-back" onClick={() => nav("drafts")}>
          ← All drafts
        </button>
        <div className="dr-banner bad">{error}</div>
      </div>
    );
  }
  if (!detail) return <div className="mc-main dr-page colempty" data-testid="drafts-screen">Loading {id}…</div>;

  const { draft, viewer } = detail;
  const shown: DraftContent = detail.version?.content ?? draft.working;
  const viewingOld = detail.version !== null && detail.version.version !== draft.version;

  return (
    <div className="mc-main dr-page" data-testid="drafts-screen">
      <button type="button" className="btn ghost sm dr-back" onClick={() => nav("drafts")}>
        ← All drafts
      </button>
      <div className="ph">
        <div>
          <span className="kk">
            Draft · {draft.id} · version {draft.version || "not submitted"} · {STATUS_LABEL[draft.status]}
          </span>
          <h1>{shown.title}</h1>
          <p className="sub">
            By {draft.author}
            {draft.createdBy !== draft.author ? ` (written by ${draft.createdBy})` : ""} · {draft.visibility}
            {draft.reviewers.length > 0 ? ` · reviewers: ${draft.reviewers.join(", ")}` : ""} · digest{" "}
            <code>{shortDigest(detail.version?.digest ?? draft.digest)}</code>
          </p>
        </div>
      </div>

      {viewingOld && (
        <div className="dr-banner warn">
          You are reading version {detail.version!.version}. The current version is {draft.version}.{" "}
          <button type="button" className="btn ghost sm" onClick={() => nav("drafts", { draftId: draft.id })}>
            Read the current version
          </button>
        </div>
      )}
      {viewer.unsubmittedEdits && (
        <div className="dr-banner warn">The working copy has edits that are not submitted. Reviews and Accept wait for the next submit.</div>
      )}
      {viewer.openBlockingFindings.length > 0 && (
        <div className="dr-banner bad">
          {viewer.openBlockingFindings.length} open blocking finding(s). Accept waits until each is resolved or dismissed.
        </div>
      )}
      {draft.status === "accepted" && <AcceptedRecords draft={draft} nav={nav} />}

      <PlanSection content={shown} issues={viewingOld ? [] : detail.preflight} />
      <ResearchSection content={shown} />
      <ReviewsSection detail={detail} onChange={reload} />
      <VersionsSection detail={detail} nav={nav} />
      {viewer.isAuthor && draft.status === "in_review" && <AcceptSection detail={detail} onAccepted={reload} />}
    </div>
  );
}

function AcceptedRecords({ draft, nav }: { draft: Draft; nav: ScreenProps["nav"] }) {
  const entries = Object.entries(draft.materialized);
  return (
    <div className="dr-banner good">
      Accepted by {draft.acceptedBy} on {when(draft.acceptedAt)}. Created:{" "}
      {entries.map(([key, recordId], i) => {
        const go = () =>
          recordId.startsWith("PRJ-")
            ? nav("project", { projectId: recordId })
            : recordId.startsWith("BKT-")
              ? nav("bucket", { bucketId: recordId })
              : nav("task", { taskId: recordId });
        return (
          <span key={key}>
            {i > 0 ? ", " : ""}
            <button type="button" className="dr-link" onClick={go}>
              {key} → {recordId}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function IssueBadges({ issues, path }: { issues: DraftIssue[]; path: string }) {
  const mine = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
  if (mine.length === 0) return null;
  return (
    <span className="dr-issues">
      {mine.map((i, n) => (
        <span key={n} className="pill hot" title={i.message}>
          <span className="dot" />
          {i.message}
        </span>
      ))}
    </span>
  );
}

function TaskLine({ task, issues }: { task: DraftPlanTask; issues: DraftIssue[] }) {
  return (
    <li className="dr-task">
      <span className="id">{task.key}</span>
      <span className="dr-task-title">{task.title || "(no title)"}</span>
      <span className="pill muted">{task.priority}</span>
      <span className="pill muted">{task.kind}</span>
      {task.accountableOwner && <span className="dr-task-meta">owner {task.accountableOwner}</span>}
      {task.dependsOn.length > 0 && <span className="dr-task-meta">after {task.dependsOn.join(", ")}</span>}
      {task.repos.length > 0 && <span className="dr-task-meta">{task.repos.join(", ")}</span>}
      <IssueBadges issues={issues} path={`plan.tasks[${task.key}]`} />
      {task.description && <p className="dr-task-desc">{task.description}</p>}
    </li>
  );
}

export function PlanSection({ content, issues }: { content: DraftContent; issues: DraftIssue[] }) {
  const { project, buckets, tasks } = content.plan;
  return (
    <section className="dr-section" aria-label="Plan">
      <h2>Plan</h2>
      <div className="dr-project">
        <span className="id">P</span>
        {project.existing ? (
          <span>
            Adds to existing project <b>{project.existing}</b>
          </span>
        ) : (
          <span>
            New project <b>{project.name || "(no name)"}</b> · owner {project.owner || "—"}
            {project.repos.length > 0 ? ` · ${project.repos.join(", ")}` : ""}
          </span>
        )}
        <IssueBadges issues={issues} path="plan.project" />
        {project.desc && <p className="dr-task-desc">{project.desc}</p>}
      </div>
      <IssueBadges issues={issues} path="plan.buckets" />
      {buckets.map((bucket) => (
        <div className="dr-bucket" key={bucket.key}>
          <div className="dr-bucket-head">
            <span className="id">{bucket.key}</span>
            <b>{bucket.name || "(no name)"}</b>
            <span className="dr-task-meta">owner {bucket.owner || "—"}</span>
            <IssueBadges issues={issues} path={`plan.buckets[${bucket.key}]`} />
          </div>
          {bucket.desc && <p className="dr-task-desc">{bucket.desc}</p>}
          <ul className="dr-tasks">
            {tasks
              .filter((t) => t.bucket === bucket.key)
              .map((t) => (
                <TaskLine key={t.key} task={t} issues={issues} />
              ))}
          </ul>
        </div>
      ))}
      {tasks
        .filter((t) => !buckets.some((b) => b.key === t.bucket))
        .map((t) => (
          <ul className="dr-tasks" key={t.key}>
            <TaskLine task={t} issues={issues} />
          </ul>
        ))}
    </section>
  );
}

export function ResearchSection({ content }: { content: DraftContent }) {
  const r = content.research;
  const sources = new Map(r.sources.map((s) => [s.ref, s]));
  return (
    <section className="dr-section" aria-label="Research">
      <h2>Research</h2>
      {r.summary && <p className="dr-lead">{r.summary}</p>}
      {r.context && (
        <>
          <h3>Context</h3>
          <p className="dr-text">{r.context}</p>
        </>
      )}
      {r.findings.length > 0 && (
        <>
          <h3>Findings</h3>
          <ul className="dr-bullets">
            {r.findings.map((f, i) => (
              <li key={i}>
                {f.text}{" "}
                {f.sources.map((ref) => (
                  <span key={ref} className="dr-ref" title={sources.get(ref)?.title ?? "unknown source"}>
                    {ref}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.approaches.length > 0 && (
        <>
          <h3>Approaches</h3>
          <div className="dr-approaches">
            {r.approaches.map((a, i) => (
              <div key={i} className={`dr-approach ${a.chosen ? "chosen" : ""}`}>
                <div className="dr-bucket-head">
                  <b>{a.name}</b>
                  {a.chosen && (
                    <span className="pill ok">
                      <span className="dot" />
                      chosen
                    </span>
                  )}
                  <span className="dr-task-meta">
                    risk {a.risk} · effort {a.effort}
                  </span>
                </div>
                {a.pros.length > 0 && <p className="dr-text">For: {a.pros.join("; ")}</p>}
                {a.cons.length > 0 && <p className="dr-text">Against: {a.cons.join("; ")}</p>}
              </div>
            ))}
          </div>
        </>
      )}
      {r.recommendation && (
        <>
          <h3>Recommendation</h3>
          <p className="dr-text">{r.recommendation}</p>
        </>
      )}
      {r.risks.length > 0 && (
        <>
          <h3>Risks</h3>
          <ul className="dr-bullets">
            {r.risks.map((risk, i) => (
              <li key={i}>
                {risk.text} <span className="dr-task-meta">likelihood {risk.likelihood} · impact {risk.impact}</span>
                {risk.mitigation && <span className="dr-task-meta"> · mitigation: {risk.mitigation}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.openQuestions.length > 0 && (
        <>
          <h3>Open questions</h3>
          <ul className="dr-bullets">
            {r.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
      {r.sources.length > 0 && (
        <>
          <h3>Sources</h3>
          <ol className="dr-sources">
            {r.sources.map((s) => (
              <li key={s.ref}>
                <span className="dr-ref">{s.ref}</span>{" "}
                {isWebLink(s.url) ? (
                  <a href={s.url} target="_blank" rel="noreferrer noopener">
                    {s.title}
                  </a>
                ) : (
                  <span>
                    {s.title}
                    {s.url ? <code className="dr-path"> {s.url}</code> : null}
                  </span>
                )}{" "}
                <span className="dr-task-meta">
                  {s.kind}
                  {s.accessed ? ` · read ${s.accessed}` : ""}
                </span>
                {s.excerpt && <p className="dr-text dr-quote">{s.excerpt}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      {r.artifacts.length > 0 && (
        <>
          <h3>Artifacts</h3>
          <ul className="dr-bullets">
            {r.artifacts.map((a, i) => (
              <li key={i}>
                <span className="pill muted">{a.kind}</span>{" "}
                {isWebLink(a.url) ? (
                  <a href={a.url} target="_blank" rel="noreferrer noopener">
                    {a.name}
                  </a>
                ) : (
                  <span>{a.name}</span>
                )}
                {a.inline && <pre className="dr-inline">{a.inline}</pre>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ReviewsSection({ detail, onChange }: { detail: DraftDetail; onChange: () => void }) {
  const { draft, viewer } = detail;
  const [kind, setKind] = useState<DraftReviewKind>("comment");
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/drafts/${encodeURIComponent(draft.id)}/review`, { method: "POST", body: JSON.stringify(payload) });
      setBody("");
      setBlocking(false);
      onChange();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const close = (finding: DraftReview, action: "resolve" | "dismiss") => {
    const note = window.prompt(action === "dismiss" ? "Why is this finding dismissed? (10 characters or more)" : "Note (optional)") ?? null;
    if (action === "dismiss" && note === null) return;
    void send({ kind: action, findingId: finding.id, ...(note ? { body: note } : {}) });
  };

  return (
    <section className="dr-section" aria-label="Reviews">
      <h2>Reviews</h2>
      {draft.reviews.length === 0 && <p className="dr-text">No reviews yet.</p>}
      <ul className="dr-reviews">
        {draft.reviews.map((r) => {
          const open = r.kind === "finding" && r.status === "open";
          const raisedByMe = r.byKind === "human" && r.by.toLowerCase() === viewer.email.toLowerCase();
          return (
            <li key={r.id} className={`dr-review ${r.stale ? "stale" : ""}`}>
              <div className="dr-bucket-head">
                <span className={`pill ${r.kind === "approve" ? "ok" : r.kind === "finding" && r.blocking ? "hot" : "muted"}`}>
                  <span className="dot" />
                  {REVIEW_LABEL[r.kind]}
                  {r.kind === "finding" && r.blocking ? " · blocking" : ""}
                </span>
                {r.kind === "finding" && <span className="pill muted">{r.status}</span>}
                <span className="dr-task-meta">
                  {r.source === "mc" ? "Mission Control" : r.by}
                  {r.byKind === "agent" && r.source !== "mc" ? ` (agent ${r.byPrincipal}; advisory)` : ""} · v{r.version}
                  {r.stale ? " · stale" : ""} · {when(r.at)}
                  {r.target ? ` · on ${r.target}` : ""}
                </span>
              </div>
              <p className="dr-text">{r.body}</p>
              {r.closeReason && (
                <p className="dr-task-meta">
                  {r.status} by {r.closedBy}: {r.closeReason}
                </p>
              )}
              {open && (viewer.isAuthor || raisedByMe) && (
                <div className="dr-acts">
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => close(r, "resolve")}>
                    Resolve
                  </button>
                  {viewer.isAuthor && (
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => close(r, "dismiss")}>
                      Dismiss…
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {viewer.canReview && (
        <form
          className="dr-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim()) return;
            // The version this screen shows: a newer one refuses, so a review never lands on unread content.
            void send({ kind, version: draft.version, body: body.trim(), ...(kind === "finding" ? { blocking } : {}) });
          }}
        >
          <label className="dr-field">
            <span>Review version {draft.version}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as DraftReviewKind)}>
              {(Object.keys(REVIEW_LABEL) as DraftReviewKind[]).map((k) => (
                <option key={k} value={k}>
                  {REVIEW_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="Review"
            value={body}
            maxLength={8000}
            rows={3}
            placeholder={kind === "finding" ? "What is wrong, and where?" : "Your review"}
            onChange={(e) => setBody(e.target.value)}
          />
          {kind === "finding" && (
            <label className="dr-check">
              <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} /> Blocking: Accept
              waits until this is closed
            </label>
          )}
          {error && <div className="dr-banner bad">{error}</div>}
          <button type="submit" className="btn acc sm" disabled={busy || !body.trim()}>
            Post {REVIEW_LABEL[kind].toLowerCase()}
          </button>
        </form>
      )}
    </section>
  );
}

function VersionsSection({ detail, nav }: { detail: DraftDetail; nav: ScreenProps["nav"] }) {
  if (detail.versions.length === 0) return null;
  return (
    <section className="dr-section" aria-label="Versions">
      <h2>Versions</h2>
      <ul className="dr-bullets">
        {[...detail.versions].reverse().map((v) => (
          <li key={v.version}>
            <button
              type="button"
              className="dr-link"
              onClick={() => nav("drafts", { draftId: detail.draft.id, version: String(v.version) })}
            >
              Version {v.version}
            </button>{" "}
            <code>{shortDigest(v.digest)}</code>{" "}
            <span className="dr-task-meta">
              frozen by {v.frozenBy} · {when(v.frozenAt)}
            </span>
          </li>
        ))}
      </ul>
      {detail.version && detail.version.version !== detail.draft.version && (
        <VersionDiff older={detail.version.content} newer={detail.draft.working} olderVersion={detail.version.version} />
      )}
    </section>
  );
}

/** What changed from an older version to the current one: sections and plan keys. */
export function VersionDiff({ older, newer, olderVersion }: { older: DraftContent; newer: DraftContent; olderVersion: number }) {
  const changes = useMemo(() => {
    const out: string[] = [];
    if (older.title !== newer.title) out.push(`Title: "${older.title}" → "${newer.title}"`);
    const keyed = (c: DraftContent) =>
      new Map<string, string>([
        ["P", JSON.stringify(c.plan.project)],
        ...c.plan.buckets.map((b) => [b.key, JSON.stringify(b)] as [string, string]),
        ...c.plan.tasks.map((t) => [t.key, JSON.stringify(t)] as [string, string]),
      ]);
    const a = keyed(older);
    const b = keyed(newer);
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      if (!a.has(key)) out.push(`${key} added`);
      else if (!b.has(key)) out.push(`${key} removed`);
      else if (a.get(key) !== b.get(key)) out.push(`${key} changed`);
    }
    if (JSON.stringify(older.research) !== JSON.stringify(newer.research)) out.push("Research changed");
    return out;
  }, [older, newer]);
  return (
    <div className="dr-diff">
      <b>Since version {olderVersion}:</b> {changes.length ? changes.join(" · ") : "no change"}
    </div>
  );
}

function AcceptSection({ detail, onAccepted }: { detail: DraftDetail; onAccepted: () => void }) {
  const { draft, viewer } = detail;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = draft.working.plan;
  const summary = `${plan.project.existing ? `Adds to ${plan.project.existing}` : "Creates 1 project"}, ${plan.buckets.length} bucket${plan.buckets.length === 1 ? "" : "s"} and ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}`;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/drafts/${encodeURIComponent(draft.id)}/accept`, { method: "POST", body: JSON.stringify({ version: draft.version }) });
      setConfirming(false);
      onAccepted();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dr-section dr-accept" aria-label="Accept">
      <h2>Accept</h2>
      {!viewer.canAccept ? (
        <p className="dr-text">
          Accept is not available yet:{" "}
          {viewer.acceptInProgress
            ? "an Accept of this version is running. Reload in a minute."
            : viewer.unsubmittedEdits
              ? "submit the working copy first."
              : "close every blocking finding first."}
        </p>
      ) : !confirming ? (
        <button type="button" className="btn acc" onClick={() => setConfirming(true)}>
          Accept version {draft.version}…
        </button>
      ) : (
        <div className="dr-confirm" role="alertdialog" aria-label="Confirm Accept">
          <p className="dr-lead">
            {summary}, from version {draft.version} ({shortDigest(draft.digest)}). The records go live and mirror to
            SharePoint like any other. This cannot be undone here; archive them to retire them.
          </p>
          {error && <div className="dr-banner bad">{error}</div>}
          <div className="dr-acts">
            <button type="button" className="btn acc" disabled={busy} onClick={() => void accept()}>
              {busy ? "Accepting…" : `Accept: ${summary.toLowerCase()}`}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Approvals: drafts waiting for the viewer's review ───────────────────────

/**
 * The drafts that name the viewer as a reviewer and have no review from them
 * on the current version (PRD § Reviews). Shown on the Approvals screen; it
 * renders nothing when there are none, or when drafts are off.
 */
export function DraftsToReviewPanel({ nav }: Pick<ScreenProps, "nav">) {
  const [rows, setRows] = useState<DraftRow[]>([]);
  useEffect(() => {
    let live = true;
    api<{ drafts: DraftRow[] }>("/drafts?needsMyReview=true")
      .then((data) => live && setRows(data.drafts))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (rows.length === 0) return null;
  return (
    <section className="dr-review-panel" aria-label="Drafts to review">
      <h2>
        Drafts to review <span className="count">{rows.length}</span>
      </h2>
      <ul className="dr-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="dr-row" onClick={() => nav("drafts", { draftId: row.id })}>
              <span className="id">{row.id}</span>
              <span className="dr-row-title">{row.title}</span>
              <span className="dr-row-meta">
                v{row.version} · by {row.author} · {row.tasks} tasks
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
