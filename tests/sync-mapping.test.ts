// Mapping-layer invariants (SHAREPOINT_INTEGRATION.md §3, §5.2, §6):
// direction filtering, the Likelihood Medium↔Med normalization, date
// round-trips, and conflict-vs-apply reconciliation. These protect the sync
// contract, not the implementation.

import { describe, expect, it } from "vitest";
import type { Risk, Task } from "@/lib/mc-data";
import {
  bucketOutboundFields,
  classifyLastModifiedBy,
  dueToIso,
  inboundBucketPatches,
  inboundPatches,
  inboundProjectPatches,
  isoToDue,
  mcDateToIso,
  outboundFields,
  parseFieldValue,
  projectOutboundFields,
  reconcileInbound,
  serializeSubtasks,
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
  accountableOwner: "vince",
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

  it("defaults Target Environment to Staging and serializes an explicit value", () => {
    expect(fields.TargetEnvironment).toBe("Staging");
    expect(outboundFields("task", { ...task, targetEnv: "production" } as never).TargetEnvironment).toBe("Production");
  });

  it("emits person columns as <Name>LookupId from pre-resolved ids; Initiative only when resolved", () => {
    // The person mirror is wired (Item 1): the engine resolves each MC actor
    // to its site User Information List id and passes it in `persons`; the pure
    // layer emits `<InternalName>LookupId`. With no `persons` / initiative opts
    // nothing is emitted (back-compat).
    expect(Object.keys(fields)).not.toContain("AssignedToLookupId");
    expect(Object.keys(fields)).not.toContain("Initiative");
    expect(Object.keys(fields)).not.toContain("InitiativeLookupId");

    const resolved = outboundFields("task", task as never, {
      creating: true,
      persons: { assignee: 23, accountableOwner: 7, reporter: 42 },
      initiativeLookupId: 99,
    });
    expect(resolved.AssignedToLookupId).toBe(23);
    expect(resolved.AccountableOwnerLookupId).toBe(7);
    expect(resolved.ReporterLookupId).toBe(42);
    expect(resolved.InitiativeLookupId).toBe(99);
    // never the bare person column name or bare Initiative column
    expect(Object.keys(resolved)).not.toContain("AssignedTo");
    expect(Object.keys(resolved)).not.toContain("Initiative");
  });

  it("emits a null LookupId to CLEAR a person, and omits a field absent from `persons`", () => {
    const cleared = outboundFields("task", task as never, { persons: { assignee: null } });
    // null is sent to clear the SharePoint person column (unassign), not omitted…
    expect("AssignedToLookupId" in cleared).toBe(true);
    expect(cleared.AssignedToLookupId).toBeNull();
    // …while a field not present in the map is left untouched (omitted).
    expect("AccountableOwnerLookupId" in cleared).toBe(false);
    expect("ReporterLookupId" in cleared).toBe(false);
  });

  it("honors the `only` filter for a targeted person push", () => {
    const out = outboundFields("task", task as never, {
      only: ["assignee"],
      persons: { assignee: 9, accountableOwner: 7, reporter: 42 },
    });
    expect(Object.keys(out)).toEqual(["AssignedToLookupId"]);
    expect(out.AssignedToLookupId).toBe(9);
  });

  it("emits Subtasks (push-only) and InitiativeLookupId when resolved; still not labels/coassignees", () => {
    const t: Task = {
      ...task,
      bucket: "BKT-DAPI",
      labels: ["go-live", "api"],
      coassignees: ["ricardo", "stephen"],
      subtasks: [{ id: "SUB-1", t: "spike", done: false, who: "vince" }],
    };
    const keys = Object.keys(outboundFields("task", t as never, { creating: true, initiativeLookupId: 12 }));
    expect(keys).toContain("Subtasks");
    expect(keys).toContain("InitiativeLookupId");
    expect(keys).not.toContain("Initiative");
    expect(keys).not.toContain("Bucket");
    expect(keys).not.toContain("Labels");
    expect(keys).not.toContain("Coassignees");
  });

  it("clears Initiative with null and omits it when unresolved (undefined)", () => {
    expect(outboundFields("task", task as never, { initiativeLookupId: null }).InitiativeLookupId).toBeNull();
    expect("InitiativeLookupId" in outboundFields("task", task as never)).toBe(false);
  });

  it("honors the `only` filter for a targeted Initiative push", () => {
    const out = outboundFields("task", task as never, {
      only: ["bucket"],
      initiativeLookupId: 5,
    });
    expect(Object.keys(out)).toEqual(["InitiativeLookupId"]);
    expect(out.InitiativeLookupId).toBe(5);
  });

  it("honors the `only` filter for targeted pushes", () => {
    expect(Object.keys(outboundFields("task", task as never, { only: ["stage"] }))).toEqual(["Status"]);
  });
});

describe("serializeSubtasks (Item 3 — push-only sub-task mirror)", () => {
  it("renders one stable human-readable line per sub-task with executor/due/status", () => {
    const out = serializeSubtasks([
      { id: "SUB-1", t: "spike the adapter", done: true, who: "vince", assignee: "ricardo", due: "Jun 16", status: "done" },
      { id: "SUB-2", t: "write tests", done: false, who: "vince" },
    ]);
    const lines = out.split("\n");
    expect(lines[0]).toContain("[x] SUB-1 · spike the adapter");
    expect(lines[0]).toContain("@Ricardo"); // assignee resolved to a display name
    expect(lines[0]).toContain("due Jun 16");
    expect(lines[0]).toContain("done");
    // Falls back to the legacy single-avatar `who` when no explicit assignee.
    expect(lines[1]).toBe("[ ] SUB-2 · write tests · @Vince Alton");
  });

  it("is the empty string for no sub-tasks (nothing to mirror)", () => {
    expect(serializeSubtasks([])).toBe("");
    expect(serializeSubtasks(undefined)).toBe("");
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
      TargetEnvironment: "Production",
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

  it("applies a resolved Initiative bucket id from opts", () => {
    expect(inboundPatches("task", { Title: "x" }, { bucket: "BKT-INFRA" })).toEqual({
      title: "x",
      bucket: "BKT-INFRA",
    });
    expect(inboundPatches("task", {}, { bucket: null })).toEqual({ bucket: null });
  });
});

describe("inboundBucketPatches (Roadmap Gantt)", () => {
  it("maps Title/Health/dates and skips unknown health", () => {
    expect(
      inboundBucketPatches({
        Title: "Ops",
        Health: "At risk",
        StartDate: dueToIso("Jun 11")!,
        TargetDate: dueToIso("Jul 20")!,
        PercentComplete: 40,
      })
    ).toEqual({
      name: "Ops",
      health: "risk",
      started: "Jun 11",
      target: "Jul 20",
      progress: 40,
    });
    expect(inboundBucketPatches({ Health: "Nope" })).toEqual({});
  });

  it("applies resolved project id from opts", () => {
    expect(inboundBucketPatches({ Title: "X" }, { project: "PRJ-A" })).toEqual({
      name: "X",
      project: "PRJ-A",
    });
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

  it("newer human SharePoint edit beats older service pending on routing fields", () => {
    const { apply, conflicts, clearedDirty, attributionEvents } = reconcileInbound(
      { stage: "progress", title: "Old" },
      ["stage"],
      { stage: "merged" },
      {
        inboundSource: "human",
        inboundAt: "2026-07-14T18:00:00.000Z",
        localAttribution: {
          stage: { source: "service", at: "2026-07-14T17:00:00.000Z", actorId: "sp_mcp" },
        },
        routingFields: new Set(["stage", "title"]),
      }
    );
    expect(apply).toEqual({ stage: "merged" });
    expect(conflicts).toEqual([]);
    expect(clearedDirty).toEqual(["stage"]);
    expect(attributionEvents[0]?.action).toBe("human_over_service");
  });

  it("retains manual conflict for human-vs-human and unknown local attribution", () => {
    const human = reconcileInbound(
      { stage: "progress" },
      ["stage"],
      { stage: "merged" },
      {
        inboundSource: "human",
        inboundAt: "2026-07-14T18:00:00.000Z",
        localAttribution: { stage: { source: "human", at: "2026-07-14T17:00:00.000Z" } },
        routingFields: new Set(["stage"]),
      }
    );
    expect(human.conflicts).toHaveLength(1);
    expect(human.apply).toEqual({});

    const unknown = reconcileInbound(
      { stage: "progress" },
      ["stage"],
      { stage: "merged" },
      {
        inboundSource: "human",
        inboundAt: "2026-07-14T18:00:00.000Z",
        localAttribution: { stage: { source: "unknown", at: "2026-07-14T17:00:00.000Z" } },
        routingFields: new Set(["stage"]),
      }
    );
    expect(unknown.conflicts).toHaveLength(1);
  });

  it("does not let an older human edit beat a newer service pending", () => {
    const { apply, conflicts } = reconcileInbound(
      { stage: "progress" },
      ["stage"],
      { stage: "merged" },
      {
        inboundSource: "human",
        inboundAt: "2026-07-14T16:00:00.000Z",
        localAttribution: { stage: { source: "service", at: "2026-07-14T17:00:00.000Z" } },
        routingFields: new Set(["stage"]),
      }
    );
    expect(apply).toEqual({});
    expect(conflicts).toHaveLength(1);
  });
});

describe("inbound project patches + classifyLastModifiedBy", () => {
  it("maps project Title/Health/desc and skips Owner/PRD", () => {
    expect(
      inboundProjectPatches({
        Title: "Ops",
        Health: "At risk",
        Description: "d",
        OwnerLookupId: 9,
        PRDLink: "https://evil.example",
      })
    ).toEqual({ name: "Ops", health: "risk", desc: "d" });
    expect(classifyLastModifiedBy({ user: { id: "oid-1", email: "a@b.com" } }).source).toBe("human");
    expect(classifyLastModifiedBy({ application: { id: "app-1" } }).source).toBe("service");
    expect(classifyLastModifiedBy(null).source).toBe("unknown");
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

describe("project + bucket outbound (P2 / EN-005 push mirrors)", () => {
  it("maps project health + dates and sets ProjectID on create", () => {
    const fields = projectOutboundFields(
      {
        id: "PRJ-X",
        name: "Portal",
        owner: "vince",
        health: "risk",
        target: "Oct 01",
        started: "2026.06.11",
        desc: "Umbrella",
        repos: [],
        sync: { state: "pending", ts: "—", sp: "Projects · unprovisioned" },
        prd: null,
      },
      { creating: true }
    );
    expect(fields.ProjectID).toBe("PRJ-X");
    expect(fields.Health).toBe("At risk");
    expect(fields.StartDate).toBeTruthy();
  });

  it("maps bucket fields and optional lookup ids including PercentComplete", () => {
    const fields = bucketOutboundFields(
      {
        id: "BKT-X",
        name: "Sync",
        owner: "vince",
        health: "track",
        target: "Jul 20",
        started: "2026.06.11",
        desc: "",
        repos: [],
        sync: { state: "pending", ts: "—", sp: "Roadmap · unprovisioned" },
        prd: null,
        project: "PRJ-X",
        progress: 25,
      },
      { creating: true, ownerLookupId: 42, projectLookupId: 7 }
    );
    expect(fields.InitiativeID).toBe("BKT-X");
    expect(fields.OwnerLookupId).toBe(42);
    expect(fields.ProjectLookupId).toBe(7);
    expect(fields.PercentComplete).toBe(25);
    expect(mcDateToIso("Jul 20")).toBeTruthy();
  });
});
