// UAT ticket task labels (TASK-3697). Invariants: a task is a UAT ticket task
// only with kind:code and a uat:<feedbackId> label; Steward's and the portal's
// state labels never name a ticket; only uat:hold and uat-attempt:<n> are
// portal-mirrored labels.
import { describe, expect, it } from "vitest";

import {
  UAT_STALE_LABEL,
  endsStaleClose,
  hasHumanBlockLabel,
  isStaleClosed,
  isUatBlockLabel,
  isUatSyncLabel,
  isUatTicketTask,
  staleLabelCreateViolation,
  staleLabelPatchViolation,
  uatBlockCauses,
  uatTicketLabel,
} from "@/lib/tasks/uat-labels";

describe("uat ticket labels", () => {
  it("finds the uat:<feedbackId> label and skips state labels", () => {
    expect(uatTicketLabel(["uat:blocked", "uat:cause:quota", "uat:hold", "uat:cmfb7q2xk0001"])).toBe("uat:cmfb7q2xk0001");
    expect(uatTicketLabel(["uat:blocked", "uat:hold", "uat:cause:repo", "uat-attempt:2"])).toBeNull();
    expect(uatTicketLabel(undefined)).toBeNull();
  });

  it("needs kind:code and a ticket label for a UAT ticket task", () => {
    expect(isUatTicketTask({ labels: ["kind:code", "uat:cmfb7q2xk0001"] })).toBe(true);
    expect(isUatTicketTask({ labels: ["kind:decision", "uat:cmfb7q2xk0001"] })).toBe(false);
    expect(isUatTicketTask({ labels: ["kind:code", "uat:blocked"] })).toBe(false);
    expect(isUatTicketTask({})).toBe(false);
  });

  it("mirrors only uat:hold and uat-attempt:<n> from the portal", () => {
    for (const label of ["uat:hold", "uat-attempt:1", "uat-attempt:12"]) expect(isUatSyncLabel(label)).toBe(true);
    for (const label of ["uat:blocked", "uat:cause:quota", "uat-attempt:0", "uat-attempt:x", "uat:cmfb7q2xk0001", "lane:claude-uat"]) {
      expect({ label, sync: isUatSyncLabel(label) }).toEqual({ label, sync: false });
    }
  });

  it("names Steward's block labels: uat:blocked and a non-empty uat:cause:<x> (TASK-3967)", () => {
    for (const label of ["uat:blocked", "uat:cause:quota"]) expect(isUatBlockLabel(label)).toBe(true);
    for (const label of ["uat:cause:", "uat:hold", "uat-attempt:1", "uat:cmfb7q2xk0001", "lane:claude-uat"]) {
      expect({ label, block: isUatBlockLabel(label) }).toEqual({ label, block: false });
    }
  });

  it("reads Steward's causes and the human-block labels", () => {
    expect(uatBlockCauses(["uat:blocked", "uat:cause:quota", "uat:cause:", "uat:cause:env"])).toEqual(["quota", "env"]);
    expect(hasHumanBlockLabel({ labels: ["uat:blocked"] })).toBe(true);
    expect(hasHumanBlockLabel({ labels: ["needs-vince"] })).toBe(true);
    expect(hasHumanBlockLabel({ labels: ["needs-info", "uat:hold"] })).toBe(false);
  });
});

// TASK-4200 (Vince, 2026-10-30): uat:stale closes a merged UAT ticket task as
// closed and unconfirmed. It is a state label: it never names a ticket, and no
// label-only path (the portal's mirror, Steward's block) may write it.
describe("uat:stale", () => {
  const ticket = "uat:cmfb7q2xk0001";

  it("is a state label, never a ticket id", () => {
    expect(UAT_STALE_LABEL).toBe("uat:stale");
    expect(uatTicketLabel([UAT_STALE_LABEL])).toBeNull();
    expect(uatTicketLabel([UAT_STALE_LABEL, ticket])).toBe(ticket);
    expect(isUatTicketTask({ labels: ["kind:code", UAT_STALE_LABEL] })).toBe(false);
  });

  it("is neither a portal-mirrored label nor a Steward block label", () => {
    expect(isUatSyncLabel(UAT_STALE_LABEL)).toBe(false);
    expect(isUatBlockLabel(UAT_STALE_LABEL)).toBe(false);
    expect(hasHumanBlockLabel({ labels: [UAT_STALE_LABEL] })).toBe(false);
  });

  it("closes a task only with kind:code, a ticket label, stage merged and uat:stale", () => {
    expect(isStaleClosed({ stage: "merged", labels: ["kind:code", ticket, UAT_STALE_LABEL] })).toBe(true);
    for (const task of [
      { stage: "merged", labels: ["kind:code", ticket] },
      { stage: "merged", labels: ["kind:code", UAT_STALE_LABEL] },
      { stage: "merged", labels: ["kind:decision", ticket, UAT_STALE_LABEL] },
      // A late PASS verifies the task and keeps the label as history.
      { stage: "verified", labels: ["kind:code", ticket, UAT_STALE_LABEL] },
      { stage: "cancelled", labels: ["kind:code", ticket, UAT_STALE_LABEL] },
      { stage: "review", labels: ["kind:code", ticket, UAT_STALE_LABEL] },
      { stage: "merged" },
    ]) {
      expect({ task, stale: isStaleClosed(task) }).toEqual({ task, stale: false });
    }
  });

  it("is never on a new task, in any case or with spaces", () => {
    for (const labels of [["kind:code", ticket, UAT_STALE_LABEL], ["UAT:Stale"], [" uat:stale "]]) {
      expect(staleLabelCreateViolation(labels)).toContain("only by the portal's mc_update_task closeStale");
    }
    expect(staleLabelCreateViolation(["kind:code", ticket, "uat:hold"])).toBeNull();
    expect(staleLabelCreateViolation(undefined)).toBeNull();
  });

  it("is added only through closeStale and removed by no patch", () => {
    const labels = ["kind:code", ticket];
    expect(staleLabelPatchViolation(labels, [...labels, UAT_STALE_LABEL], false)).toContain("cannot be added");
    expect(staleLabelPatchViolation(labels, [...labels, UAT_STALE_LABEL], true)).toBeNull();
    expect(staleLabelPatchViolation([...labels, UAT_STALE_LABEL], labels, true)).toContain("no patch removes it");
    expect(staleLabelPatchViolation([...labels, UAT_STALE_LABEL], labels, false)).toContain("no patch removes it");
    // Edits that keep it, or never touch it, pass.
    expect(staleLabelPatchViolation([...labels, UAT_STALE_LABEL], [...labels, UAT_STALE_LABEL, "api"], false)).toBeNull();
    expect(staleLabelPatchViolation(labels, [...labels, "uat:hold"], false)).toBeNull();
  });

  // S1-06: a stored padded near-copy reads as inert here, but as an add of the
  // exact label once an MCP label edit trims it, so every later MCP label edit
  // on the task would be refused. A case variant is refused as createTask
  // refuses it (trimmed, lower case).
  it("refuses a new near-copy of uat:stale on every door, closeStale included", () => {
    const labels = ["kind:code", ticket];
    for (const variant of [" uat:stale", "UAT:STALE", "uat:stale "]) {
      expect(staleLabelPatchViolation(labels, [...labels, variant], false)).toContain("cannot be added");
      expect(staleLabelPatchViolation(labels, [...labels, variant], true)).toContain("cannot be added");
      // Swapping the real label for a near-copy would end a real close: refused too.
      expect(staleLabelPatchViolation([...labels, UAT_STALE_LABEL], [...labels, variant], false)).not.toBeNull();
    }
    // A near-copy already stored may stay or go (a web PATCH, or an MCP edit
    // that sends no label field); only the exact label is protected.
    expect(staleLabelPatchViolation([...labels, " uat:stale"], [...labels, " uat:stale", "api"], false)).toBeNull();
    expect(staleLabelPatchViolation([...labels, " uat:stale"], labels, false)).toBeNull();
  });

  // S1-05: while uat:stale is on a task, its ticket identity cannot move.
  it("keeps kind:code and the ticket label on a task that carries uat:stale", () => {
    const stale = ["kind:code", ticket, UAT_STALE_LABEL];
    const identity = "keeps kind:code and its uat:<feedbackId> label";
    expect(staleLabelPatchViolation(stale, ["kind:code", "uat:cmfb7q2xk0002", UAT_STALE_LABEL], false)).toContain(identity);
    expect(staleLabelPatchViolation(stale, ["kind:decision", ticket, UAT_STALE_LABEL], false)).toContain(identity);
    expect(staleLabelPatchViolation(stale, ["kind:code", UAT_STALE_LABEL], false)).toContain(identity);
    // A write that ends the close may drop the label itself, or change identity.
    expect(staleLabelPatchViolation(stale, ["kind:code", ticket], false, true)).toBeNull();
    // Other labels move freely, and a write that ends the close may change identity too.
    expect(staleLabelPatchViolation(stale, [...stale, "uat-attempt:2", "uat:blocked"], false)).toBeNull();
    expect(staleLabelPatchViolation(stale, ["kind:code", "uat:cmfb7q2xk0002", UAT_STALE_LABEL], false, true)).toBeNull();
    // Without uat:stale the rule does not apply.
    expect(staleLabelPatchViolation(["kind:code", ticket], ["kind:decision", ticket], false)).toBeNull();
  });

  // S1-01, S1-07: which stage moves end a STALE close and drop its label.
  it("ends on a move to an open stage, or from verified back to merged", () => {
    for (const to of ["backlog", "specced", "approved", "planned", "progress", "qa", "review"]) {
      expect({ to, ends: endsStaleClose("merged", to) }).toEqual({ to, ends: true });
      expect({ to, ends: endsStaleClose("cancelled", to) }).toEqual({ to, ends: true });
    }
    expect(endsStaleClose("verified", "merged")).toBe(true);
    // Closing moves keep it as history, and a same-stage write is no move.
    for (const [from, to] of [["merged", "verified"], ["merged", "cancelled"], ["verified", "cancelled"], ["merged", "merged"], [undefined, "merged"]] as const) {
      expect({ from, to, ends: endsStaleClose(from, to) }).toEqual({ from, to, ends: false });
    }
  });
});
