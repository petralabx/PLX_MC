// TASK-3706 — the BKT-UAT tickets view and its drift check. Invariants: every
// UAT ticket task in the bucket gets one row with its portal fields and a link
// back to its portal ticket, with no row cap; each filter counts the tasks
// whose ball it names; "Needs a human" agrees with the bucket table; each of
// the five drift cases is detected and applying its fix clears it; with the
// portal read off only the Mission Control cases run; no fix verifies a task.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { BucketDetail } from "@/components/mc/bucket-detail";
import { needsHuman } from "@/components/mc/project-overview.helpers";
import { UatTicketsPanel, fixLabel, leaseText, uatFilterCounts, uatGroup, uatHolder, uatRows } from "@/components/mc/uat-tickets";
import { TASKS } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import { addTask, resetStore } from "@/lib/mc-data/store";
import {
  UAT_TICKET_BUCKET,
  findUatDrift,
  leaseState,
  portalTicketUrl,
  ticketShortCode,
  ticketTaskDraft,
  uatAttempt,
  uatFeedbackId,
  type PortalRead,
  type PortalTicket,
  type UatDriftFinding,
  type UatDriftFix,
  type UatLease,
  type UatTaskFacts,
  type UatTicketsReport,
} from "@/lib/tasks/uat-tickets";

const NOW = new Date("2026-10-22T12:00:00.000Z");
const nowMs = NOW.getTime();
const at = (hoursAgo: number) => new Date(nowMs - hoursAgo * 3_600_000).toISOString();

const FB_A = "cmfa00000000000000aaaaaa1";
const FB_B = "cmfb00000000000000bbbbbb2";

let seq = 4000;
const ticketTask = (feedbackId: string, over: Partial<Task> = {}): Task =>
  ({
    ...TASKS[0],
    id: `TASK-${++seq}`,
    title: `UAT ${feedbackId.slice(0, 12)} — Pricing: export drops the last row`,
    bucket: UAT_TICKET_BUCKET,
    stage: "backlog",
    labels: ["kind:code", `uat:${feedbackId}`, "repo:petralabx/plx-customer-portal"],
    prs: [],
    accountableOwner: "vince",
    blocked: false,
    approvalGates: [],
    ...over,
  }) as Task;

const ticket = (id: string, over: Partial<PortalTicket> = {}): PortalTicket => ({
  id,
  status: "IN_PROGRESS",
  step: "Agent fixing",
  attempt: 1,
  expectsTask: true,
  staging: null,
  title: "Pricing: export drops the last row",
  updatedAt: at(1),
  ...over,
});

const lease = (over: Partial<UatLease> = {}): UatLease => ({
  agent: "Claude Code",
  issuedAt: at(10),
  expiresAt: at(-2),
  releasedAt: null,
  releasedReason: null,
  ...over,
});

const ok = (tickets: PortalTicket[]): PortalRead => ({ status: "ok", at: NOW.toISOString(), tickets });
const report = (over: Partial<UatTicketsReport> = {}): UatTicketsReport => ({
  generatedAt: NOW.toISOString(),
  bucketId: UAT_TICKET_BUCKET,
  facts: {},
  portal: { status: "off" },
  portalOrigin: "https://staging.plxcustomer.io",
  drift: [],
  lastDailyCheck: null,
  ...over,
});

function renderPanel(tasks: Task[], r: UatTicketsReport | null, error: string | null = null): string {
  return renderToStaticMarkup(createElement(UatTicketsPanel, { tasks, report: r, error, now: nowMs, nav: () => {} }));
}

describe("ticket identity from labels", () => {
  it("reads the feedback id, short code, portal link and attempt", () => {
    const labels = ["kind:code", `uat:${FB_A}`, "uat-attempt:3", "uat:hold"];
    expect(uatFeedbackId(labels)).toBe(FB_A);
    expect(ticketShortCode(FB_A)).toBe("AAAAA1");
    expect(portalTicketUrl(FB_A)).toBe(`https://staging.plxcustomer.io/uat?ticket=${FB_A}`);
    expect(portalTicketUrl(FB_A, "https://uat.portal.test")).toBe(`https://uat.portal.test/uat?ticket=${FB_A}`);
    expect(uatAttempt(labels)).toBe(3);
    expect(uatAttempt(["kind:code"])).toBe(1);
  });

  it("tells a live, expired and released lease apart", () => {
    expect(leaseState(null, nowMs)).toBe("none");
    expect(leaseState(lease(), nowMs)).toBe("live");
    expect(leaseState(lease({ expiresAt: at(1) }), nowMs)).toBe("expired");
    expect(leaseState(lease({ expiresAt: at(1), releasedAt: at(2), releasedReason: "merged" }), nowMs)).toBe("released");
    expect(leaseText(lease(), nowMs)).toBe("Claude Code · ends in 2 hr");
    expect(leaseText(lease({ expiresAt: at(1) }), nowMs)).toBe("Claude Code · expired 1 hr ago");
    expect(leaseText(lease({ releasedAt: at(2), releasedReason: "merged" }), nowMs)).toBe("Released · merged");
    expect(leaseText(null, nowMs)).toBe("None");
  });
});

describe("uatGroup and uatHolder", () => {
  it("puts each task under the filter that names who has the ball", () => {
    const blocked = ticketTask(FB_A, { stage: "progress", labels: ["kind:code", `uat:${FB_A}`, "uat:blocked"] });
    const held = ticketTask(FB_A, { labels: ["kind:code", `uat:${FB_A}`, "uat:hold"] });
    const merged = ticketTask(FB_A, { stage: "merged" });
    expect(uatGroup(blocked)).toBe("human");
    expect(uatGroup(held)).toBe("submitter");
    expect(uatGroup(merged)).toBe("submitter");
    expect(uatGroup(merged, ticket(FB_A, { status: "IN_PROGRESS", step: "Deploying" }))).toBe("flight");
    expect(uatGroup(merged, ticket(FB_A, { status: "READY_FOR_RETEST" }))).toBe("submitter");
    expect(uatGroup(ticketTask(FB_A, { stage: "progress" }))).toBe("flight");
    expect(uatGroup(ticketTask(FB_A, { stage: "verified" }))).toBe("verified");
    expect(uatGroup(ticketTask(FB_A, { stage: "cancelled" }))).toBe("cancelled");
  });

  it("agrees with the bucket table's Needs a human on every open task", () => {
    const tasks = [
      ticketTask(FB_A, { accountableOwner: null }),
      ticketTask(FB_A, { blocked: true }),
      ticketTask(FB_A, { labels: ["kind:code", `uat:${FB_A}`, "needs-vince"] }),
      ticketTask(FB_A, { stage: "progress" }),
      ticketTask(FB_A, { stage: "merged" }),
    ];
    for (const t of tasks) expect({ id: t.id, human: uatGroup(t) === "human" }).toEqual({ id: t.id, human: needsHuman(t) });
  });

  // The portal says STALE before closeStale lands: a merged task the bucket
  // table counts as Needs a human stays there, and only the others read STALE.
  it("agrees with the bucket table's Needs a human on a merged task whose ticket the portal closed as STALE", () => {
    const stale = ticket(FB_A, { status: "STALE", step: "STALE, no re-test result" });
    const tasks = [
      ticketTask(FB_A, { stage: "merged", accountableOwner: null }),
      ticketTask(FB_A, { stage: "merged", blocked: true }),
      ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "needs-vince"] }),
      ticketTask(FB_A, { stage: "merged" }),
    ];
    for (const t of tasks) {
      const group = uatGroup(t, stale);
      expect({ id: t.id, group }).toEqual({ id: t.id, group: needsHuman(t) ? "human" : "stale" });
    }
  });

  it("names the holder", () => {
    const progress = ticketTask(FB_A, { stage: "progress" });
    expect(uatHolder(progress, "flight", lease(), nowMs)).toBe("Claude Code");
    expect(uatHolder(progress, "flight", lease({ expiresAt: at(1) }), nowMs)).toBe("Steward queue");
    const review = ticketTask(FB_A, { stage: "review", prs: [{ repo: "plx-customer-portal", num: 2871, status: "open", title: "fix" }] });
    expect(uatHolder(review, "flight", null, nowMs)).toBe("Reviewer");
    expect(uatHolder(ticketTask(FB_A, { stage: "merged" }), "flight", null, nowMs)).toBe("Pipeline");
    expect(uatHolder(ticketTask(FB_A, { labels: ["kind:code", `uat:${FB_A}`, "needs-vince"] }), "human", null, nowMs)).toBe("Vince");
    expect(uatHolder(progress, "submitter", null, nowMs)).toBe("Submitter");
    expect(uatHolder(progress, "verified", null, nowMs)).toBe("Closed");
  });

  // TASK-4200: a STALE close shows in its own closed group, never In flight.
  // The task carries uat:stale (closed and unconfirmed in rollups), or it is
  // merged and the portal already says STALE while closeStale is on its way
  // (rollups still count it in progress until the label lands).
  it("puts a STALE close in its own closed group, never In flight or Waiting on submitter", () => {
    const stale = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale", "uat:blocked"] });
    const unlabelled = ticketTask(FB_A, { stage: "merged" });
    expect(uatGroup(stale)).toBe("stale");
    expect(uatGroup(stale, ticket(FB_A, { status: "READY_FOR_RETEST" }))).toBe("stale");
    expect(uatGroup(unlabelled, ticket(FB_A, { status: "STALE", step: "STALE, no re-test result" }))).toBe("stale");
    expect(uatGroup(unlabelled, ticket(FB_A, { status: "IN_PROGRESS", step: "Deploying" }))).toBe("flight");
    // Without the label or a STALE ticket, a merged task still waits on the submitter.
    expect(uatGroup(unlabelled)).toBe("submitter");
    // A task that never merged stays open in Mission Control; the drift check asks a person to cancel it.
    expect(uatGroup(ticketTask(FB_A, { stage: "progress" }), ticket(FB_A, { status: "STALE" }))).toBe("flight");
    // A late PASS verifies it; a later cancel cancels it.
    expect(uatGroup({ ...stale, stage: "verified" })).toBe("verified");
    expect(uatGroup({ ...stale, stage: "cancelled" })).toBe("cancelled");
    for (const t of [stale, unlabelled]) expect(uatHolder(t, "stale", lease(), nowMs)).toBe("Closed");
    expect(needsHuman(stale)).toBe(false);
  });
});

describe("UatTicketsPanel", () => {
  it("lists every UAT ticket task with its portal fields and a portal link, with no row cap", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      ticketTask(`cmfz0000000000000000000${String(i).padStart(2, "0")}`, { stage: "progress" })
    );
    const other = ticketTask(FB_B, { labels: ["kind:code"] });
    const first = uatFeedbackId(tasks[0].labels)!;
    const r = report({
      portal: ok([ticket(first, { step: "Agent fixing", attempt: 2, staging: "Live · smoke passed" })]),
      facts: { [tasks[0].id]: { createdAt: at(26), lease: lease() } },
    });
    const html = renderPanel([...tasks, other], r);
    expect(html.match(/class="uat-row g-/g)).toHaveLength(12);
    expect(html).not.toContain(other.id);
    for (const t of tasks) {
      expect(html).toContain(t.id);
      expect(html).toContain(`href="${portalTicketUrl(uatFeedbackId(t.labels)!)}"`);
    }
    expect(html).toContain(`${ticketShortCode(first)} · Open in portal`);
    // TASK-3975: the rows link to the origin the report names.
    expect(renderPanel(tasks, report({ portalOrigin: "https://uat.portal.test" }))).toContain(`href="https://uat.portal.test/uat?ticket=${first}"`);
    for (const text of ["Agent fixing", "Live · smoke passed", "Claude Code · ends in 2 hr", "1 day"]) expect(html).toContain(text);
    expect(html).not.toContain("Show all");
    expect(html).not.toContain("Portal read is off");
  });

  it("counts every filter in display order and shows the Steward cause", () => {
    const blocked = ticketTask(FB_A, { stage: "progress", labels: ["kind:code", `uat:${FB_A}`, "uat:blocked", "uat:cause:quota"] });
    const verified = ticketTask(FB_B, { stage: "verified" });
    const held = ticketTask(FB_B, { labels: ["kind:code", `uat:${FB_B}`, "uat:hold"] });
    const rows = uatRows([verified, held, blocked], null);
    expect(rows.map((r) => r.task.id)).toEqual([blocked.id, held.id, verified.id]);
    expect(uatFilterCounts(rows)).toEqual({ all: 3, human: 1, flight: 0, submitter: 1, stale: 0, verified: 1 });
    const html = renderPanel([verified, held, blocked], report());
    // The verified filter reads PASS: UAT results are never "Verified" (fleet rule).
    for (const text of ["uat:blocked · quota", "uat:hold · question open", "Needs a human · 1", "Waiting on submitter · 1", "PASS · 1", "STALE · 0"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Verified · ");
  });

  it("lists a STALE close after the submitter's rows and before PASS, with its own filter and note", () => {
    const stale = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
    const waiting = ticketTask(FB_B, { stage: "merged" });
    const verified = ticketTask(FB_B, { stage: "verified" });
    const cancelled = ticketTask(FB_B, { stage: "cancelled" });
    const rows = uatRows([cancelled, verified, stale, waiting], null);
    expect(rows.map((r) => r.group)).toEqual(["submitter", "stale", "verified", "cancelled"]);
    expect(uatFilterCounts(rows)).toEqual({ all: 4, human: 0, flight: 0, submitter: 1, stale: 1, verified: 1 });
    const html = renderPanel([cancelled, verified, stale, waiting], report({ facts: { [stale.id]: { createdAt: at(30), lease: null } } }));
    for (const text of ["STALE · 1", "PASS · 1", "uat:stale · re-test never answered", 'class="uat-row g-stale"']) expect(html).toContain(text);
    // A closed row shows no age.
    expect(html).not.toContain("1 day");
  });

  // One row's markup, for the chip tone and the note under it.
  const rowOf = (html: string, id: string) => html.split('<div class="uat-row ').find((seg) => seg.includes(`>${id}</button>`)) ?? "";
  const staleOf = (id: string) => ticket(id, { status: "STALE", step: "STALE, no re-test result", expectsTask: false });

  // S1-10: the portal already says STALE, and closeStale has not landed yet.
  it("marks a STALE row whose label has not landed: muted chip and a pending note, held or not", () => {
    const plain = ticketTask(FB_A, { stage: "merged" });
    const held = ticketTask(FB_B, { stage: "merged", labels: ["kind:code", `uat:${FB_B}`, "uat:hold"] });
    const html = renderPanel([plain, held], report({ portal: ok([staleOf(FB_A), staleOf(FB_B)]) }));
    for (const t of [plain, held]) {
      const seg = rowOf(html, t.id);
      expect(seg).toContain("g-stale");
      expect(seg).toContain("pv-chip muted");
      expect(seg).toContain("STALE in the portal · closeStale pending");
      expect(seg).not.toContain("question open");
    }
  });

  // S1-11: the portal's hold on a STALE ticket's open task is not a question.
  it("names the hold on a STALE ticket's open task, and keeps question open for a real question", () => {
    const heldStale = ticketTask(FB_A, { stage: "review", labels: ["kind:code", `uat:${FB_A}`, "uat:hold"] });
    const heldQuestion = ticketTask(FB_B, { stage: "review", labels: ["kind:code", `uat:${FB_B}`, "uat:hold"] });
    const r = report({ portal: ok([staleOf(FB_A), ticket(FB_B, { status: "IN_PROGRESS", step: "Question open" })]) });
    const html = renderPanel([heldStale, heldQuestion], r);
    expect(rowOf(html, heldStale.id)).toContain("uat:hold · ticket closed as STALE, late result possible");
    expect(rowOf(html, heldQuestion.id)).toContain("uat:hold · question open");
    // Deliberate: only the submitter can move a STALE ticket during the late window, so it waits on them.
    const group = uatGroup(heldStale, staleOf(FB_A));
    expect(group).toBe("submitter");
    expect(uatHolder(heldStale, group, null, nowMs)).toBe("Submitter");
  });

  // Before closeStale lands, a merged task the bucket table counts as Needs a
  // human shows its human reason and holder, never the STALE-pending note.
  it("shows a Needs a human row on a STALE ticket with its reason and holder", () => {
    const vince = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "needs-vince"] });
    const blocked = ticketTask(FB_B, { stage: "merged", labels: ["kind:code", `uat:${FB_B}`, "uat:blocked", "uat:cause:quota"] });
    const html = renderPanel([vince, blocked], report({ portal: ok([staleOf(FB_A), staleOf(FB_B)]) }));
    // needs-vince names Vince; a Steward block names the accountable owner.
    for (const [t, note, holder] of [[vince, "needs-vince", "Vince"], [blocked, "uat:blocked · quota", "Vince Alton"]] as const) {
      const seg = rowOf(html, t.id);
      expect(seg).toContain("g-human");
      expect(seg).toContain(note);
      expect(seg).toContain(`>${holder}</span>`);
      expect(seg).not.toContain("closeStale pending");
    }
    expect(html).toContain("Needs a human · 2");
    expect(html).toContain("STALE · 0");
  });

  // S1-02: the label stays until the portal's verify or cancel lands, but the re-test was answered.
  it("says a late result came in once the ticket left STALE", () => {
    const stale = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
    for (const status of ["RESOLVED", "REOPENED"] as const) {
      const html = renderPanel([stale], report({ portal: ok([ticket(FB_A, { status, expectsTask: false })]) }));
      expect(rowOf(html, stale.id)).toContain("uat:stale · late result in the portal");
      expect(html).not.toContain("re-test never answered");
    }
  });

  it("says when the portal read is off or failed, and when the load failed", () => {
    expect(renderPanel([ticketTask(FB_A)], report())).toContain("Portal read is off");
    expect(renderPanel([ticketTask(FB_A)], report({ portal: { status: "error", at: NOW.toISOString(), message: "The portal answered HTTP 503." } }))).toContain(
      "Portal read failed: The portal answered HTTP 503."
    );
    expect(renderPanel([ticketTask(FB_A)], null, "Internal error.")).toContain("Couldn’t load lease and portal fields: Internal error.");
  });
});

const OFF: PortalRead = { status: "off" };

function drift(tasks: Task[], portal: PortalRead, facts: Record<string, UatTaskFacts> = {}): UatDriftFinding[] {
  return findUatDrift({ tasks, facts, portal, now: NOW });
}

/** What the server ends up with after each fix (the routes the page calls). */
function applyFix(tasks: Task[], fix: UatDriftFix): Task[] {
  if (fix.kind === "cancel") return tasks.map((t) => (t.id === fix.taskId ? { ...t, stage: "cancelled" } : t));
  if (fix.kind !== "create") return tasks.map((t) => (t.id === fix.taskId ? { ...t, stage: "backlog" } : t));
  const draft = ticketTaskDraft(fix);
  return [...tasks, ticketTask(fix.feedbackId, { title: draft.title, labels: draft.labels })];
}

const withAttempt = (feedbackId: string, n: number, over: Partial<Task> = {}) =>
  ticketTask(feedbackId, { labels: ["kind:code", `uat:${feedbackId}`, `uat-attempt:${n}`], ...over });

describe("findUatDrift", () => {
  it("finds nothing when Mission Control and the portal agree", () => {
    const tasks = [ticketTask(FB_A, { stage: "progress" }), ticketTask(FB_B, { stage: "merged" })];
    const facts = { [tasks[0].id]: { createdAt: at(5), lease: lease() } };
    expect(drift(tasks, ok([ticket(FB_A), ticket(FB_B, { status: "READY_FOR_RETEST", expectsTask: false })]), facts)).toEqual([]);
  });

  it("ignores tasks that are not UAT ticket tasks", () => {
    const loose = () => ticketTask(FB_A, { labels: ["kind:needs-review", `uat:${FB_A}`] });
    expect(drift([loose(), loose()], OFF)).toEqual([]);
  });

  it("an open ticket with no task: detected, and the create fix clears it", () => {
    const portal = ok([ticket(FB_A)]);
    const findings = drift([], portal);
    expect(findings).toEqual([expect.objectContaining({ case: "no_task", feedbackId: FB_A, taskId: null })]);
    expect(findings[0].fix).toEqual({ kind: "create", feedbackId: FB_A, title: "Pricing: export drops the last row", attempt: 1 });
    expect(drift(applyFix([], findings[0].fix!), portal)).toEqual([]);
    expect(drift([], ok([ticket(FB_A, { expectsTask: false, status: "PENDING" })]))).toEqual([]);
    expect(drift([], ok([ticket(FB_A, { status: "RESOLVED" })]))).toEqual([]);
  });

  it("a final task while the portal expects one: a cancelled task reopens, and that clears it", () => {
    const tasks = [ticketTask(FB_A, { stage: "cancelled" })];
    const portal = ok([ticket(FB_A, { status: "REOPENED", step: "Re-opened" })]);
    const [finding] = drift(tasks, portal);
    expect(finding).toMatchObject({ case: "final_task_open_ticket", taskId: tasks[0].id, fix: { kind: "reopen", taskId: tasks[0].id } });
    expect(drift(applyFix(tasks, finding.fix!), portal)).toEqual([]);
  });

  it("never moves a verified task back: it creates the next attempt, and that clears it", () => {
    const tasks = [withAttempt(FB_A, 2, { stage: "verified" })];
    const portal = ok([ticket(FB_A, { status: "REOPENED", attempt: 2 })]);
    const [finding] = drift(tasks, portal);
    expect(finding.fix).toMatchObject({ kind: "create", feedbackId: FB_A, attempt: 3 });
    const fixed = applyFix(tasks, finding.fix!);
    expect(fixed[0].stage).toBe("verified");
    expect(uatAttempt(fixed[1].labels)).toBe(3);
    expect(drift(fixed, portal)).toEqual([]);
    expect(drift(tasks, ok([ticket(FB_A, { status: "READY_FOR_RETEST", expectsTask: false })]))).toEqual([]);
  });

  it("an open task while the ticket is closed: cancelled as obsolete, and that clears it", () => {
    const tasks = [ticketTask(FB_A)];
    const portal = ok([ticket(FB_A, { status: "REJECTED", step: "Won't fix" })]);
    const findings = drift(tasks, portal);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ case: "open_task_closed_ticket", taskId: tasks[0].id });
    expect(findings[0].fix).toEqual({ kind: "cancel", taskId: tasks[0].id, reason: "obsolete", note: `Portal ticket ${ticketShortCode(FB_A)} is rejected.` });
    expect(drift(applyFix(tasks, findings[0].fix!), portal)).toEqual([]);
  });

  it("offers no fix for a merged task on a resolved ticket, and reports a closed ticket once per open task", () => {
    const merged = ticketTask(FB_A, { stage: "merged", prs: [{ repo: "plx-customer-portal", num: 2866, status: "merged", title: "fix" }] });
    const resolved = ok([ticket(FB_A, { status: "RESOLVED" })]);
    const [finding] = drift([merged], resolved);
    expect(finding).toMatchObject({ case: "open_task_closed_ticket", fix: null });
    expect(finding.text).toContain("Only the portal's verify closes it");
    const twins = drift([ticketTask(FB_A), withAttempt(FB_A, 2)], resolved);
    expect(twins.map((f) => f.case)).toEqual(["open_task_closed_ticket", "open_task_closed_ticket"]);
  });

  it("more than one open task per ticket: runs with the portal off, keeps the newest, and the cancels clear it", () => {
    const [first, second, third] = [ticketTask(FB_A, { stage: "merged" }), withAttempt(FB_A, 2), withAttempt(FB_A, 3)];
    const tasks = [second, third, first];
    const findings = drift(tasks, OFF);
    expect(findings.map((f) => [f.case, f.taskId])).toEqual([
      ["duplicate_open_tasks", second.id],
      ["duplicate_open_tasks", first.id],
    ]);
    for (const f of findings) expect(f.fix).toMatchObject({ kind: "cancel", reason: "superseded", replacedBy: third.id });
    expect(drift(findings.reduce((acc, f) => applyFix(acc, f.fix!), tasks), OFF)).toEqual([]);
  });

  it("an expired lease with no PR: runs with the portal off, and the requeue clears it", () => {
    const tasks = [ticketTask(FB_A, { stage: "progress" })];
    const facts = { [tasks[0].id]: { createdAt: at(30), lease: lease({ expiresAt: at(3) }) } };
    const findings = drift(tasks, OFF, facts);
    expect(findings).toEqual([expect.objectContaining({ case: "expired_lease_no_pr", fix: { kind: "requeue", taskId: tasks[0].id } })]);
    expect(drift(applyFix(tasks, findings[0].fix!), OFF, facts)).toEqual([]);
  });

  it("leaves a live lease, a released lease, an open PR and a backlog task alone", () => {
    const expired = lease({ expiresAt: at(3) });
    const live = ticketTask(FB_A, { stage: "progress" });
    const released = ticketTask(FB_A, { stage: "review" });
    const withPr = ticketTask(FB_B, { stage: "review", prs: [{ repo: "plx-customer-portal", num: 2871, status: "open", title: "fix" }] });
    const queued = ticketTask(FB_B);
    const facts = {
      [live.id]: { createdAt: null, lease: lease() },
      [released.id]: { createdAt: null, lease: { ...expired, releasedAt: at(2), releasedReason: "manual" } },
      [withPr.id]: { createdAt: null, lease: expired },
      [queued.id]: { createdAt: null, lease: expired },
    };
    expect(drift([live, released, withPr, queued], OFF, facts).filter((f) => f.case === "expired_lease_no_pr")).toEqual([]);
  });

  it("runs only the Mission Control cases when the portal read failed", () => {
    expect(drift([ticketTask(FB_A, { stage: "cancelled" })], { status: "error", at: NOW.toISOString(), message: "HTTP 500" })).toEqual([]);
  });

  // TASK-4200: a ticket that closed as STALE gets its own words, never
  // "rejected" or "resolved". Only the portal's closeStale closes its task.
  describe("a ticket that closed as STALE", () => {
    const staleTicket = (over: Partial<PortalTicket> = {}) =>
      ticket(FB_A, { status: "STALE", step: "STALE, no re-test result", expectsTask: false, ...over });
    const words = (findings: UatDriftFinding[]) => JSON.stringify(findings);

    it("asks the portal for the missing uat:stale on a merged task, with no fix in Mission Control", () => {
      const merged = ticketTask(FB_A, { stage: "merged", prs: [{ repo: "plx-customer-portal", num: 2866, status: "merged", title: "fix" }] });
      const findings = drift([merged], ok([staleTicket()]));
      expect(findings).toEqual([{
        case: "open_task_closed_ticket",
        feedbackId: FB_A,
        taskId: merged.id,
        text: `Ticket ${ticketShortCode(FB_A)} is closed as STALE (no re-test result) in the portal, but ${merged.id} still awaits re-test. Only the portal's closeStale closes it.`,
        fix: null,
      }]);
      expect(words(findings)).not.toMatch(/rejected|resolved/);
    });

    it("raises nothing once the task carries uat:stale", () => {
      const stale = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
      expect(drift([stale], ok([staleTicket()]))).toEqual([]);
      expect(drift([], ok([staleTicket()]))).toEqual([]);
    });

    for (const [stage, name] of [["review", "In Review"], ["backlog", "Backlog"]] as const) {
      it(`lists a ${stage} task that never merged, with a cancel only a person applies, and the cancel clears it`, () => {
        const open = ticketTask(FB_A, { stage });
        const portal = ok([staleTicket()]);
        const code = ticketShortCode(FB_A);
        const findings = drift([open], portal);
        expect(findings).toEqual([{
          case: "open_task_closed_ticket",
          feedbackId: FB_A,
          taskId: open.id,
          text: `${open.id} is open (${name}), but ticket ${code} is closed as STALE (no re-test result) in the portal.`,
          fix: { kind: "cancel", taskId: open.id, reason: "obsolete", note: `Portal ticket ${code} is closed as STALE (no re-test result).` },
        }]);
        expect(words(findings)).not.toMatch(/rejected|resolved/);
        expect(drift(applyFix([open], findings[0].fix!), portal)).toEqual([]);
      });
    }

    // S1-02: after a late PASS the ticket is RESOLVED; until the portal's
    // verify lands, the newest attempt is still closed as STALE.
    it("asks the portal to re-send verify for a STALE close on a resolved ticket, newest attempt only", () => {
      const older = withAttempt(FB_A, 1, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
      const newest = withAttempt(FB_A, 2, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat-attempt:2", "uat:stale"] });
      const resolved = ok([ticket(FB_A, { status: "RESOLVED", expectsTask: false })]);
      expect(drift([older, newest], resolved)).toEqual([{
        case: "open_task_closed_ticket",
        feedbackId: FB_A,
        taskId: newest.id,
        text: `Ticket ${ticketShortCode(FB_A)} is resolved in the portal, but ${newest.id} is still closed as STALE. Only the portal's verify closes it, so re-send it from the portal.`,
        fix: null,
      }]);
      // Once the verify lands, the check is quiet.
      expect(drift([older, { ...newest, stage: "verified" }], resolved)).toEqual([]);
    });

    it("raises nothing for a STALE close on a reopened ticket that expects no task", () => {
      const stale = ticketTask(FB_A, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
      expect(drift([stale], ok([ticket(FB_A, { status: "REOPENED", expectsTask: false })]))).toEqual([]);
    });

    it("after a late FAIL reopens the ticket, offers the next attempt's task, never a reopen", () => {
      const stale = withAttempt(FB_A, 1, { stage: "merged", labels: ["kind:code", `uat:${FB_A}`, "uat:stale"] });
      const portal = ok([ticket(FB_A, { status: "REOPENED", step: "Re-opened", attempt: 2 })]);
      const [finding] = drift([stale], portal);
      expect(finding).toMatchObject({ case: "final_task_open_ticket", taskId: stale.id });
      expect(finding.fix).toMatchObject({ kind: "create", feedbackId: FB_A, attempt: 2 });
      expect(drift(applyFix([stale], finding.fix!), portal)).toEqual([]);
    });
  });
});

describe("ticketTaskDraft", () => {
  it("files a portal-shaped ticket task that Steward leaves alone until a person reads it", () => {
    const draft = ticketTaskDraft({ kind: "create", feedbackId: FB_A, title: "Pricing: export drops the last row", attempt: 2 });
    expect(draft).toMatchObject({ bucket: UAT_TICKET_BUCKET, repos: ["portal-web"], targetEnv: "staging" });
    expect(draft.labels).toEqual(["kind:code", `uat:${FB_A}`, "repo:petralabx/plx-customer-portal", "needs-vince", "uat-attempt:2"]);
    expect(draft.title).toBe(`UAT ${FB_A.slice(0, 12)} — Pricing: export drops the last row`);
    expect(draft.description).toContain(portalTicketUrl(FB_A));
    // TASK-3975: the link follows the origin the server names.
    const elsewhere = ticketTaskDraft({ kind: "create", feedbackId: FB_A, title: "x", attempt: 1 }, "https://uat.portal.test");
    expect(elsewhere.description).toContain(`https://uat.portal.test/uat?ticket=${FB_A}`);
  });
});

describe("the check on the panel", () => {
  it("shows each finding with its fix, or says the portal fixes it", () => {
    const blocked = ticketTask(FB_A, { stage: "progress", labels: ["kind:code", `uat:${FB_A}`, "uat:blocked"] });
    const findings = [
      ...drift([blocked, ticketTask(FB_A)], OFF),
      ...drift([ticketTask(FB_B, { stage: "merged" })], ok([ticket(FB_B, { status: "RESOLVED" })])),
    ];
    const html = renderPanel([blocked], report({ drift: findings }));
    expect(html).toContain("2 out of sync");
    expect(html).toContain("Cancel as replaced");
    expect(html).toContain("Portal fixes this");
    expect(html).toContain("Check now");
  });

  it("says in sync, and when the daily check last ran", () => {
    const html = renderPanel([ticketTask(FB_A)], report({ lastDailyCheck: { at: at(6), findings: 0, portal: "off" } }));
    expect(html).toContain("In sync");
    expect(html).toContain("Daily check 6 hr ago");
    expect(renderPanel([ticketTask(FB_A)], report())).toContain("Daily check not run yet");
  });

  it("labels every fix kind", () => {
    expect(fixLabel({ kind: "create", feedbackId: FB_A, title: "", attempt: 1 })).toBe("Create task");
    expect(fixLabel({ kind: "reopen", taskId: "TASK-1" })).toBe("Reopen to backlog");
    expect(fixLabel({ kind: "requeue", taskId: "TASK-1" })).toBe("Requeue to backlog");
    expect(fixLabel({ kind: "cancel", taskId: "TASK-1", reason: "obsolete", note: "" })).toBe("Cancel task");
  });
});

describe("BucketDetail", () => {
  beforeEach(() => resetStore());

  const render = (bucketId: string) =>
    renderToStaticMarkup(createElement(BucketDetail, { route: { screen: "bucket", bucketId }, nav: () => {} }));

  it("shows the UAT tickets view on BKT-UAT only (a fixture initiative)", () => {
    addTask({ title: "UAT ticket", bucket: UAT_TICKET_BUCKET, labels: ["kind:code", `uat:${FB_A}`] });
    const uat = render(UAT_TICKET_BUCKET);
    expect(uat).toContain('data-testid="uat-tickets"');
    expect(uat).toContain(`${ticketShortCode(FB_A)} · Open in portal`);
    expect(render(TASKS[0].bucket)).not.toContain('data-testid="uat-tickets"');
  });
});
