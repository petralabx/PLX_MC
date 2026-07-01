"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { ACTORS, CURRENT_USER, isApprover } from "@/lib/mc-data";
import type {
  CatalogListResult,
  SkillDetailResult,
  SkillsInstallPlan,
  SkillSubmission,
  SkillSubmissionStatus,
  SkillSummaryRow,
} from "@/lib/skills-directory";

import { MarkdownReader } from "../governance-sops/views";
import {
  SKFilterState,
  applyFilters,
  catalogSubtitle,
  deriveTags,
  hasActiveFilters,
  reasonLabel,
} from "./helpers";

type ReviewTab = "submit" | "review";
type ScriptAction = "install" | "sync";

interface SyncCheckResult {
  mode: "sync";
  sourceRepo: string;
  gitRef: string;
  packageId: string;
  catalogVersion: string;
  installSkillIds: string[];
  missingSkillIds: string[];
  staleSkillIds: string[];
  drift: SkillsInstallPlan["drift"];
}

type ScriptModalState =
  | { action: ScriptAction; status: "loading" }
  | {
      action: ScriptAction;
      status: "ready";
      plan: SkillsInstallPlan;
      syncCheck?: SyncCheckResult;
      copied?: "bash" | "powershell";
    }
  | { action: ScriptAction; status: "error"; error: string };

function currentSubmitterEmail(): string {
  const actor = ACTORS[CURRENT_USER];
  return actor?.kind === "human" ? actor.email ?? "" : "";
}

function actionLabel(action: ScriptAction): string {
  return action === "install" ? "Install" : "Sync";
}

function DegradedBanner({ meta }: { meta: CatalogListResult["meta"] }) {
  if (meta.state !== "degraded") return null;
  return (
    <div className="sk-banner" role="alert">
      <span className="dot" aria-hidden />
      <span className="sk-banner-body">
        <span className="sk-banner-ct">Catalog degraded</span>
        {" — "}
        {meta.note ?? "Could not fetch manifest from GitHub."} Run{" "}
        <code className="gs-icode">scripts/bootstrap-company-skills.ps1</code> locally
        until the catalog is readable.
      </span>
    </div>
  );
}

export function IndexView({
  catalog,
  onSelect,
}: {
  catalog: CatalogListResult;
  onSelect: (row: SkillSummaryRow) => void;
}) {
  const [filter, setFilter] = useState<SKFilterState>({});
  const [tab, setTab] = useState<ReviewTab>("submit");
  const [skillId, setSkillId] = useState("");
  const [description, setDescription] = useState("");
  const [skillMarkdown, setSkillMarkdown] = useState("");
  const [submitState, setSubmitState] = useState<
    { kind: "idle" } | { kind: "submitting" } | { kind: "success"; id: string } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [submissions, setSubmissions] = useState<SkillSubmission[] | null>(null);
  const [queueState, setQueueState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const { meta, skills } = catalog;
  const tags = deriveTags(skills);
  const filtered = applyFilters(skills, filter);
  const approver = isApprover(ACTORS[CURRENT_USER]);
  const canSubmit = skillId.trim() && skillMarkdown.trim() && currentSubmitterEmail();

  async function loadReviewQueue() {
    setQueueState({ kind: "loading" });
    try {
      const rows = await api<SkillSubmission[]>("/skills-directory/submissions");
      setSubmissions(rows);
      setQueueState({ kind: "idle" });
    } catch (err) {
      setQueueState({
        kind: "error",
        message: err instanceof Error ? err.message : "Failed to load submissions",
      });
    }
  }

  function selectReviewTab(next: ReviewTab) {
    setTab(next);
    if (next === "review" && approver) {
      void loadReviewQueue();
    }
  }

  function toggleTag(tag: string) {
    const cur = filter.tags ?? [];
    const next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag];
    setFilter({ ...filter, tags: next.length ? next : undefined });
  }

  async function submitForReview() {
    const id = skillId.trim();
    const markdown = skillMarkdown.trim();
    if (!id || !markdown) return;
    setSubmitState({ kind: "submitting" });
    try {
      const created = await api<SkillSubmission>("/skills-directory/submit", {
        method: "POST",
        body: JSON.stringify({
          skillId: id,
          title: `Skill review: ${id}`,
          description: description.trim() || undefined,
          submitterEmail: currentSubmitterEmail(),
          skillMd: markdown,
        }),
      });
      setSubmitState({ kind: "success", id: created.id });
      setSkillId("");
      setDescription("");
      setSkillMarkdown("");
    } catch (err) {
      setSubmitState({ kind: "error", message: (err as Error).message });
    }
  }

  async function reviewSubmission(id: string, status: Extract<SkillSubmissionStatus, "approved" | "rejected">) {
    const label = status === "approved" ? "Approved from MC review queue." : "Rejected from MC review queue.";
    const updated = await api<SkillSubmission>(
      "/skills-directory/submissions/" + encodeURIComponent(id),
      {
        method: "PATCH",
        body: JSON.stringify({ actor: CURRENT_USER, status, reviewComment: label }),
      }
    );
    setSubmissions((rows) => rows?.map((row) => (row.id === id ? updated : row)) ?? [updated]);
  }

  return (
    <div>
      <DegradedBanner meta={meta} />

      <div className="sk-meta-strip">
        <span className="sk-meta-item">
          <span className="sk-meta-label">Source</span>
          <span className="sk-meta-value gs-mono">{catalogSubtitle(meta)}</span>
        </span>
        <span className="sk-meta-item">
          <span className="sk-meta-label">Skills</span>
          <span className="sk-meta-value">{skills.length}</span>
        </span>
        <span className="sk-meta-item">
          <span className="sk-meta-label">State</span>
          <span className={`sk-pill ${meta.state}`}>{meta.state}</span>
        </span>
      </div>

      <div className="gs-toolbar">
        <div className="gs-search">
          <span className="gs-search-mag" aria-hidden>
            ⌕
          </span>
          <input
            className="gs-search-input"
            value={filter.text ?? ""}
            placeholder="Search skills…"
            aria-label="Search skills"
            onChange={(e) => setFilter({ ...filter, text: e.target.value || undefined })}
          />
        </div>

        {tags.length > 0 && (
          <div className="gs-chips" role="group" aria-label="Filter by tag">
            {tags.map((tag) => {
              const on = filter.tags?.includes(tag) ?? false;
              return (
                <button
                  key={tag}
                  type="button"
                  className={`gs-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}

        {hasActiveFilters(filter) && (
          <button type="button" className="gs-chip clear" onClick={() => setFilter({})}>
            Clear
          </button>
        )}
      </div>

      <div className="sk-review-card">
        <div className="sk-tabs" role="tablist" aria-label="Skills review workflow">
          <button
            type="button"
            className={`sk-tab${tab === "submit" ? " on" : ""}`}
            aria-pressed={tab === "submit"}
            onClick={() => selectReviewTab("submit")}
          >
            Submit for review
          </button>
          {approver && (
            <button
              type="button"
              className={`sk-tab${tab === "review" ? " on" : ""}`}
              aria-pressed={tab === "review"}
              onClick={() => selectReviewTab("review")}
              data-testid="sk-review-tab"
            >
              Review queue
            </button>
          )}
        </div>

        {tab === "submit" && (
          <div className="sk-submit-panel" data-testid="sk-submit-panel">
            <div>
              <span className="sk-meta-label">Candidate skill</span>
              <input
                className="sk-input"
                value={skillId}
                onChange={(event) => setSkillId(event.target.value)}
                placeholder="skill-id"
                aria-label="Skill id"
              />
            </div>
            <div>
              <span className="sk-meta-label">Description</span>
              <textarea
                className="sk-textarea"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What changed and why?"
                aria-label="Skill submission description"
                rows={3}
              />
            </div>
            <div>
              <span className="sk-meta-label">SKILL.md</span>
              <textarea
                className="sk-textarea mono"
                value={skillMarkdown}
                onChange={(event) => setSkillMarkdown(event.target.value)}
                placeholder="Paste SKILL.md content here"
                aria-label="SKILL.md content"
                rows={5}
              />
            </div>
            <div className="sk-form-actions">
              <button
                type="button"
                className="btn acc sm"
                disabled={!canSubmit || submitState.kind === "submitting"}
                onClick={submitForReview}
              >
                {submitState.kind === "submitting" ? "Submitting…" : "Submit for review"}
              </button>
              {submitState.kind === "success" && (
                <span className="sk-form-ok" role="status">
                  Submission queued: <code className="gs-icode">{submitState.id}</code>
                </span>
              )}
              {submitState.kind === "error" && (
                <span className="sk-form-error" role="alert">
                  {submitState.message}
                </span>
              )}
            </div>
          </div>
        )}

        {tab === "review" && approver && (
          <div className="sk-queue-panel" data-testid="sk-review-queue">
            <div className="sk-queue-head">
              <span className="sk-meta-label">Approver-only queue</span>
              <span className="sk-meta-value">Visible through the MC approver policy.</span>
            </div>
            {queueState.kind === "loading" && <div className="gs-loading">Loading submissions…</div>}
            {queueState.kind === "error" && (
              <div className="gs-err" role="alert">
                {queueState.message}
              </div>
            )}
            {queueState.kind !== "loading" && submissions?.length === 0 && (
              <div className="gs-empty">No skill submissions yet.</div>
            )}
            {submissions && submissions.length > 0 && (
              <div className="sk-queue-list">
                {submissions.map((submission) => (
                  <div className="sk-queue-row" key={submission.id} data-testid="sk-review-row">
                    <div>
                      <span className="gs-row-title">{submission.title}</span>
                      <span className="gs-row-desc">
                        {submission.skillId} · {submission.submitterEmail}
                      </span>
                      {submission.description && (
                        <span className="gs-row-desc">{submission.description}</span>
                      )}
                    </div>
                    <span className={`sk-status ${submission.status}`}>{submission.status}</span>
                    {submission.status === "pending" && (
                      <span className="sk-review-actions">
                        <button
                          type="button"
                          className="btn acc sm"
                          onClick={() => reviewSubmission(submission.id, "approved")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => reviewSubmission(submission.id, "rejected")}
                        >
                          Reject
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="gs-empty">
          {skills.length === 0
            ? "No skills in the company allowlist."
            : "No skills match the current filters."}
        </div>
      ) : (
        <div className="gs-table-catalog" data-testid="sk-index-table">
          <div className="gs-cat-head sk-head" aria-hidden>
            <span>Skill</span>
            <span>ID</span>
            <span>Status</span>
          </div>
          {filtered.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`gs-row ${meta.state === "degraded" ? "hot" : "ok"}`}
              onClick={() => onSelect(row)}
              data-testid="sk-row"
              data-skill-id={row.id}
              data-state={meta.state}
            >
              <span className="gs-row-main">
                <span className="gs-row-top">
                  <span
                    className={`gs-dot ${meta.state === "degraded" ? "hot" : "ok"}`}
                    aria-hidden
                  />
                  <span className="gs-row-title">{row.name}</span>
                  {row.status !== "unknown" && (
                    <span className="sk-status">{row.status}</span>
                  )}
                </span>
                <span className="gs-row-desc">{row.description || row.id}</span>
                {row.tags.length > 0 && (
                  <span className="gs-row-cats">
                    {row.tags.map((t) => (
                      <span key={t} className="gs-cat">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="gs-cell gs-mono sk-id">{row.id}</span>
              <span className="gs-cell gs-mono">{row.status}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoContentPanel({ result }: { result: Extract<SkillDetailResult, { ok: false }> }) {
  return (
    <div className="gs-nocontent degraded" role="alert" data-testid="sk-nocontent">
      <div className="gs-nocontent-hd">
        <span className="gs-dot hot" aria-hidden />
        <span className="gs-nocontent-code">{reasonLabel(result.reason)}</span>
      </div>
      <p className="gs-nocontent-note">{result.note}</p>
      <p className="gs-nocontent-where">
        Allowlist: <code className="gs-icode">config/company-skills-allowlist.json</code>
      </p>
    </div>
  );
}

function ScriptModal({
  state,
  onClose,
  onCopy,
}: {
  state: ScriptModalState;
  onClose: () => void;
  onCopy: (kind: "bash" | "powershell", script: string) => void;
}) {
  const title = `${actionLabel(state.action)} company skills`;
  return (
    <div className="sk-modal-backdrop" role="presentation">
      <section className="sk-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sk-modal-head">
          <div>
            <span className="kk">Local operator script</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close script modal">
            Close
          </button>
        </div>

        {state.status === "loading" && <div className="gs-loading">Building script…</div>}
        {state.status === "error" && (
          <div className="gs-err" role="alert">
            {state.error}
          </div>
        )}
        {state.status === "ready" && (
          <>
            <div className="sk-script-meta">
              <span>
                Source <code className="gs-icode">{state.plan.sourceRepo}</code>
              </span>
              <span>
                Ref <code className="gs-icode">{state.plan.gitRef}</code>
              </span>
              <span>
                Skills <code className="gs-icode">{state.plan.installSkillIds.length}</code>
              </span>
              {state.syncCheck && (
                <span>
                  Drift <code className="gs-icode">{state.syncCheck.drift.ok ? "clean" : "changes"}</code>
                </span>
              )}
            </div>
            <div className="sk-code-grid">
              <div className="sk-code-card">
                <div className="sk-code-head">
                  <span>Bash</span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => onCopy("bash", state.plan.scripts.bash)}
                  >
                    {state.copied === "bash" ? "Copied Bash" : "Copy Bash"}
                  </button>
                </div>
                <pre className="sk-code" data-testid="sk-bash-script">
                  <code>{state.plan.scripts.bash}</code>
                </pre>
              </div>
              <div className="sk-code-card">
                <div className="sk-code-head">
                  <span>PowerShell</span>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => onCopy("powershell", state.plan.scripts.powershell)}
                  >
                    {state.copied === "powershell" ? "Copied PowerShell" : "Copy PowerShell"}
                  </button>
                </div>
                <pre className="sk-code" data-testid="sk-powershell-script">
                  <code>{state.plan.scripts.powershell}</code>
                </pre>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function DetailView({
  result,
  onBack,
}: {
  result: SkillDetailResult;
  onBack: () => void;
}) {
  const [scriptModal, setScriptModal] = useState<ScriptModalState | null>(null);

  if (!result.ok) {
    return (
      <div data-testid="sk-detail-view">
        <button type="button" className="gs-back" onClick={onBack}>
          ← Back to catalog
        </button>
        <NoContentPanel result={result} />
      </div>
    );
  }

  const { skill, toc, manifestVersion } = result;
  const hasToc = toc.length > 1;

  async function openScriptModal(action: ScriptAction) {
    setScriptModal({ action, status: "loading" });
    try {
      const syncCheck =
        action === "sync"
          ? await api<SyncCheckResult>("/skills-directory/sync-check", {
              method: "POST",
              body: JSON.stringify({}),
            })
          : undefined;
      const plan = await api<SkillsInstallPlan>("/skills-directory/install", {
        method: "POST",
        body: JSON.stringify({ mode: action }),
      });
      setScriptModal({ action, status: "ready", plan, syncCheck });
    } catch (err) {
      setScriptModal({ action, status: "error", error: (err as Error).message });
    }
  }

  async function copyScript(kind: "bash" | "powershell", script: string) {
    try {
      await navigator.clipboard.writeText(script);
    } catch {
      // Clipboard can be unavailable in hardened browsers; the script remains selectable.
    }
    setScriptModal((prev) =>
      prev && prev.status === "ready" ? { ...prev, copied: kind } : prev
    );
  }

  return (
    <div data-testid="sk-detail-view">
      <button type="button" className="gs-back" onClick={onBack}>
        ← Back to catalog
      </button>

      <div className="ph">
        <div>
          <span className="kk">Company skills · {skill.id}</span>
          <h1 className="gs-doc-title">{skill.name}</h1>
          <p className="sub">{skill.description}</p>
        </div>
        <div className="r" style={{ gap: "var(--p-space-2)", alignItems: "center" }}>
          <button
            type="button"
            className="btn acc sm"
            onClick={() => openScriptModal("install")}
            data-testid="sk-install-button"
          >
            Install
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => openScriptModal("sync")}
            data-testid="sk-sync-button"
          >
            Sync
          </button>
          <span className="sk-pill ready">published</span>
          <span className="gs-pill ro">READ-ONLY</span>
        </div>
      </div>

      <div className="gs-folio">
        <span>
          Manifest <code className="gs-icode">{manifestVersion}</code>
        </span>
        {skill.tags.length > 0 && (
          <span>
            Tags{" "}
            {skill.tags.map((t) => (
              <code key={t} className="gs-icode">
                {t}
              </code>
            ))}
          </span>
        )}
      </div>

      <div className={`gs-doc-layout${hasToc ? " has-toc" : ""}`}>
        {hasToc && (
          <nav className="gs-toc" aria-label="On this page">
            <div className="gs-toc-hd">On this page</div>
            <ol>
              {toc.map((h) => (
                <li key={h.id} className={`gs-toc-l${h.level}`}>
                  <a href={`#${h.id}`}>{h.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <MarkdownReader nodes={result.nodes} />
      </div>
      {scriptModal && (
        <ScriptModal
          state={scriptModal}
          onClose={() => setScriptModal(null)}
          onCopy={copyScript}
        />
      )}
    </div>
  );
}
