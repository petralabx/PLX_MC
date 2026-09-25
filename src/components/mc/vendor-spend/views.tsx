"use client";

// Presentational sub-views for the AI Spend screen: overview (stats, period
// filter, vendor table) and vendor detail (health, budget editor, manual
// snapshot entry, history). Data arrives as props; mutations go through the
// shared api() wrapper and report back via onMutated.

import { useState } from "react";

import { api } from "@/lib/api";
import { viewerId } from "@/lib/mc-data/store";
import type {
  SpendPeriod,
  VendorSpendDetail,
  VendorSpendIndex,
  VendorSpendRow,
} from "@/lib/vendor-spend";

import {
  alertLabel,
  alertTone,
  fmtMoney,
  fmtPct,
  fmtStamp,
  parseDollarsToCents,
  PERIOD_LABELS,
  PERIOD_ORDER,
  sourceLabel,
  sourceTone,
} from "./helpers";

// ─── Shared tiny components ───────────────────────────────────────────────────

function AlertPill({ row }: { row: VendorSpendRow }) {
  return <span className={`vs-hpill ${alertTone(row.alert)}`}>{alertLabel(row.alert)}</span>;
}

function SourcePill({ row }: { row: VendorSpendRow }) {
  return (
    <span className={`vs-hpill ${sourceTone(row.sourceStatus)}`}>
      {sourceLabel(row.sourceStatus)}
    </span>
  );
}

/** Text + hairline utilization bar. The bar is presentational (aria-hidden). */
function UtilizationCell({ row }: { row: VendorSpendRow }) {
  if (row.utilization === null) return <span className="vs-mono vs-dim">—</span>;
  const pct = Math.min(100, Math.round(row.utilization * 100));
  const tone = alertTone(row.alert);
  return (
    <span className="vs-util">
      <span className="vs-mono">{fmtPct(row.utilization)}</span>
      <span className="vs-util-track" aria-hidden>
        <span className={`vs-util-fill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function StatCard({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="vs-stat">
      <span className={`vs-stat-n${tone ? ` ${tone}` : ""}`}>{value}</span>
      <span className="vs-stat-label">{label}</span>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

export function OverviewView({
  index,
  period,
  onPeriod,
  onSelect,
}: {
  index: VendorSpendIndex;
  period: SpendPeriod;
  onPeriod: (p: SpendPeriod) => void;
  onSelect: (vendorId: string) => void;
}) {
  const alerting = index.totals.warn + index.totals.critical + index.totals.over;
  const degradedRows = index.rows.filter((r) => r.sourceStatus === "degraded");

  return (
    <div>
      {/* Alert banner — only when a budget threshold is crossed */}
      {alerting > 0 && (
        <div className="vs-banner" role="status">
          <span className="dot" aria-hidden />
          <span className="vs-banner-body">
            {index.totals.over > 0 && (
              <>
                <span className="vs-banner-ct">{index.totals.over} over budget</span>
                {(index.totals.critical > 0 || index.totals.warn > 0) && " · "}
              </>
            )}
            {index.totals.critical > 0 && (
              <>
                <span className="vs-banner-ct">{index.totals.critical} critical</span>
                {index.totals.warn > 0 && " · "}
              </>
            )}
            {index.totals.warn > 0 && <span className="vs-banner-ct">{index.totals.warn} at warn</span>}
            {" "}— review budgets before month close
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="vs-stats">
        <StatCard label={`Spend · ${PERIOD_LABELS[period]}`} value={fmtMoney(index.totals.spendCents)} />
        <StatCard
          label="Budgeted spend / budget"
          value={
            index.totals.periodBudgetCents > 0
              ? `${fmtMoney(index.totals.budgetedSpendCents)} / ${fmtMoney(index.totals.periodBudgetCents)}`
              : "no budgets set"
          }
        />
        <StatCard label="Alerting" value={String(alerting)} tone={alerting > 0 ? "hot" : ""} />
        <StatCard
          label="Degraded sources"
          value={String(degradedRows.length)}
          tone={degradedRows.length > 0 ? "warn" : ""}
        />
      </div>

      {/* Period filter */}
      <div className="vs-toolbar">
        <div className="vs-tabs" role="tablist" aria-label="Spend period">
          {PERIOD_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={period === p}
              className={`vs-tab${period === p ? " on" : ""}`}
              onClick={() => onPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <span className="vs-sort-hint">
          {index.period.start} → {index.period.end} · sort ↓ scariest-first
        </span>
      </div>

      {/* Vendor table */}
      <div className="vs-table" data-testid="vs-table">
        <div className="vs-table-head" aria-hidden>
          <span>Vendor</span>
          <span>Source</span>
          <span>Spend</span>
          <span>Budget</span>
          <span>Used</span>
          <span>Status</span>
        </div>
        {index.rows.map((row) => (
          <button
            key={row.vendor.id}
            type="button"
            className={`vs-row${row.sourceStatus === "degraded" ? " degraded" : ""}`}
            onClick={() => onSelect(row.vendor.id)}
            data-testid="vs-row"
            data-vendor={row.vendor.id}
            data-alert={row.alert}
            data-source={row.sourceStatus}
          >
            <span className="vs-row-nm">
              <span className={`vs-row-dot ${sourceTone(row.sourceStatus)}`} aria-hidden />
              <span>
                <span className="vs-row-title">{row.vendor.name}</span>
                <span className="vs-row-sub"> · {row.vendor.category}</span>
              </span>
            </span>
            <span className="vs-cell">
              <SourcePill row={row} />
            </span>
            <span className="vs-cell vs-mono">
              {fmtMoney(row.spendCents)}
              {row.estimated && (
                <span className="vs-est" title="Includes upstream estimates (not closed books)">
                  {" "}
                  est
                </span>
              )}
            </span>
            <span className="vs-cell vs-mono">
              {row.periodBudgetCents !== null ? fmtMoney(row.periodBudgetCents) : "—"}
            </span>
            <span className="vs-cell">
              <UtilizationCell row={row} />
            </span>
            <span className="vs-cell">
              <AlertPill row={row} />
            </span>
          </button>
        ))}
      </div>

      {/* Agent recommendations — recommend-only in v1, honest placeholder */}
      <div className="vs-agent-stub">
        <span className="vs-agent-stub-hd">Agent recommendations</span>
        <p>
          Read-only in v1 — agents will surface spend anomalies and budget suggestions here.
          No autonomous actions (config changes, throttling, task creation) are wired.
        </p>
      </div>
    </div>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

export function DetailView({
  detail,
  period,
  onBack,
  onMutated,
}: {
  detail: VendorSpendDetail;
  period: SpendPeriod;
  onBack: () => void;
  onMutated: () => Promise<void>;
}) {
  const { row, snapshots, refreshLog } = detail;
  return (
    <div data-testid="vs-detail">
      <button type="button" className="vs-back" onClick={onBack}>
        ← Back to all vendors
      </button>

      <div className="ph vs-detail-ph">
        <div>
          <span className="kk">
            Vendor · {row.vendor.category} · {PERIOD_LABELS[period]}
          </span>
          <h1 className="vs-detail-h1">{row.vendor.name}</h1>
        </div>
        <div className="r r-gap-2">
          <SourcePill row={row} />
          <AlertPill row={row} />
          {row.vendor.console_url && (
            <a
              className="vs-console-link"
              href={row.vendor.console_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              ↗ Vendor console
            </a>
          )}
        </div>
      </div>

      {/* Meta strip */}
      <div className="vs-meta">
        <span className="vs-meta-chip">
          Spend: <strong className="vs-mono">{fmtMoney(row.spendCents)}</strong>
          {row.estimated && <span className="vs-est"> est</span>}
        </span>
        <span className="vs-meta-chip">
          Period budget:{" "}
          <strong className="vs-mono">
            {row.periodBudgetCents !== null ? fmtMoney(row.periodBudgetCents) : "not set"}
          </strong>
        </span>
        <span className="vs-meta-chip">
          Used: <strong className="vs-mono">{fmtPct(row.utilization)}</strong>
        </span>
        {row.budget && (
          <span className="vs-meta-chip">
            Monthly budget:{" "}
            <strong className="vs-mono">{fmtMoney(row.budget.monthlyBudgetCents)}</strong>
          </span>
        )}
        {row.lastRefresh && (
          <span className="vs-meta-chip">
            Last pull: <strong>{fmtStamp(row.lastRefresh.createdAt)}</strong>
          </span>
        )}
      </div>

      {/* Degraded panel — loud, names the missing secret */}
      {row.sourceStatus === "degraded" && (
        <div className="vs-degraded" role="alert" data-testid="vs-degraded-panel">
          <span className="vs-degraded-code">[{row.degradedReason ?? "degraded"}]</span>{" "}
          {row.degradedNote}
          {row.degradedReason === "key_missing" && (
            <span className="vs-degraded-hint">
              {" "}
              Add the admin key to AWS Secrets Manager (prod/ec2-secrets) to enable automated
              pulls; manual entry below keeps working meanwhile.
            </span>
          )}
        </div>
      )}
      {row.vendor.notes && <p className="vs-vendor-notes">{row.vendor.notes}</p>}

      <div className="vs-forms">
        <BudgetEditor row={row} onMutated={onMutated} />
        <ManualSnapshotForm vendorId={row.vendor.id} onMutated={onMutated} />
      </div>

      {/* Snapshot history */}
      <h2 className="vs-h2">Cost snapshots · {PERIOD_LABELS[period]}</h2>
      {snapshots.length === 0 ? (
        <div className="vs-empty-strip">
          No cost snapshots in this period —{" "}
          {row.sourceStatus === "manual"
            ? "add one manually from the vendor invoice."
            : "run a refresh or add a manual entry."}
        </div>
      ) : (
        <div
          className="vs-snaps"
          tabIndex={0}
          role="group"
          aria-label="Cost snapshots (scrolls on narrow screens)"
        >
          <div className="vs-snaps-head" aria-hidden>
            <span>Window</span>
            <span>Amount</span>
            <span>Source</span>
            <span>Entered by</span>
            <span>Note</span>
          </div>
          {snapshots.map((s) => (
            <div key={s.id} className="vs-snap-row">
              <span className="vs-mono">
                {s.periodStart} → {s.periodEnd}
              </span>
              <span className="vs-mono">
                {fmtMoney(s.amountCents)}
                {s.estimated && <span className="vs-est"> est</span>}
              </span>
              <span className="vs-mono vs-dim">{s.source}</span>
              <span className="vs-dim">{s.enteredBy ?? "—"}</span>
              <span className="vs-dim vs-clip">{s.note ?? "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Refresh audit log */}
      {refreshLog.length > 0 && (
        <>
          <h2 className="vs-h2">Refresh log</h2>
          <div className="vs-log">
            {refreshLog.map((entry) => (
              <div key={entry.id} className={`vs-log-row ${entry.status}`}>
                <span className="vs-mono vs-dim">{fmtStamp(entry.createdAt)}</span>
                <span className={`vs-hpill ${entry.status === "ok" ? "ok" : "hot"}`}>
                  {entry.status.toUpperCase()}
                </span>
                <span className="vs-dim vs-clip">
                  {entry.message ?? `${entry.snapshotCount} snapshot(s) written`}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Budget editor ────────────────────────────────────────────────────────────

function BudgetEditor({
  row,
  onMutated,
}: {
  row: VendorSpendRow;
  onMutated: () => Promise<void>;
}) {
  const [dollars, setDollars] = useState(
    row.budget ? (row.budget.monthlyBudgetCents / 100).toFixed(2) : ""
  );
  const [warnPct, setWarnPct] = useState(String(Math.round((row.budget?.warnPct ?? 0.8) * 100)));
  const [criticalPct, setCriticalPct] = useState(
    String(Math.round((row.budget?.criticalPct ?? 0.95) * 100))
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function save() {
    const cents = parseDollarsToCents(dollars);
    const warn = Number(warnPct) / 100;
    const critical = Number(criticalPct) / 100;
    if (cents === null) {
      setMsg({ tone: "err", text: "Enter the monthly budget in dollars, e.g. 1500 or 1500.00." });
      return;
    }
    if (!(warn > 0 && warn <= 1) || !(critical > 0 && critical <= 1) || critical < warn) {
      setMsg({ tone: "err", text: "Thresholds must be 1–100% with critical ≥ warn." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/vendor-spend/budgets", {
        method: "PATCH",
        body: JSON.stringify({
          vendorId: row.vendor.id,
          monthlyBudgetCents: cents,
          warnPct: warn,
          criticalPct: critical,
          updatedBy: viewerId(),
        }),
      });
      setMsg({ tone: "ok", text: "Budget saved." });
      await onMutated();
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vs-form-card" data-testid="vs-budget-editor">
      <span className="vs-form-hd">Monthly budget</span>
      <div className="vs-form-grid">
        <label className="vs-field">
          <span className="vs-field-label">Budget (USD / month)</span>
          <input
            className="vs-input"
            inputMode="decimal"
            placeholder="e.g. 1500.00"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
          />
        </label>
        <label className="vs-field">
          <span className="vs-field-label">Warn at (%)</span>
          <input
            className="vs-input"
            inputMode="numeric"
            value={warnPct}
            onChange={(e) => setWarnPct(e.target.value)}
          />
        </label>
        <label className="vs-field">
          <span className="vs-field-label">Critical at (%)</span>
          <input
            className="vs-input"
            inputMode="numeric"
            value={criticalPct}
            onChange={(e) => setCriticalPct(e.target.value)}
          />
        </label>
      </div>
      <div className="vs-form-actions">
        <button type="button" className="vs-btn" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save budget"}
        </button>
        {msg && <span className={msg.tone === "ok" ? "vs-form-ok" : "vs-form-err"}>{msg.text}</span>}
      </div>
    </div>
  );
}

// ─── Manual snapshot form ─────────────────────────────────────────────────────

function ManualSnapshotForm({
  vendorId,
  onMutated,
}: {
  vendorId: string;
  onMutated: () => Promise<void>;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [dollars, setDollars] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function submit() {
    const cents = parseDollarsToCents(dollars);
    if (cents === null) {
      setMsg({ tone: "err", text: "Enter the amount in dollars, e.g. 129.99." });
      return;
    }
    if (!start || !end || end <= start) {
      setMsg({ tone: "err", text: "Pick a start and an end date (end is exclusive, after start)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api("/vendor-spend/snapshots", {
        method: "POST",
        body: JSON.stringify({
          vendorId,
          periodStart: start,
          periodEnd: end,
          amountCents: cents,
          enteredBy: viewerId(),
          note: note || undefined,
        }),
      });
      setMsg({ tone: "ok", text: "Snapshot recorded." });
      setDollars("");
      setNote("");
      await onMutated();
    } catch (err) {
      setMsg({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="vs-form-card" data-testid="vs-manual-form">
      <span className="vs-form-hd">Manual cost entry</span>
      <div className="vs-form-grid">
        <label className="vs-field">
          <span className="vs-field-label">From (inclusive)</span>
          <input
            className="vs-input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="vs-field">
          <span className="vs-field-label">To (exclusive)</span>
          <input
            className="vs-input"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <label className="vs-field">
          <span className="vs-field-label">Amount (USD)</span>
          <input
            className="vs-input"
            inputMode="decimal"
            placeholder="e.g. 129.99"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
          />
        </label>
        <label className="vs-field vs-field-wide">
          <span className="vs-field-label">Note (invoice ref, plan name…)</span>
          <input
            className="vs-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="vs-form-actions">
        <button type="button" className="vs-btn" onClick={submit} disabled={busy}>
          {busy ? "Recording…" : "Record cost"}
        </button>
        {msg && <span className={msg.tone === "ok" ? "vs-form-ok" : "vs-form-err"}>{msg.text}</span>}
      </div>
    </div>
  );
}
