// UAT ticket task labels (TASK-3697). Invariants: a task is a UAT ticket task
// only with kind:code and a uat:<feedbackId> label; Steward's and the portal's
// state labels never name a ticket; only uat:hold and uat-attempt:<n> are
// portal-mirrored labels.
import { describe, expect, it } from "vitest";

import {
  hasHumanBlockLabel,
  isUatSyncLabel,
  isUatTicketTask,
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

  it("reads Steward's causes and the human-block labels", () => {
    expect(uatBlockCauses(["uat:blocked", "uat:cause:quota", "uat:cause:", "uat:cause:env"])).toEqual(["quota", "env"]);
    expect(hasHumanBlockLabel({ labels: ["uat:blocked"] })).toBe(true);
    expect(hasHumanBlockLabel({ labels: ["needs-vince"] })).toBe(true);
    expect(hasHumanBlockLabel({ labels: ["needs-info", "uat:hold"] })).toBe(false);
  });
});
