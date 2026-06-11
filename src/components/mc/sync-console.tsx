"use client";

import { useMemo, useState } from "react";

import { SP_CADENCE, SP_SITE } from "@/lib/mc-data";
import { useMcVersion } from "@/lib/mc-data/hooks";
import {
  actorById,
  auditLog,
  lastSweep,
  markAllSynced,
  openConflicts,
  openErrors,
  resolveConflict,
  retryError,
  spLists,
  storeSyncCounts,
} from "@/lib/mc-data/store";

import { Avatar } from "./atoms";
import { directionGlyph, directionLabel } from "./record-logic";
import type { ScreenProps } from "./route";

export function SyncConsole({ nav }: ScreenProps) {
  useMcVersion();
  const lists = spLists();
  const conflicts = openConflicts();
  const errors = openErrors();
  const audit = auditLog();
  const counts = storeSyncCounts();
  const unresolved = counts.conflict + counts.error;
  const needsAttention = unresolved + counts.pending;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const first = lists[0]?.key;
    return first ? { [first]: true } : {};
  });

  const listByKey = useMemo(() => {
    return new Map(lists.map((list) => [list.key, list]));
  }, [lists]);

  // markAllSynced triggers a real engine sweep (outbound push + inbound
  // delta) and adopts the result; the old demo inbound simulation is gone.
  const onSyncNow = () => {
    markAllSynced();
  };

  const overallClass = unresolved > 0 ? "warn" : counts.pending > 0 ? "pending" : "";
  const overallLabel =
    unresolved > 0
      ? `${unresolved} to resolve`
      : counts.pending > 0
        ? `${counts.pending} pending`
        : "All aligned";

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">System of record · SharePoint mirror</span>
          <h1>
            Sync <em>console</em>
          </h1>
          <p className="sub">
            Every register stays aligned both ways with the canonical SharePoint site. Edits flow in
            both directions; contested changes land in the review queue for manual resolution.
          </p>
        </div>
        <div className="r">
          <span className={`sync ${overallClass}`}>
            <span className="d" />
            {overallLabel}
          </span>
          <button type="button" className="btn acc" onClick={onSyncNow}>
            Sync now ↻
          </button>
        </div>
      </div>

      <div className="sync-page">
        <div className="spsite">
          <div className="l">
            <span className={`dotc ${SP_SITE.connected ? "ok" : "off"}`} />
            <div>
              <div className="nm">{SP_SITE.name}</div>
              <div className="url">
                {SP_SITE.host}
                {SP_SITE.path}
              </div>
            </div>
          </div>
          <div className="r">
            <div className="f">
              <span className="k">Connection</span>
              <span className="v">{SP_SITE.connected ? "Connected · Microsoft 365" : "Disconnected"}</span>
            </div>
            <div className="f">
              <span className="k">Cadence</span>
              <span className="v">{SP_CADENCE}</span>
            </div>
            <div className="f">
              <span className="k">Last sweep</span>
              <span className="v">{lastSweep()}</span>
            </div>
            <div className="f">
              <span className="k">Timezone</span>
              <span className="v">{SP_SITE.tz}</span>
            </div>
          </div>
        </div>

        <div className="bh sec">
          <span className="kk">/ Registers · {lists.length} mapped</span>
          <span className="kk">Mission Control ↔ SharePoint</span>
        </div>
        <div className="spregs">
          {lists.map((list) => {
            const isOpen = !!expanded[list.key];
            const total =
              list.counts.synced + list.counts.pending + list.counts.conflict + list.counts.error;
            return (
              <div className="spreg" key={list.key}>
                <button
                  type="button"
                  className="spreg-head"
                  onClick={() => setExpanded((prev) => ({ ...prev, [list.key]: !isOpen }))}
                >
                  <span className="ic">{list.icon}</span>
                  <span className="t">
                    <span className="nm">
                      {list.title}
                      <span className="kind">{list.kind}</span>
                    </span>
                    <span className="map">
                      {directionGlyph(list.direction)} {list.maps}
                    </span>
                  </span>
                  <span className="cts">
                    <span className="ct ok">
                      <b>{list.counts.synced}</b> synced
                    </span>
                    {list.counts.pending > 0 && (
                      <span className="ct pending">
                        <b>{list.counts.pending}</b> pending
                      </span>
                    )}
                    {list.counts.conflict > 0 && (
                      <span className="ct conflict">
                        <b>{list.counts.conflict}</b> conflict
                      </span>
                    )}
                    {list.counts.error > 0 && (
                      <span className="ct error">
                        <b>{list.counts.error}</b> error
                      </span>
                    )}
                  </span>
                  <span className="chev">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div className="spreg-body">
                    <div className="spmeta">
                      <span>
                        <b>{total}</b> items
                      </span>
                      <span>{directionLabel(list.direction)}</span>
                      <span>Last sync {list.lastSync}</span>
                      {list.folders && <span>Folders {list.folders}</span>}
                    </div>
                    <table className="spmap">
                      <thead>
                        <tr>
                          <th>Mission Control field</th>
                          <th className="d" />
                          <th>SharePoint column</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.columns.map((column) => (
                          <tr key={column.name}>
                            <td className="mcf">{column.mc}</td>
                            <td className="d" title={directionLabel(column.dir)}>
                              {directionGlyph(column.dir)}
                            </td>
                            <td className="spc">
                              {column.name}
                              {column.required && <span className="req">required</span>}
                            </td>
                            <td className="ty">
                              {column.type}
                              {column.note && <span className="note"> · {column.note}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="bh sec">
          <span className="kk">/ Review queue · {conflicts.length + errors.length}</span>
          <span className="kk">A human picks the winner</span>
        </div>
        {conflicts.length === 0 && errors.length === 0 && (
          <div className="colempty">Nothing to resolve — every record is aligned.</div>
        )}
        {conflicts.map((conflict) => {
          const source = listByKey.get(conflict.list);
          const actor = actorById(conflict.by);
          return (
            <div className="conflict-row" key={conflict.id}>
              <div className="ch">
                <span className="t">
                  Conflict · {conflict.entityId} {conflict.field}
                </span>
                <span className="x">{source?.title ?? conflict.list}</span>
              </div>
              <div className="cb">
                <div className="side">
                  <div className="k">Mission Control</div>
                  <div className="v">{conflict.mcVal}</div>
                </div>
                <div className="side">
                  <div className="k">SharePoint</div>
                  <div className="v">{conflict.spVal}</div>
                </div>
              </div>
              <div className="cf">
                <span className="cfnote">
                  {conflict.note} · {actor?.name ?? conflict.by} · {conflict.detected}
                </span>
                {conflict.entity === "Task" && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => nav("task", { taskId: conflict.entityId })}
                  >
                    Open task →
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => resolveConflict(conflict.id, "mc")}
                >
                  Keep Mission Control
                </button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => resolveConflict(conflict.id, "sp")}
                >
                  Keep SharePoint
                </button>
              </div>
            </div>
          );
        })}
        {errors.map((error) => {
          const source = listByKey.get(error.list);
          return (
            <div className="conflict-row error" key={error.id}>
              <div className="ch">
                <span className="t">
                  Push error · {error.entityId} {error.field}
                </span>
                <span className="x">{source?.title ?? error.list}</span>
              </div>
              <div className="side">
                <div className="k">Reason</div>
                <div className="v reason">{error.reason}</div>
              </div>
              <div className="cf">
                <button type="button" className="btn ghost sm" title="coming soon">
                  Edit value
                </button>
                <button type="button" className="btn ghost sm" onClick={() => retryError(error.id)}>
                  Retry push
                </button>
              </div>
            </div>
          );
        })}

        <div className="bh sec">
          <span className="kk">/ Sync audit log</span>
          <span className="kk">{needsAttention} need attention</span>
        </div>
        <div className="auditlog">
          {audit.map((row, idx) => {
            const actor = actorById(row.actor);
            return (
              <div className="arow" key={`${row.ts}-${idx}`}>
                <span className="ts">{row.ts}</span>
                <span>{actor ? <Avatar id={actor.id} size="sm" /> : null}</span>
                <span className="body">
                  <b>{actor?.name ?? row.actor}</b> · {row.body}
                </span>
                <span className={`sync ${row.state}`}>
                  <span className="d" />
                  {row.state}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
