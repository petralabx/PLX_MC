// TASK-3706 — the BKT-UAT tickets view. Invariants: every UAT ticket task in
// the bucket gets one row with its portal fields and a link back to its portal
// ticket, with no row cap; each filter counts the tasks whose ball it names;
// "Needs a human" agrees with the bucket table; other buckets are unchanged.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { BucketDetail } from "@/components/mc/bucket-detail";
import { needsHuman } from "@/components/mc/project-overview.helpers";
import { UatTicketsPanel, leaseText, uatFilterCounts, uatGroup, uatHolder, uatRows } from "@/components/mc/uat-tickets";
import { TASKS } from "@/lib/mc-data";
import type { Task } from "@/lib/mc-data";
import { addTask, resetStore } from "@/lib/mc-data/store";
import {
  UAT_TICKET_BUCKET,
  leaseState,
  portalTicketUrl,
  ticketShortCode,
  uatAttempt,
  uatFeedbackId,
  type PortalRead,
  type PortalTicket,
  type UatLease,
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
    expect(uatFilterCounts(rows)).toEqual({ all: 3, human: 1, flight: 0, submitter: 1, verified: 1 });
    const html = renderPanel([verified, held, blocked], report());
    for (const text of ["uat:blocked · quota", "uat:hold · question open", "Needs a human · 1", "Waiting on submitter · 1", "Verified · 1"]) {
      expect(html).toContain(text);
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
