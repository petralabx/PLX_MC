// Mission Control shared atoms. Presentational; consume the .mc skin classes
// from src/styles/mc-app.css. Ported from docs/product/prototype/mc-atoms.jsx.
// SHARED ACROSS SCREEN LANES — extend only at integration, never per-lane.
import type { CSSProperties, MouseEventHandler } from "react";

import { ACTORS, PRIORITY, STAGES, STAGE_IDX, confidenceOf } from "@/lib/mc-data";
import type { Health, PriorityKey, SyncRef, Task } from "@/lib/mc-data";
import { allRepos } from "@/lib/mc-data/store";

type AvatarSize = "sm" | "lg" | "xl";

export function Avatar({
  id,
  size,
  lead,
  title,
}: {
  id: string;
  size?: AvatarSize;
  lead?: boolean;
  title?: string;
}) {
  const a = ACTORS[id];
  if (!a) return null;
  const cls = ["av", a.kind, size, lead ? "lead" : ""].filter(Boolean).join(" ");
  const hover =
    title ?? (a.kind === "agent" ? `${a.name} · ${a.model} agent` : a.name);
  return (
    <span className={cls} title={hover}>
      {a.init}
    </span>
  );
}

// Periodic-table-style PLX glyph (matches the .mc .pm skin and the prototype).
export function PMark({ acc, lg }: { acc?: boolean; lg?: boolean }) {
  const cls = ["pm", lg ? "lg" : "", acc ? "acc" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls} aria-label="PLX">
      <span className="num">14</span>
      <span className="sym">Px</span>
    </span>
  );
}

// One quiet read: ready / building / gap / blocked, with an optional label.
export function Confidence({ task, showLabel = true }: { task: Task; showLabel?: boolean }) {
  const c = confidenceOf(task);
  const ringStyle = { "--pct": `${c.pct}%` } as CSSProperties;
  return (
    <span className={`conf ${c.state}`} title={`Confidence · ${c.label}`}>
      <span className="ring" style={ringStyle} />
      {showLabel && <span>{c.label}</span>}
    </span>
  );
}

export function AvatarStack({ ids, lead }: { ids: string[]; lead?: string }) {
  return (
    <span className="avstack">
      {ids.map((id) => (
        <Avatar key={id} id={id} size="sm" lead={id === lead} />
      ))}
    </span>
  );
}

// Assignee — name + kind cue (agents show their model badge). Renders a real
// <button> when interactive so it stays keyboard-accessible.
export function Assignee({
  id,
  size,
  onClick,
}: {
  id: string | null;
  size?: AvatarSize;
  onClick?: MouseEventHandler;
}) {
  if (!id) {
    return onClick ? (
      <button type="button" className="unassigned" onClick={onClick}>
        + Assign
      </button>
    ) : (
      <span className="unassigned">+ Assign</span>
    );
  }
  const a = ACTORS[id];
  if (!a) return null;
  const inner = (
    <>
      <Avatar id={id} size={size ?? "sm"} />
      <span className="nm">{a.name}</span>
      {a.kind === "agent" && <span className="tag model">{a.model}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="who" onClick={onClick} title="Reassign">
      {inner}
    </button>
  ) : (
    <span className="who">{inner}</span>
  );
}

// Sync tick — silent when synced, loud on conflict/error.
export function SyncTick({ sync, showTs = true }: { sync?: SyncRef; showTs?: boolean }) {
  if (!sync) return null;
  const map = { synced: "Synced", pending: "Pending", conflict: "Conflict", error: "Error" };
  return (
    <span className={`sync ${sync.state}`} title={`${sync.sp ?? ""}${sync.ts ? ` · ${sync.ts}` : ""}`}>
      <span className="d" />
      <span>{map[sync.state]}</span>
      {showTs && sync.state === "synced" && sync.ts !== "—" && (
        <span className="ts">· {sync.ts.split(" · ")[1] ?? sync.ts}</span>
      )}
    </span>
  );
}

// ── Chips: REQ · repo · label · estimate · priority ──────────────────────────
export function ReqChip({ id, gap }: { id: string; gap?: boolean }) {
  return <span className={`reqchip${gap ? " gap" : ""}`}>{id}</span>;
}

export function RepoChip({ id }: { id: string }) {
  // Read the runtime registry (allow-list), not the static REPOS fixture, so a
  // newly-approved repo renders by name rather than a raw id (EN-005 obs. #8).
  const r = allRepos()[id];
  return <span className="repochip">{r ? r.name : id}</span>;
}

export function Label({ text }: { text: string }) {
  return <span className="label">{text}</span>;
}

export function Estimate({ v }: { v?: string }) {
  return v ? <span className="est">{v}</span> : null;
}

export function Priority({ p }: { p: PriorityKey }) {
  const cfg = PRIORITY[p];
  if (!cfg) return null;
  return (
    <span className={`prio ${cfg.cls}`} title={`Priority · ${cfg.label}`}>
      <span className="bars">{cfg.tick}</span>
    </span>
  );
}

// ── Lifecycle mini-spine (9 segments) ────────────────────────────────────────
export function Spine({ task }: { task: Task }) {
  const idx = STAGE_IDX[task.stage];
  const cls = (i: number) => {
    if (task.stage === "verified") return i <= idx ? "done" : "";
    if (i < idx) return "done";
    if (i === idx) return `now${task.blocked ? " blocked" : ""}`;
    return "";
  };
  return (
    <div className="spine" title={`${STAGES[idx].n} · ${STAGES[idx].name}`}>
      {STAGES.map((s, i) => (
        <span key={s.key} className={cls(i)} />
      ))}
    </div>
  );
}

// ── Slate placeholder (film-slate, never a stock/AI image) ───────────────────
export function Slate({ label, cap }: { label?: string; cap?: string }) {
  return (
    <div className="slate">
      <span className="cross" />
      {label && <span className="lb">{label}</span>}
      {cap && <span className="cap">{cap}</span>}
    </div>
  );
}

// ── Health pill for buckets ───────────────────────────────────────────────────
export const BUCKET_HEALTH: Record<Health, { cls: string; label: string }> = {
  track: { cls: "ok", label: "On track" },
  risk: { cls: "warn", label: "At risk" },
  off: { cls: "hot", label: "Off track" },
};

export function HealthPill({ h }: { h: Health }) {
  const cfg = BUCKET_HEALTH[h] ?? BUCKET_HEALTH.track;
  return (
    <span className={`pill ${cfg.cls}`}>
      <span className="dot" />
      {cfg.label}
    </span>
  );
}
