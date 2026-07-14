"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { api, ApiClientError } from "@/lib/api";
import type { ScreenProps } from "@/components/mc/route";
import { routingInboxEnabled } from "./flag";

type InboxScope = "personal" | "project" | "bucket" | "unrouted";

interface InboxCandidate {
  rank: number;
  taskId: string;
  bucketId: string;
  projectId: string | null;
  matchScore: number;
  authorizationTrust: string;
  reasons: string[];
}

interface InboxProposalSummary {
  id: string;
  repoId: string;
  changeId: string;
  title: string | null;
  state: string;
  failureReason: string | null;
  sessionId: string | null;
  accountableActorId: string | null;
  topCandidate: InboxCandidate | null;
  slaAgeHours: number;
  slaBreach: "none" | "alert_24h" | "expire_7d";
  derivedProjectId: string | null;
  selectedBucketId: string | null;
}

interface InboxListResponse {
  proposals: InboxProposalSummary[];
  counts: Record<InboxScope, number>;
  offline?: boolean;
}

interface InboxDetail extends InboxProposalSummary {
  hierarchy: { projectId: string | null; bucketId: string | null; taskId: string | null };
  candidates: InboxCandidate[];
  revisionId: string | null;
  overrideAvailable: boolean;
}

const SCOPE_LABELS: Record<InboxScope, string> = {
  personal: "Needs your decision",
  project: "Project-scoped",
  bucket: "Bucket-scoped",
  unrouted: "Unrouted",
};

function slaLabel(p: InboxProposalSummary): string {
  if (p.slaBreach === "expire_7d") return `${p.slaAgeHours}h · expired SLA`;
  if (p.slaBreach === "alert_24h") return `${p.slaAgeHours}h · SLA alert`;
  return `${p.slaAgeHours}h`;
}

export function RoutingInboxView({ route }: ScreenProps) {
  const tabsId = useId();
  const [scope, setScope] = useState<InboxScope>("personal");
  const [list, setList] = useState<InboxListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);

  const enabled = routingInboxEnabled();

  const loadList = useCallback((nextScope: InboxScope): Promise<void> => {
    const params = new URLSearchParams({ scope: nextScope });
    if (nextScope === "project" && route.projectId) params.set("projectId", route.projectId);
    if (nextScope === "bucket" && route.bucketId) params.set("bucketId", route.bucketId);
    return api<InboxListResponse>(`/routing/inbox?${params}`)
      .then((data) => {
        setList(data);
        setError(null);
      })
      .catch((err: Error) => {
        setError(err.message);
        setList(null);
      })
      .finally(() => setLoading(false));
  }, [route.projectId, route.bucketId]);

  const loadDetail = useCallback((id: string): Promise<void> => {
    return api<InboxDetail>(`/routing/inbox/${encodeURIComponent(id)}`)
      .then((data) => {
        setDetail(data);
        setDetailError(null);
      })
      .catch((err: Error) => {
        setDetail(null);
        setDetailError(err.message);
      });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void loadList("personal");
  }, [enabled, loadList]);

  function handleScope(next: InboxScope) {
    setScope(next);
    setLoading(true);
    setSelectedId(null);
    setDetail(null);
    void loadList(next);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setActionNote(null);
    setOverrideReason("");
    void loadDetail(id);
  }

  async function runAction(
    path: string,
    body: Record<string, unknown>,
    success: string
  ): Promise<void> {
    setBusy(true);
    setActionNote(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setActionNote(success);
      await loadList(scope);
      if (selectedId) await loadDetail(selectedId);
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : err instanceof Error ? err.message : "Action failed";
      setActionNote(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div className="mc-main" data-testid="routing-inbox-screen">
        <div className="ph">
          <div>
            <span className="kk">Routing control plane</span>
            <h1>
              Routing <em>inbox</em>
            </h1>
            <p className="sub">Disabled (PLX_MC_ROUTING_INBOX_ENABLED ≠ 1).</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-main" data-testid="routing-inbox-screen">
      <div className="ph">
        <div>
          <span className="kk">Routing control plane</span>
          <h1>
            Routing <em>inbox</em>
          </h1>
          <p className="sub">
            Confirm, change, transfer, or create Tasks for open routing proposals. Accountable humans
            decide; agents recommend.
          </p>
        </div>
      </div>

      <div className="ri-page">
        <div
          className="ri-tabs"
          role="tablist"
          aria-label="Routing inbox queues"
          id={tabsId}
        >
          {(Object.keys(SCOPE_LABELS) as InboxScope[]).map((key) => {
            const count = list?.counts[key] ?? 0;
            const selected = scope === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${tabsId}-${key}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className={`ri-tab${selected ? " active" : ""}`}
                onClick={() => handleScope(key)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  e.preventDefault();
                  const keys = Object.keys(SCOPE_LABELS) as InboxScope[];
                  const idx = keys.indexOf(key);
                  const next =
                    e.key === "ArrowRight"
                      ? keys[(idx + 1) % keys.length]
                      : keys[(idx - 1 + keys.length) % keys.length];
                  handleScope(next);
                }}
              >
                <span className="nm">{SCOPE_LABELS[key]}</span>
                <span className="ct">{count}</span>
              </button>
            );
          })}
        </div>

        {loading ? <p className="ri-note">Loading proposals…</p> : null}
        {error ? (
          <p className="ri-note warn" role="alert">
            {error}
          </p>
        ) : null}
        {list?.offline ? (
          <p className="ri-note">Routing store offline — showing empty queues.</p>
        ) : null}

        <div className="ri-split">
          <ul className="ri-list" aria-label={`${SCOPE_LABELS[scope]} proposals`}>
            {(list?.proposals ?? []).length === 0 && !loading ? (
              <li className="ri-empty">No open proposals in this queue.</li>
            ) : null}
            {(list?.proposals ?? []).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`ri-row${selectedId === p.id ? " active" : ""}`}
                  onClick={() => handleSelect(p.id)}
                  aria-current={selectedId === p.id ? "true" : undefined}
                >
                  <div className="ri-row-top">
                    <span className="ri-title">{p.title ?? p.changeId}</span>
                    <span className={`ri-sla ${p.slaBreach !== "none" ? "hot" : ""}`}>
                      {slaLabel(p)}
                    </span>
                  </div>
                  <div className="ri-meta">
                    <span>{p.repoId}</span>
                    <span>·</span>
                    <span>{p.state}</span>
                    {p.failureReason ? (
                      <>
                        <span>·</span>
                        <span className="ri-fail">{p.failureReason}</span>
                      </>
                    ) : null}
                  </div>
                  {p.topCandidate ? (
                    <div className="ri-cand">
                      Top: {p.topCandidate.taskId} ({p.topCandidate.matchScore})
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          <section
            className="ri-detail"
            aria-live="polite"
            aria-label="Proposal detail"
          >
            {!selectedId ? (
              <p className="ri-note">Select a proposal to review candidates and decide.</p>
            ) : null}
            {detailError ? (
              <p className="ri-note warn" role="alert">
                {detailError}
              </p>
            ) : null}
            {detail ? (
              <>
                <h2 className="ri-detail-title">{detail.title ?? detail.changeId}</h2>
                <dl className="ri-facts">
                  <div>
                    <dt>Repository</dt>
                    <dd>{detail.repoId}</dd>
                  </div>
                  <div>
                    <dt>Change</dt>
                    <dd>{detail.changeId}</dd>
                  </div>
                  <div>
                    <dt>Accountable</dt>
                    <dd>{detail.accountableActorId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Hierarchy</dt>
                    <dd>
                      {detail.hierarchy.projectId ?? "—"} / {detail.hierarchy.bucketId ?? "—"} /{" "}
                      {detail.hierarchy.taskId ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Failure</dt>
                    <dd>{detail.failureReason ?? "none"}</dd>
                  </div>
                  <div>
                    <dt>SLA age</dt>
                    <dd>{slaLabel(detail)}</dd>
                  </div>
                </dl>

                <h3 className="ri-subhd">Candidates</h3>
                <ol className="ri-candidates">
                  {detail.candidates.map((c) => (
                    <li key={`${c.rank}-${c.taskId}`}>
                      <div className="ri-cand-hd">
                        <strong>
                          #{c.rank} {c.taskId}
                        </strong>
                        <span>
                          {c.matchScore} · {c.authorizationTrust}
                        </span>
                      </div>
                      <div className="ri-cand-scope">
                        {c.projectId ?? "—"} → {c.bucketId}
                      </div>
                      <ul className="ri-reasons">
                        {c.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                      <div className="ri-actions">
                        <button
                          type="button"
                          className="btn acc"
                          disabled={busy}
                          onClick={() =>
                            void runAction(
                              "/routing/decide/accept",
                              {
                                proposalId: detail.id,
                                taskId: c.taskId,
                                revisionId: detail.revisionId ?? undefined,
                              },
                              `Accepted ${c.taskId}`
                            )
                          }
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={busy || !overrideReason.trim()}
                          onClick={() =>
                            void runAction(
                              "/routing/decide/change",
                              {
                                proposalId: detail.id,
                                taskId: c.taskId,
                                overrideReason: overrideReason.trim(),
                                revisionId: detail.revisionId ?? undefined,
                              },
                              `Changed to ${c.taskId}`
                            )
                          }
                        >
                          Change / override
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>

                <label className="ri-override">
                  <span>Override reason (required to change)</span>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    disabled={busy}
                  />
                </label>

                <div className="ri-actions ri-actions-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !detail.hierarchy.bucketId}
                    onClick={() =>
                      void runAction(
                        "/routing/decide/create-intent",
                        {
                          proposalId: detail.id,
                          bucketId: detail.hierarchy.bucketId,
                          title: detail.title ?? `Route ${detail.changeId}`,
                          revisionId: detail.revisionId ?? undefined,
                        },
                        "Create-intent submitted"
                      )
                    }
                  >
                    Create Task intent
                  </button>
                  {detail.sessionId ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => {
                        const branch = window.prompt("Transfer to source branch");
                        if (!branch?.trim()) return;
                        void runAction(
                          "/routing/transfer",
                          {
                            sessionId: detail.sessionId,
                            sourceBranch: branch.trim(),
                            proposalId: detail.id,
                          },
                          "Session transferred"
                        );
                      }}
                    >
                      Transfer session
                    </button>
                  ) : null}
                </div>
                {actionNote ? <p className="ri-note">{actionNote}</p> : null}
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
