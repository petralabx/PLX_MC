import { BUCKET_IDX, PRDS, TRACE, type TraceStatus } from "@/lib/mc-data";

import type { ScreenProps } from "./route";

export interface TraceStatusView {
  rowClass: string;
  chipClass: string;
  label: string;
}

export function traceStatusView(status: TraceStatus): TraceStatusView {
  if (status === "satisfied") return { rowClass: "", chipClass: "okflag", label: "Satisfied" };
  if (status === "gap") return { rowClass: " gap", chipClass: "gapflag", label: "GAP" };
  if (status === "in-review") return { rowClass: "", chipClass: "pill info", label: "In review" };
  return { rowClass: "", chipClass: "pill muted", label: "In progress" };
}

export function TraceabilityMatrix({ nav }: ScreenProps) {
  const bucket = BUCKET_IDX[TRACE.bucket];
  const prd = bucket.prd ? PRDS[bucket.prd] : null;
  const reqText = new Map(prd?.reqs.map((req) => [req.id, req.text]) ?? []);

  return (
    <div className="mc-main">
      <div className="ph">
        <div>
          <span className="kk">Audit · {bucket.prd ?? "No PRD"}</span>
          <h1>
            Traceability <em>matrix</em>
          </h1>
          <p className="sub">
            Requirement → task(s) → PR(s) → evidence → test status → merge commit. The
            authoritative, exportable view — any unmet requirement is flagged as a GAP.
          </p>
        </div>
        <div className="r">
          <span className="trace-bucket">{bucket.name}</span>
          <button type="button" className="btn ghost" title="coming soon">
            Export ↗
          </button>
        </div>
      </div>

      <div className="matrix">
        <div className="mgrid">
          <div className="mrow head">
            <span className="h">Req</span>
            <span className="h">Requirement</span>
            <span className="h">Task(s)</span>
            <span className="h">PR(s)</span>
            <span className="h">Evidence · test</span>
            <span className="h">Merge</span>
            <span className="h">Status</span>
          </div>

          {TRACE.rows.map((row) => {
            const view = traceStatusView(row.status);
            return (
              <div className={`mrow${view.rowClass}`} key={row.req}>
                <span className="req">{row.req}</span>
                <span className="rtxt">{reqText.get(row.req) ?? "Requirement text unavailable"}</span>
                <span className="cell">
                  {row.tasks.length > 0 ? (
                    row.tasks.map((taskId) => (
                      <button
                        type="button"
                        key={taskId}
                        className="x mlink"
                        onClick={() => nav("task", { taskId })}
                      >
                        {taskId}
                      </button>
                    ))
                  ) : (
                    <span className="x muted">— none —</span>
                  )}
                </span>
                <span className="cell">
                  {row.prs.length > 0 ? (
                    row.prs.map((pr) => (
                      <span key={pr} className="x">
                        {pr}
                      </span>
                    ))
                  ) : (
                    <span className="x muted">— none —</span>
                  )}
                </span>
                <span className="cell">
                  <span className={`x${row.evidence === "incomplete" ? " muted" : ""}`}>
                    {row.evidence}
                  </span>
                  <span className={`x${row.test.includes("/") && row.test !== "11/11" ? " muted" : ""}`}>
                    {row.test}
                  </span>
                </span>
                <span className="merge">{row.merge}</span>
                <span>
                  <span className={view.chipClass}>
                    {view.chipClass.startsWith("pill") && <span className="dot" />}
                    {view.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
