// Wave 2 — UI trust: the Approvals inbox showed an auth error AND "No pending
// approvals" at once (a failed load set rows to []). It now has exactly one of
// four states — loading / error-with-retry / empty / list — across the
// sources a tab needs (TASK-3721 merged questions and gates into one queue).
// No DOM environment (vitest runs in Node), so states are rendered with
// renderToStaticMarkup.
import type { ApprovalGate, ApprovalScope } from "@/lib/mc-data";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ApprovalApproveButton,
  ApprovalDecisionScope,
  ApprovalsInboxView,
  ApprovalsQueue,
  ApprovalsStatus,
  CreatorApprovalsPanel,
  GateSheet,
  approvalEvidenceLabel,
  approvalScopeFields,
  approvalScopeText,
  type PendingApprovalRow,
  type PendingCreatorApprovalRow,
} from "@/components/mc/approvals-inbox";
import {
  REJECT_NOTE_REQUIRED,
  forMeItems,
  groupByTask,
  queueView,
  raisedByViewer,
  rejectNoteError,
  type QueueItem,
  type SourceLoad,
} from "@/components/mc/approvals-inbox.helpers";
import { viewerTokens } from "@/components/mc/needs-me";

const EMPTY_COPY = "No pending approvals";
const ROW: PendingApprovalRow = {
  taskId: "TASK-221",
  taskTitle: "WMS integration",
  stage: "progress",
  gate: {
    id: "gate-1",
    reason: "Needs a prod credential",
    requestedBy: "vibes",
    requestedAt: "2026-09-25T12:00:00Z",
    status: "pending",
  },
};

const gateItem = (row: PendingApprovalRow = ROW) =>
  forMeItems([], [row])[0] as Extract<QueueItem, { kind: "gate" }>;

const gateSheet = (row: PendingApprovalRow, extra: Partial<Parameters<typeof GateSheet>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(GateSheet, {
      item: gateItem(row),
      nav: () => {},
      raisedByMe: false,
      note: "",
      noteError: null,
      busy: false,
      error: null,
      onNote: () => {},
      onApprove: () => {},
      onReject: () => {},
      ...extra,
    })
  );

const status = (loads: SourceLoad<unknown>[], rowCount = 0) =>
  renderToStaticMarkup(createElement(ApprovalsStatus, { loads, rowCount, onRetry: () => {} }));

const READY_EMPTY: SourceLoad<unknown> = { status: "ready", data: [] };
const FAILED: SourceLoad<unknown> = { status: "error", message: "No signed-in session found." };

describe("queueView — exactly one state", () => {
  it("maps each load outcome to a single view", () => {
    expect(queueView([{ status: "loading" }, READY_EMPTY], 0)).toBe("loading");
    expect(queueView([{ status: "idle" }], 0)).toBe("loading");
    expect(queueView([FAILED], 0)).toBe("error");
    expect(queueView([READY_EMPTY, READY_EMPTY], 0)).toBe("empty");
    expect(queueView([READY_EMPTY], 2)).toBe("list");
  });

  it("a failure with nothing else to show is an error — never the empty state", () => {
    expect(queueView([FAILED, READY_EMPTY], 0)).toBe("error");
    // The other source still lists its rows; the failure shows above them.
    expect(queueView([FAILED, READY_EMPTY], 3)).toBe("list");
  });
});

describe("ApprovalsStatus rendering", () => {
  it("a failed load shows the error with Retry — and never the empty state", () => {
    const html = status([FAILED, READY_EMPTY]);
    expect(html).toContain("No signed-in session found.");
    expect(html).toContain("Retry");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("Loading");
  });

  it("loading shows only the loading state", () => {
    const html = status([{ status: "loading" }, READY_EMPTY]);
    expect(html).toContain("Loading");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("Retry");
  });

  it("renders nothing of its own when every source loaded (the queue owns the view)", () => {
    expect(status([READY_EMPTY, READY_EMPTY])).toBe("");
    expect(status([READY_EMPTY], 2)).toBe("");
  });

  it("an empty queue shows only the empty state", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsQueue, {
        groups: [],
        selectedId: null,
        title: "0 open · 0 tasks",
        emptyText: "No pending approvals.",
        projectNameOf: null,
        who: null,
        drafts: {},
        nowMs: 0,
        onSelect: () => {},
      })
    );
    expect(html).toContain(EMPTY_COPY);
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Loading");
  });

  it("the screen's first paint is the loading state alone", () => {
    const html = renderToStaticMarkup(
      createElement(ApprovalsInboxView, { route: { screen: "approvals" }, nav: () => {} })
    );
    expect(html).toContain("Loading");
    expect(html).not.toContain(EMPTY_COPY);
    expect(html).not.toContain("ap-error");
    expect(html).toContain('data-testid="approvals-screen"');
    // The shared page-header hooks e2e specs wait on (LESSONS 2026-10-17, TASK-3175).
    expect(html).toMatch(/class="ph ap-head"/);
    expect(html).toContain('class="kk"');
  });
});

describe("approval evidence link", () => {
  it("names the link from the task's existing evidence summary", () => {
    expect(approvalEvidenceLabel({ ...ROW, evidence: { summary: "Proof bundle", itemKeys: ["qa"] } })).toBe(
      "Evidence: Proof bundle"
    );
    expect(approvalEvidenceLabel(ROW)).toBe("Evidence for TASK-221");
  });

  it("puts an evidence link in every gate's record", () => {
    const withBundle = gateSheet({ ...ROW, evidence: { summary: "Proof bundle", itemKeys: ["qa"] } });
    expect(withBundle).toContain('href="/?screen=task&amp;taskId=TASK-221&amp;focus=evidence"');
    expect(withBundle).toContain('aria-label="Evidence: Proof bundle"');

    const withoutBundle = gateSheet(ROW);
    expect(withoutBundle).toContain('href="/?screen=task&amp;taskId=TASK-221&amp;focus=evidence"');
    expect(withoutBundle).toContain('aria-label="Evidence for TASK-221"');
  });
});

describe("signed approval scope on the decision surface", () => {
  const scopes: ApprovalScope[] = [
    { kind: "launch", lane: "codex/coding-1", promptHash: "b".repeat(64) },
    { kind: "merge", repo: "petralabx/PLX_MC", pr: 385, headSha: "a".repeat(40) },
    { kind: "flags", flags: ["override-one", "override-two"] },
  ];
  // The "What you are approving" block, up to "Where it came from".
  const scopeBlock = (html: string) =>
    html.slice(html.indexOf('data-testid="approval-scope"'), html.indexOf("Where it came from"));

  it.each(scopes)("shows every field in $kind scope and its source before enabling approval", (scope) => {
    const gate: ApprovalGate = { ...ROW.gate, scope, sourceRef: "https://example.com/ticket/385" };
    const html = gateSheet({ ...ROW, gate });
    expect(approvalScopeText(gate)).toBe(JSON.stringify(scope, null, 2));
    const block = scopeBlock(html);
    for (const value of Object.values(scope).flat()) {
      if (value === scope.kind) continue;
      expect(block).toContain(String(value));
    }
    expect(html).toContain(gate.sourceRef);
    expect(block).not.toContain("<details");
    const button = renderToStaticMarkup(createElement(ApprovalApproveButton, { gate, busy: false, onApprove: () => {} }));
    expect(button).not.toContain("disabled");
  });

  it("names the fields a person approves for each kind", () => {
    const labels = (scope: ApprovalScope) => approvalScopeFields(scope)?.map((f) => `${f.label}: ${f.value}`);
    expect(labels(scopes[1])).toEqual([
      "Kind: Merge",
      "Repository: petralabx/PLX_MC",
      "Pull request: #385",
      `Head commit: ${"a".repeat(40)}`,
    ]);
    expect(labels(scopes[0])).toEqual(["Kind: Launch", "Lane: codex/coding-1", `Prompt hash: ${"b".repeat(64)}`]);
    expect(labels(scopes[2])).toEqual(["Kind: Flags", "Flags: override-one, override-two"]);
    expect(gateSheet({ ...ROW, gate: { ...ROW.gate, scope: scopes[1] } })).toContain(
      "Covers this head commit only. A new push needs a new approval."
    );
  });

  it("disables approval if a scoped gate cannot render its scope", () => {
    const gate = { ...ROW.gate, scope: { kind: "future-scope" } } as unknown as ApprovalGate;
    expect(approvalScopeText(gate)).toBeNull();
    expect(renderToStaticMarkup(createElement(ApprovalDecisionScope, { gate }))).toContain("Approval is unavailable");
    expect(renderToStaticMarkup(createElement(ApprovalApproveButton, { gate, busy: false, onApprove: () => {} }))).toContain("disabled");
  });

  it("fails closed on a known kind with a field it would not show, or a mistyped field", () => {
    const extra = { ...ROW.gate, scope: { kind: "merge", repo: "r", pr: 1, headSha: "abc", force: true } } as unknown as ApprovalGate;
    const mistyped = { ...ROW.gate, scope: { kind: "merge", repo: "r", pr: "1", headSha: "abc" } } as unknown as ApprovalGate;
    for (const gate of [extra, mistyped]) {
      expect(approvalScopeFields(gate.scope!)).toBeNull();
      expect(renderToStaticMarkup(createElement(ApprovalDecisionScope, { gate }))).toContain("Approval is unavailable");
      expect(renderToStaticMarkup(createElement(ApprovalApproveButton, { gate, busy: false, onApprove: () => {} }))).toContain(
        "disabled"
      );
    }
  });

  it("keeps the plan and diff in the approval-proposal details, and only when there is one", () => {
    const withPlan = gateSheet({
      ...ROW,
      gate: { ...ROW.gate, proposal: { summary: "Merge the fix", plan: "1. merge\n2. verify", risk: "critical" } },
    });
    expect(withPlan).toContain('data-testid="approval-proposal"');
    expect(withPlan).toContain("1. merge");
    expect(withPlan).toContain("Merge the fix");
    expect(withPlan).toMatch(/ap-pill is-ink[^>]*>.*Risk critical/);
    const summaryOnly = gateSheet({ ...ROW, gate: { ...ROW.gate, proposal: { summary: "Merge the fix" } } });
    expect(summaryOnly).not.toContain('data-testid="approval-proposal"');
  });
});

describe("separation of duties on the gate sheet", () => {
  it("matches the viewer's id or email to the requester in any case", () => {
    const me = viewerTokens({ id: "vince", email: "Vince@PetraSoap.com" });
    expect(raisedByViewer({ requestedBy: "VINCE@petrasoap.com" }, me)).toBe(true);
    expect(raisedByViewer({ requestedBy: " vince " }, me)).toBe(true);
    expect(raisedByViewer({ requestedBy: "agent:router" }, me)).toBe(false);
  });

  it("disables Approve and Reject for the requester and says why", () => {
    const html = gateSheet(ROW, { raisedByMe: true });
    expect(html).toContain("You raised this gate, so another person must decide it.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
    const other = gateSheet(ROW);
    expect(other).not.toMatch(/disabled=""[^>]*>Reject</);
    expect(other).not.toMatch(/disabled=""[^>]*>Approve</);
  });
});

describe("reject needs a note", () => {
  it("refuses an empty or blank note and accepts any text", () => {
    expect(rejectNoteError("")).toBe(REJECT_NOTE_REQUIRED);
    expect(rejectNoteError("   ")).toBe(REJECT_NOTE_REQUIRED);
    expect(rejectNoteError("not yet")).toBeNull();
  });

  it("shows the error inline on the note", () => {
    const html = gateSheet(ROW, { noteError: REJECT_NOTE_REQUIRED });
    expect(html).toContain(REJECT_NOTE_REQUIRED);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(gateSheet(ROW)).not.toContain(REJECT_NOTE_REQUIRED);
  });
});

describe("queue rows", () => {
  it("each row is an .ap-item with a kind pill: Question neutral, Gate info", () => {
    const items = forMeItems(
      [
        {
          taskId: "TASK-9",
          taskTitle: "Posting groups",
          stage: "backlog",
          question: {
            id: "q_1",
            addressee: "vince",
            text: "Packaging on its own group?",
            options: ["Yes", "No"],
            askedBy: "cos@petrasoap.com",
            askedByPrincipal: "sp",
            askedRuntime: "claude-code",
            askedAt: "2026-10-22T10:00:00Z",
            status: "open",
          },
        },
      ],
      [ROW]
    );
    const html = renderToStaticMarkup(
      createElement(ApprovalsQueue, {
        groups: groupByTask(items),
        selectedId: "q_1",
        title: "2 open · 2 tasks",
        emptyText: "",
        projectNameOf: null,
        who: null,
        drafts: { q_1: { choice: 0, text: "" } },
        nowMs: Date.parse("2026-10-25T10:00:00Z"),
        onSelect: () => {},
      })
    );
    expect(html.match(/class="ap-item"/g)).toHaveLength(2);
    expect(html).toMatch(/class="ap-pill"><span class="ap-dot"[^>]*><\/span>Question/);
    expect(html).toMatch(/class="ap-pill is-info"><span class="ap-dot"[^>]*><\/span>Gate/);
    expect(html).toContain('id="question-q_1"');
    expect(html).toMatch(/aria-current="true"[^>]*>.*Packaging on its own group\?/);
    expect(html).toContain("claude-code · 2 options");
    expect(html).toContain("· Draft kept");
    expect(html).toContain("Waiting 3 d");
  });
});

// TASK-3629: a creator approver sees the tasks a gated creator made and can
// approve them from the inbox. Everyone else gets no rows, so nothing renders.
describe("creator approvals panel", () => {
  const CREATOR_ROW: PendingCreatorApprovalRow = {
    taskId: "TASK-901",
    taskTitle: "Intake from the workbench",
    stage: "backlog",
    principal: "sp_mcp_workbench_intake",
    requestedAt: "2026-10-26T20:00:00.000Z",
  };
  const panel = (over: Partial<Parameters<typeof CreatorApprovalsPanel>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(CreatorApprovalsPanel, {
        rows: [CREATOR_ROW],
        busyTaskId: null,
        error: null,
        done: null,
        nowMs: Date.parse("2026-10-26T21:00:00.000Z"),
        nav: () => {},
        onApprove: () => {},
        ...over,
      })
    );

  it("renders nothing without rows", () => {
    expect(panel({ rows: [] })).toBe("");
  });

  it("lists the task, its creator and an enabled Approve button", () => {
    const html = panel();
    expect(html).toContain('data-testid="creator-approvals"');
    expect(html).toContain("TASK-901");
    expect(html).toContain("Intake from the workbench");
    expect(html).toContain("Created by sp_mcp_workbench_intake");
    expect(html).toContain("Approve task");
    expect(html).not.toContain("disabled");
  });

  it("disables every button while one approval is in flight and shows its error inline", () => {
    const busy = panel({ busyTaskId: "TASK-901" });
    expect(busy).toContain("Approving…");
    expect(busy).toContain("disabled");
    const failed = panel({ error: { taskId: "TASK-901", message: "Only vince@ or cos@ can approve" } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Only vince@ or cos@ can approve");
  });

  it("confirms the approval after the last row is gone", () => {
    const html = panel({ rows: [], done: "TASK-901" });
    expect(html).toContain('role="status"');
    expect(html).toContain("TASK-901 approved");
  });
});
