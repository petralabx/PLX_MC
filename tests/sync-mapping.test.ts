// Mapping-layer invariants (SHAREPOINT_INTEGRATION.md §3, §5.2, §6):
// direction filtering, the Likelihood Medium↔Med normalization, date
// round-trips, and conflict-vs-apply reconciliation. These protect the sync
// contract, not the implementation.

import { describe, expect, it } from "vitest";
import type { Risk, Task } from "@/lib/mc-data";
import {
  dueToIso,
  inboundPatches,
  isoToDue,
  outboundFields,
  parseFieldValue,
  reconcileInbound,
} from "@/lib/sync/mapping";

// Inline contract anchors — the mapping layer's behavior must not depend on
// whatever narrative fixtures currently exist.
const task: Task = {
  id: "TASK-214",
  title: "Inline deed signing on the workbench",
  bucket: "BKT-X",
  stage: "qa",
  priority: "high",
  assignee: null,
  coassignees: [],
  reporter: "vince",
  reqs: ["REQ-2"],
  repos: ["portal-web", "portal-api"],
  estimate: "L",
  labels: [],
  prs: [],
  due: "Jun 16",
  sync: { state: "pending", ts: "—", sp: "ToDos · unprovisioned" },
  subtasks: [],
  activity: [],
  evidence: {
    summary: "x",
    items: [
      { key: "a", label: "a", done: true },
      { key: "b", label: "b", done: false },
    ],
  },
};

const riskOf = (like: Risk["like"]): Risk => ({
  id: "RISK-X",
  bucket: "BKT-X",
  title: "Likelihood normalization anchor",
  like,
  impact: "High",
  owner: "vince",
  status: "open",
  mit: "—",
  sync: { state: "pending", ts: "—", sp: "Risk Register · unprovisioned" },
});

const mediumRisk = riskOf("Medium");

describe("outbound task mapping", () => {
  const fields = outboundFields("task", task as never, { creating: true });

  it("writes the unique key only on create", () => {
    expect(fields.TaskID).toBe("TASK-214");
    expect(outboundFields("task", task as never).TaskID).toBeUndefined();
  });

  it("serializes choice columns to the SharePoint choice sets", () => {
    expect(fields.Status).toBe("In QA");
    expect(fields.Priority).toBe("High");
    expect(fields.Estimate).toBe("L");
  });

  it("serializes dates to UTC ISO and multilines newline-joined", () => {
    expect(fields.DueDate).toMatch(/^\d{4}-06-16T00:00:00/);
    expect(fields.Repos).toBe("portal-web\nportal-api");
    expect(fields.PRDRequirements).toBe("REQ-2");
  });

  it("never emits person or lookup columns (directory increment)", () => {
    expect(Object.keys(fields)).not.toContain("AssignedTo");
    expect(Object.keys(fields)).not.toContain("Reporter");
    expect(Object.keys(fields)).not.toContain("Initiative");
  });

  it("honors the `only` filter for targeted pushes", () => {
    expect(Object.keys(outboundFields("task", task as never, { only: ["stage"] }))).toEqual(["Status"]);
  });
});

describe("§5.2 Likelihood normalization", () => {
  it("normalizes MC Medium → SharePoint Med outbound", () => {
    expect(outboundFields("risk", mediumRisk as never).Likelihood).toBe("Med");
  });

  it("keeps High/Low untouched", () => {
    expect(outboundFields("risk", riskOf("High") as never).Likelihood).toBe("High");
    expect(outboundFields("risk", riskOf("Low") as never).Likelihood).toBe("Low");
  });

  it("denormalizes Med → Medium inbound", () => {
    expect(inboundPatches("risk", { Likelihood: "Med" })).toEqual({ like: "Medium" });
  });
});

describe("inbound direction filtering", () => {
  it("never applies push-only columns inbound", () => {
    const patches = inboundPatches("task", {
      Repos: "evil",
      PRDRequirements: "evil",
      Estimate: "S",
      EvidenceComplete: false,
      Title: "ok",
    });
    expect(patches).toEqual({ title: "ok" });
  });

  it("maps Status labels back to stage keys and skips unknown values", () => {
    expect(inboundPatches("task", { Status: "In Progress" })).toEqual({ stage: "progress" });
    expect(inboundPatches("task", { Status: "Blocked-ish nonsense" })).toEqual({});
  });
});

describe("date round-trip", () => {
  it("parses display dates to UTC ISO and back", () => {
    const iso = dueToIso("Jun 16")!;
    expect(iso.endsWith("T00:00:00.000Z")).toBe(true);
    expect(isoToDue(iso)).toBe("Jun 16");
  });

  it("renders single-digit days padded, matching the fixture format", () => {
    expect(isoToDue(dueToIso("Jun 06")!)).toBe("Jun 06");
    expect(isoToDue(dueToIso("Jun 6")!)).toBe("Jun 06");
  });

  it("returns null for unparseable display values", () => {
    expect(dueToIso("—")).toBeNull();
    expect(dueToIso("")).toBeNull();
  });
});

describe("reconcileInbound (§5.1: conflict, never overwrite)", () => {
  it("applies clean patches and raises conflicts on dirty fields", () => {
    const { apply, conflicts } = reconcileInbound(
      { stage: "progress", due: "Jun 18" },
      ["stage"],
      { stage: "merged", due: "Jun 20" }
    );
    expect(apply).toEqual({ due: "Jun 20" });
    expect(conflicts).toEqual([{ field: "stage", mcVal: "progress", spVal: "merged" }]);
  });

  it("ignores identical values even when dirty", () => {
    const { apply, conflicts } = reconcileInbound({ stage: "progress" }, ["stage"], { stage: "progress" });
    expect(apply).toEqual({});
    expect(conflicts).toEqual([]);
  });
});

describe("parseFieldValue (keep-SharePoint resolution)", () => {
  it("validates choice values and rejects garbage", () => {
    expect(parseFieldValue("task", "stage", "In Progress")).toBe("progress");
    expect(parseFieldValue("task", "stage", "Blocked · due Jun 20")).toBeUndefined();
    expect(parseFieldValue("risk", "like", "Med")).toBe("Medium");
    expect(parseFieldValue("risk", "like", "Catastrophic")).toBeUndefined();
  });
});
