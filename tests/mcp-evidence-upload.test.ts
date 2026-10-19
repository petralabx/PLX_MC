// TASK-3166: mc_upload_evidence. A live checkout uploads a checked file to the
// PLX site's Mission Control library under <system>/<project>/<bucket>/<task id>,
// and the task keeps a link and a SHA-256. With uploads off, no library, refused
// access or the Trading Lab repo, the call says what a person must do and
// SharePoint is never touched. All seams are mocked in memory.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dispatch: null as null | Record<string, unknown>,
  task: null as null | Record<string, unknown>,
  storeEnabled: true,
  restricted: false,
  moveDuringUpload: false,
  driveId: "drive-mc" as string | null,
  siteError: null as null | Error,
  uploads: [] as { driveId: string; path: string; size: number; contentType: string }[],
  patched: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/compliance/repo", () => ({
  getDispatch: vi.fn(async () => h.dispatch),
  appendEventTx: vi.fn(async (_q: unknown, e: Record<string, unknown>) => {
    h.events.push(e);
    return "1";
  }),
}));
vi.mock("@/lib/sync/repo", () => ({
  getEntity: vi.fn(async () => (h.task ? { data: structuredClone(h.task) } : null)),
  getBuckets: vi.fn(async () => [{ id: "BKT-HUMAN", project: "PRJ-PLX-MC-FRONTIER" }]),
}));
vi.mock("@/lib/sync", () => ({
  patchTask: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
    h.patched.push(patch);
    h.task = { ...h.task, ...structuredClone(patch) };
    return {};
  }),
}));
// One transaction at a time, like the task row lock.
let txChain: Promise<unknown> = Promise.resolve();
vi.mock("@/lib/db", () => ({
  withTransaction: vi.fn((fn: (q: unknown) => unknown) => {
    const run = txChain.then(() => fn({}));
    txChain = run.catch(() => undefined);
    return run;
  }),
}));
vi.mock("@/lib/secrets", () => ({ evidenceStoreEnabled: () => h.storeEnabled }));
vi.mock("@/lib/permissions/project-acl-guard", () => ({
  assertTaskProjectAccess: vi.fn(async () => undefined),
  isBucketInRestrictedProject: vi.fn(async (bucket: string) => h.restricted || bucket === "BKT-PRIVATE"),
}));
vi.mock("@/lib/routing/mutations/actors", () => ({
  requireMcpActor: vi.fn(() => ({ actorId: "sp_mcp_claude_code" })),
  aclPrincipalFromMcp: () => ({ tokens: ["sp_mcp_claude_code"] }),
}));
vi.mock("@/lib/sync/graph", async () => {
  const { GraphError } = await vi.importActual<typeof import("@/lib/sync/graph")>("@/lib/sync/graph");
  return {
    GraphError,
    siteIdByPath: vi.fn(async (path: string) => {
      if (h.siteError) throw h.siteError;
      return `site:${path}`;
    }),
    driveIdByName: vi.fn(async () => h.driveId),
    uploadSmallDriveFile: vi.fn(async (driveId: string, path: string, bytes: Uint8Array, contentType: string) => {
      h.uploads.push({ driveId, path, size: bytes.length, contentType });
      if (h.moveDuringUpload) h.task = { ...h.task, bucket: "BKT-PRIVATE" };
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id: `item-${h.uploads.length}`, webUrl: `https://petrasoap.sharepoint.com/sites/PLXSite/${path}`, size: bytes.length };
    }),
  };
});

import { GraphError, driveIdByName } from "@/lib/sync/graph";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import { __clearEvidenceDriveCacheForTests, actionUploadEvidence } from "@/lib/mcp/evidence-actions";
import type { McpIdentity } from "@/lib/mcp/auth";

const identity: McpIdentity = {
  operatorEmail: "cos@petrasoap.com",
  runtime: "claude-code",
  workerId: "test",
  repo: "petralabx/PLX_MC",
  servicePrincipalId: "sp_mcp_claude_code",
  actor: { kind: "service", id: "sp_mcp_claude_code", status: "active" },
};

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
const upload = (over: Record<string, unknown> = {}) =>
  actionUploadEvidence(identity, {
    checkoutId: "dsp_live",
    kind: "diagram",
    fileName: "flow.svg",
    contentType: "image/svg+xml",
    caption: "The upload flow",
    contentBase64: Buffer.from(svg).toString("base64"),
    ...over,
  } as Parameters<typeof actionUploadEvidence>[1]);

beforeEach(() => {
  h.dispatch = {
    taskId: "TASK-3166", repo: "petralabx/PLX_MC", accountableHuman: "vince", revoked: false,
    releasedAt: null, expiresAt: "2099-01-01T00:00:00Z",
  };
  h.task = {
    id: "TASK-3166", bucket: "BKT-HUMAN",
    evidence: { summary: "s", items: [], artifacts: [{ kind: "screenshot", driveItemId: "old" }] },
  };
  h.storeEnabled = true;
  h.restricted = false;
  h.moveDuringUpload = false;
  h.driveId = "drive-mc";
  h.siteError = null;
  h.uploads.length = 0;
  h.patched.length = 0;
  h.events.length = 0;
  __clearEvidenceDriveCacheForTests();
  vi.mocked(driveIdByName).mockClear();
  vi.mocked(requireMcpActor).mockClear();
});

describe("mc_upload_evidence", () => {
  it("uploads to <system>/<project>/<bucket>/<task id> and appends the artifact to the evidence", async () => {
    const res = await upload();
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatchObject({ driveId: "drive-mc", contentType: "image/svg+xml", size: svg.length });
    const sha = createHash("sha256").update(svg).digest("hex");
    expect(h.uploads[0].path).toBe(
      `PLX Mission Control/PRJ-PLX-MC-FRONTIER/BKT-HUMAN/TASK-3166/${res.artifact.uploadedAt.replace(/[-:]/g, "").slice(0, 15)}Z-${sha.slice(0, 8)}-flow.svg`
    );
    expect(res.artifact.name).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}-flow\.svg$/);
    expect(requireMcpActor).toHaveBeenCalledWith(identity, "task.complete", { type: "task", id: "TASK-3166" }, { repositoryId: "petralabx/PLX_MC" });
    expect(res.artifact).toMatchObject({
      kind: "diagram", caption: "The upload flow", driveItemId: "item-1", contentType: "image/svg+xml",
      sha256: createHash("sha256").update(svg).digest("hex"),
    });
    const evidence = h.patched[0].evidence as { summary: string; artifacts: { driveItemId: string }[] };
    expect(evidence.summary).toBe("s");
    expect(evidence.artifacts.map((a) => a.driveItemId)).toEqual(["old", "item-1"]);
    expect(h.events).toMatchObject([{ kind: "task.evidence.uploaded", taskId: "TASK-3166", repo: "petralabx/PLX_MC" }]);
  });

  it("returns the existing record for the same file, without a second upload", async () => {
    const sha256 = createHash("sha256").update(svg).digest("hex");
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [{ kind: "diagram", driveItemId: "first", sha256 }] } };
    const res = await upload();
    expect(res).toMatchObject({ duplicate: true, artifact: { driveItemId: "first" } });
    expect(h.uploads).toHaveLength(0);
    expect(h.patched).toHaveLength(0);
  });

  it("corrects the kind and caption of the same PNG sent again, reusing the stored file", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const sha256 = createHash("sha256").update(png).digest("hex");
    const stored = { kind: "diagram", name: "n.png", caption: "old", url: "https://sp/n.png", driveItemId: "first", sha256 };
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [stored] } };
    const res = await upload({
      kind: "screenshot", caption: "The annotated screen", fileName: "n.png", contentType: "image/png", contentBase64: png.toString("base64"),
    });
    expect(h.uploads).toHaveLength(0);
    expect(res).toMatchObject({ duplicate: true, artifact: { ...stored, kind: "screenshot", caption: "The annotated screen" } });
    const evidence = h.patched[0].evidence as { artifacts: Record<string, unknown>[] };
    expect(evidence.artifacts).toEqual([{ ...stored, kind: "screenshot", caption: "The annotated screen" }]);
    expect(h.events).toMatchObject([{ kind: "task.evidence.relabeled", payload: { kind: "screenshot", sha256 } }]);
  });

  it("records one artifact for two identical uploads at the same time", async () => {
    const [first, second] = await Promise.all([upload(), upload()]);
    expect(h.uploads).toHaveLength(2);
    const artifacts = (h.task?.evidence as { artifacts: { driveItemId: string }[] }).artifacts;
    expect(artifacts.map((a) => a.driveItemId)).toEqual(["old", "item-2"]);
    expect([first.artifact.driveItemId, second.artifact.driveItemId]).toEqual(["item-2", "item-2"]);
    expect(second).toMatchObject({ duplicate: true });
    expect(h.events.filter((e) => e.kind === "task.evidence.uploaded")).toHaveLength(1);
  });

  it("looks the library up once per process", async () => {
    await upload();
    await upload({ contentBase64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>').toString("base64") });
    expect(h.uploads).toHaveLength(2);
    expect(driveIdByName).toHaveBeenCalledTimes(1);
  });

  it("refuses a cancelled or verified task before uploading", async () => {
    h.task = { ...h.task, stage: "verified" };
    await expect(upload()).rejects.toMatchObject({ code: "task_closed", status: 409 });
    expect(h.uploads).toHaveLength(0);
  });

  it("refuses a released checkout before anything else", async () => {
    h.dispatch = { ...h.dispatch, releasedAt: "2026-10-17T00:00:00Z" };
    await expect(upload()).rejects.toMatchObject({ code: "invalid_checkout", status: 409 });
    expect(h.uploads).toHaveLength(0);
  });

  it("refuses a file whose bytes are not the declared type", async () => {
    await expect(upload({ contentType: "image/png" })).rejects.toMatchObject({ code: "invalid_artifact", status: 400 });
    expect(h.uploads).toHaveLength(0);
  });

  it("says what a person must do while uploads are off, and never calls SharePoint", async () => {
    h.storeEnabled = false;
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      status: 503,
      message: expect.stringMatching(/A person must create the "Mission Control" library .* PLX_MC_EVIDENCE_STORE_ENABLED=1/),
    });
    expect(h.uploads).toHaveLength(0);
  });

  it("keeps Trading Lab evidence off the PLX site", async () => {
    h.dispatch = { ...h.dispatch, repo: "petralabx/agentic-swarm" };
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      message: expect.stringMatching(/^Trading Lab evidence goes on its own SharePoint site, never the PLX site/),
    });
    expect(h.uploads).toHaveLength(0);
  });

  it("keeps a restricted project's evidence out of the shared library", async () => {
    h.restricted = true;
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      status: 503,
      message: expect.stringMatching(/^TASK-3166 is in a restricted project\. .*keeps the project's access rules\.$/),
    });
    expect(h.uploads).toHaveLength(0);
    expect(h.patched).toHaveLength(0);
  });

  it("records nothing when the task moved into a restricted project during the upload", async () => {
    h.moveDuringUpload = true;
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      message: expect.stringMatching(/moved into a restricted project during the upload\. .*A person must remove https:\/\/.+ from the shared "Mission Control" library\.$/),
    });
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("never creates a missing library", async () => {
    h.driveId = null;
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      message: expect.stringMatching(/^The "Mission Control" library does not exist on \/sites\/PLXSite\./),
    });
    expect(h.uploads).toHaveLength(0);
  });

  it("turns every SharePoint error into a clear 503, and leaves other errors as errors", async () => {
    h.siteError = new GraphError(403, "denied", "https://graph/sites");
    await expect(upload()).rejects.toMatchObject({ code: "evidence_store_unavailable", message: expect.stringMatching(/refused the upload \(403\)/) });
    h.siteError = new GraphError(500, "boom", "https://graph/sites");
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      status: 503,
      message: "SharePoint returned 500. Try again later. If it repeats, tell a person.",
    });
    h.siteError = new TypeError("bug");
    await expect(upload()).rejects.toBeInstanceOf(TypeError);
    expect(h.patched).toHaveLength(0);
  });
});
