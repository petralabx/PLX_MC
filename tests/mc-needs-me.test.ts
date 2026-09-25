// Wave 6 — colleague UX: Home is "What needs me today" — a prioritized list for
// the signed-in viewer with one action per row. The derivation is pure
// (src/components/mc/needs-me.ts) and fixture-driven here, with a non-vince
// viewer to prove it is per-viewer, never "whatever Vince would see".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { PendingApprovalRow } from "@/components/mc/approvals-inbox";
import { InboxView, NeedsSection } from "@/components/mc/inbox";
import {
  approvalRows,
  approvalsWaitingOn,
  isOwnerOrAdmin,
  needsMeCount,
  overdueFor,
  overdueRows,
  pendingApprovalRows,
  routingRows,
  sectionView,
  syncIssuesFor,
  syncRows,
  todayGridDay,
  unownedRows,
  unownedTasks,
  viewerLoadState,
  type NeedsRow,
  type SectionLoad,
} from "@/components/mc/needs-me";
import { dueDay } from "@/components/mc/work-views.helpers";
import { HUMANS, TASKS, type ApprovalGate, type Human, type Task } from "@/lib/mc-data";
import {
  __setViewerLoaderForTests,
  hydrate,
  resetStore,
  viewer,
  viewerSettled,
} from "@/lib/mc-data/store";

beforeEach(() => resetStore());

const GREG = HUMANS.greg; // Contributor — not vince, not an admin
const VINCE = HUMANS.vince; // Owner
const ADA: Human = {
  id: "ada",
  kind: "human",
  name: "Ada Admin",
  init: "AA",
  role: "Admin",
  online: true,
  email: "ada@petrasoap.com",
};
const TODAY = dueDay("Jun 16")!;

const task = (over: Partial<Task> & { id: string }): Task => ({
  ...structuredClone(TASKS[0]),
  assignee: null,
  coassignees: [],
  reporter: "stephen",
  accountableOwner: "stephen",
  stage: "planned",
  priority: "medium",
  due: "Jun 30",
  approvalGates: [],
  ...over,
});

const gate = (id: string, requestedBy: string): ApprovalGate => ({
  id,
  reason: `needs a decision (${id})`,
  requestedBy,
  requestedAt: "2026-06-15T09:00:00Z",
  status: "pending",
});

const TASKS_FIXTURE: Task[] = [
  task({ id: "T-GREG-LATE", title: "Greg's late task", assignee: "greg", due: "Jun 10", stage: "progress" }),
  task({ id: "T-GREG-OWNS", title: "Greg owns this", accountableOwner: "greg", due: "Jun 02" }),
  task({ id: "T-GREG-DONE", assignee: "greg", due: "Jun 01", stage: "verified" }),
  task({ id: "T-GREG-LATER", assignee: "greg", due: "Jun 30" }),
  task({ id: "T-GREG-UNDATED", assignee: "greg", due: "—" }),
  task({ id: "T-VINCE-LATE", assignee: "vince", accountableOwner: "vince", due: "Jun 05" }),
  task({ id: "T-NO-OWNER", accountableOwner: null, priority: "low" }),
  task({ id: "T-AGENT-OWNER", accountableOwner: "vibes", priority: "urgent" }),
  task({ id: "T-NO-OWNER-DONE", accountableOwner: null, stage: "merged" }),
];

const row = (taskId: string, g: ApprovalGate): PendingApprovalRow => ({
  taskId,
  taskTitle: `${taskId} title`,
  stage: "progress",
  gate: g,
});

const APPROVALS: PendingApprovalRow[] = [
  row("T-GREG-OWNS", gate("apg_agent_on_greg", "vibes")),
  row("T-VINCE-LATE", gate("apg_on_vince", "scribe")),
  row("T-GREG-OWNS", gate("apg_greg_asked", "greg.m@petrasoap.com")),
  row("T-VINCE-LATE", gate("apg_ada_asked", "ADA@petrasoap.com")),
];

const ids = (list: { id: string }[]) => list.map((t) => t.id);
const gateIds = (list: PendingApprovalRow[]) => list.map((r) => r.gate.id);

describe("who sees team-wide items", () => {
  it("is owners and admins only", () => {
    expect(isOwnerOrAdmin(VINCE)).toBe(true);
    expect(isOwnerOrAdmin(ADA)).toBe(true);
    expect(isOwnerOrAdmin(GREG)).toBe(false);
    expect(isOwnerOrAdmin(HUMANS.stephen)).toBe(false); // a job title is not a grant
  });
});

describe("approvals waiting on me", () => {
  it("a contributor sees gates on tasks they are accountable for — never their own request", () => {
    expect(gateIds(approvalsWaitingOn(GREG, APPROVALS, TASKS_FIXTURE))).toEqual(["apg_agent_on_greg"]);
  });

  it("an admin sees every gate except the ones they raised (separation of duties, any case)", () => {
    expect(gateIds(approvalsWaitingOn(ADA, APPROVALS, TASKS_FIXTURE))).toEqual([
      "apg_agent_on_greg",
      "apg_on_vince",
      "apg_greg_asked",
    ]);
  });

  it("reads the same pending gates the Approvals screen lists, straight from tasks", () => {
    const tasks = [
      task({ id: "T-A", approvalGates: [gate("g1", "vibes"), { ...gate("g2", "vibes"), status: "approved" }] }),
      task({ id: "T-B", approvalGates: [gate("g3", "scribe")] }),
    ];
    expect(gateIds(pendingApprovalRows(tasks))).toEqual(["g1", "g3"]);
    expect(pendingApprovalRows(tasks)[0]).toMatchObject({ taskId: "T-A", stage: "planned" });
  });
});

describe("my overdue tasks", () => {
  it("are mine (assigned or accountable), due before today and not done — most overdue first", () => {
    expect(ids(overdueFor(GREG, TASKS_FIXTURE, TODAY))).toEqual(["T-GREG-OWNS", "T-GREG-LATE"]);
  });

  it("are per viewer", () => {
    expect(ids(overdueFor(VINCE, TASKS_FIXTURE, TODAY))).toEqual(["T-VINCE-LATE"]);
    expect(ids(overdueFor(GREG, TASKS_FIXTURE, TODAY))).not.toContain("T-VINCE-LATE");
  });

  it("maps today onto the same due grid as the task dates", () => {
    expect(todayGridDay(new Date(2026, 5, 16))).toBe(dueDay("Jun 16"));
    expect(todayGridDay(new Date(2026, 8, 25))).toBe(dueDay("Sep 25"));
  });
});

describe("tasks with no accountable owner", () => {
  it("are for owners and admins only", () => {
    expect(unownedTasks(GREG, TASKS_FIXTURE)).toBeNull();
  });

  it("list open tasks with no human owner (an agent doesn't count), most urgent first", () => {
    expect(ids(unownedTasks(ADA, TASKS_FIXTURE)!)).toEqual(["T-AGENT-OWNER", "T-NO-OWNER"]);
  });
});

describe("SharePoint sync issues", () => {
  const counts = { pending: 4, conflict: 2, error: 1 };
  it("are for admins only, counting conflicts and errors (not pending)", () => {
    expect(syncIssuesFor(GREG, counts)).toBeNull();
    expect(syncIssuesFor(ADA, counts)).toBe(3);
    expect(syncIssuesFor(VINCE, counts)).toBe(3);
  });
});

describe("one clear action per row", () => {
  it("routes each kind to the screen where it gets done", () => {
    const [approval] = approvalRows(approvalsWaitingOn(GREG, APPROVALS, TASKS_FIXTURE));
    expect(approval).toMatchObject({ action: "Review", to: { screen: "approvals" }, id: "T-GREG-OWNS" });

    const [late] = overdueRows(overdueFor(GREG, TASKS_FIXTURE, TODAY));
    expect(late).toMatchObject({ action: "Open", to: { screen: "task", taskId: "T-GREG-OWNS" } });
    expect(late.meta).toContain("Jun 02");

    const [unowned] = unownedRows(unownedTasks(ADA, TASKS_FIXTURE)!);
    expect(unowned).toMatchObject({ action: "Assign owner", to: { screen: "task", taskId: "T-AGENT-OWNER" } });

    expect(syncRows(0)).toEqual([]);
    expect(syncRows(3)).toEqual([
      expect.objectContaining({ action: "Resolve", to: { screen: "sync" }, title: "3 SharePoint sync issues to resolve" }),
    ]);
    expect(syncRows(1)[0].title).toBe("1 SharePoint sync issue to resolve");

    const [routing] = routingRows([
      {
        id: "rp_1",
        repoId: "petralabx/PLX_MC",
        changeId: "pr:99",
        title: null,
        state: "action_required",
        failureReason: null,
        sessionId: null,
        accountableActorId: "oid-greg",
        topCandidate: null,
        slaAgeHours: 26,
        slaBreach: "alert_24h",
        derivedProjectId: null,
        selectedBucketId: null,
      },
    ]);
    expect(routing).toMatchObject({ action: "Decide", to: { screen: "routing-inbox" }, title: "pr:99" });
  });

  it("gives every row a unique key", () => {
    const rows: NeedsRow[] = [
      ...approvalRows(APPROVALS),
      ...overdueRows(TASKS_FIXTURE),
      ...unownedRows(TASKS_FIXTURE),
      ...syncRows(2),
    ];
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("the Home badge count", () => {
  it("adds up what needs this viewer from the store (approvals, overdue, unowned, sync)", () => {
    const tasks = TASKS_FIXTURE.map((t) =>
      t.id === "T-GREG-OWNS" ? { ...t, approvalGates: [gate("apg_x", "vibes")] } : t
    );
    const counts = { pending: 0, conflict: 1, error: 0 };
    // Greg: 1 approval (he is accountable) + 2 overdue; no admin sections.
    expect(needsMeCount(GREG, tasks, TODAY, counts)).toBe(3);
    // Ada: 1 approval + 0 overdue + 2 unowned + 1 sync issue.
    expect(needsMeCount(ADA, tasks, TODAY, counts)).toBe(4);
  });
});

describe("section states — exactly one renders", () => {
  it("maps a load to loading / error / empty / list", () => {
    expect(sectionView({ status: "loading" })).toBe("loading");
    expect(sectionView({ status: "error", message: "x" })).toBe("error");
    expect(sectionView({ status: "ready", rows: [] })).toBe("empty");
    expect(sectionView({ status: "ready", rows: [1] })).toBe("list");
  });

  it("knows a still-loading viewer from one that failed to resolve", () => {
    expect(viewerLoadState(null, false)).toBe("loading");
    expect(viewerLoadState(null, true)).toBe("error");
    expect(viewerLoadState(GREG, true)).toBe("ready");
  });

  const render = (load: SectionLoad<NeedsRow>) =>
    renderToStaticMarkup(
      createElement(NeedsSection, {
        id: "overdue",
        title: "Overdue",
        empty: "Nothing overdue.",
        load,
        onRetry: () => {},
        nav: () => {},
      })
    );

  it("loading shows only the loading state", () => {
    const html = render({ status: "loading" });
    expect(html).toContain("Loading");
    expect(html).not.toContain("Nothing overdue.");
    expect(html).not.toContain("Retry");
  });

  it("a failed load shows the error with Retry — never the empty state", () => {
    const html = render({ status: "error", message: "Failed to load approvals." });
    expect(html).toContain("Failed to load approvals.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Nothing overdue.");
    expect(html).not.toContain("Loading");
  });

  it("empty shows only the empty copy", () => {
    const html = render({ status: "ready", rows: [] });
    expect(html).toContain("Nothing overdue.");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Loading");
  });

  it("a list renders one button per row, each naming its one action", () => {
    const rows = overdueRows(overdueFor(GREG, TASKS_FIXTURE, TODAY));
    const html = render({ status: "ready", rows });
    expect(html.match(/<button/g)).toHaveLength(rows.length);
    expect(html).toContain("Open →");
    expect(html).toContain("T-GREG-OWNS");
    expect(html).not.toContain("Nothing overdue.");
  });
});

describe("store viewer load state", () => {
  it("is unsettled until GET /api/viewer answers, then settled either way", async () => {
    expect(viewerSettled()).toBe(false);
    __setViewerLoaderForTests(async () => {
      throw new Error("503");
    });
    await hydrate();
    expect(viewer()).toBeNull();
    expect(viewerSettled()).toBe(true);

    resetStore();
    __setViewerLoaderForTests(async () => GREG);
    await hydrate();
    expect(viewerSettled()).toBe(true);
    __setViewerLoaderForTests(null);
  });
});

describe("Home screen", () => {
  it("greets the viewer, asks what needs them today, and keeps Notifications", () => {
    const html = renderToStaticMarkup(
      createElement(InboxView, { route: { screen: "home" }, nav: () => {} })
    );
    expect(html).toContain('data-testid="inbox-screen"');
    expect(html).toMatch(/<h1>What needs <em>me<\/em> today<\/h1>/);
    expect(html).toContain(">Approvals waiting on you<");
    expect(html).toContain(">Your overdue tasks<");
    expect(html).toContain(">Notifications<");
    // First paint (viewer not yet known): loading, not an empty "all clear".
    expect(html).toContain("Loading");
    expect(html).not.toContain("Nothing overdue");
  });
});
