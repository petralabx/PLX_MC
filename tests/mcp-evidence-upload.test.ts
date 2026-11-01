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
  duringUpload: null as null | (() => void),
  beforeRecord: null as null | (() => void),
  locks: [] as string[],
  heldLock: null as null | Promise<void>,
  driveId: "drive-mc" as string | null,
  siteError: null as null | Error,
  uploads: [] as { driveId: string; path: string; size: number; contentType: string }[],
  sessions: [] as { driveId: string; path: string }[],
  stored: null as null | Uint8Array,
  storedPath: null as null | string,
  lookedUp: [] as string[],
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
  // The shared-evidence lock: a guard holding it (h.heldLock) delays the record step.
  lockSharedEvidence: vi.fn(async (_q: unknown, mode: string) => {
    h.locks.push(mode);
    await h.heldLock;
  }),
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
    const run = txChain.then(() => {
      h.beforeRecord?.();
      return fn({});
    });
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
      h.duringUpload?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { id: `item-${h.uploads.length}`, webUrl: `https://petrasoap.sharepoint.com/sites/PLXSite/${path}`, size: bytes.length };
    }),
    createDriveUploadSession: vi.fn(async (driveId: string, path: string) => {
      h.sessions.push({ driveId, path });
      return { uploadUrl: "https://petrasoap.sharepoint.com/upload/session-1", expirationDateTime: "2026-10-19T00:00:00Z" };
    }),
    driveItemByPath: vi.fn(async (_driveId: string, path: string) => {
      h.lookedUp.push(path);
      if (!h.stored || (h.storedPath && path !== h.storedPath)) return null;
      return {
        id: "item-video", webUrl: `https://petrasoap.sharepoint.com/sites/PLXSite/${path}`, size: h.stored.length,
        "@microsoft.graph.downloadUrl": "https://download/1",
      };
    }),
    // Two chunks, so the read-back joins them.
    driveItemContent: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(h.stored!.subarray(0, 5));
            controller.enqueue(h.stored!.subarray(5));
            controller.close();
          },
        })
    ),
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
  h.duringUpload = null;
  h.beforeRecord = null;
  h.locks.length = 0;
  h.heldLock = null;
  h.driveId = "drive-mc";
  h.siteError = null;
  h.uploads.length = 0;
  h.sessions.length = 0;
  h.lookedUp.length = 0;
  h.stored = null;
  h.storedPath = null;
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
      `PLX Mission Control/PRJ-PLX-MC-FRONTIER/BKT-HUMAN/TASK-3166/${res.artifact!.uploadedAt.replace(/[-:]/g, "").slice(0, 15)}Z-${sha.slice(0, 8)}-flow.svg`
    );
    expect(res.artifact!.name).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}-flow\.svg$/);
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
    const stored = { kind: "diagram", name: "n.png", caption: "old", url: "https://sp/n.png", driveItemId: "first", sha256, contentType: "image/png", size: png.length };
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
    expect([first.artifact!.driveItemId, second.artifact!.driveItemId]).toEqual(["item-2", "item-2"]);
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

  const RELOCATE =
    /^TASK-3166 came under a restricted project during the upload\. Nothing was recorded\. The file \d{8}T\d{6}Z-[0-9a-f]{8}-flow\.svg was uploaded to https:\/\/.+\. A person must relocate it out of the shared "Mission Control" library\.$/;

  it("records nothing when the task moved into a restricted project during the upload", async () => {
    h.moveDuringUpload = true;
    await expect(upload()).rejects.toMatchObject({ code: "evidence_store_unavailable", message: expect.stringMatching(RELOCATE) });
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("records nothing when the task's project was restricted during the upload (same bucket)", async () => {
    h.duringUpload = () => void (h.restricted = true);
    await expect(upload()).rejects.toMatchObject({ code: "evidence_store_unavailable", message: expect.stringMatching(RELOCATE) });
    expect(h.uploads).toHaveLength(1);
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("waits on the shared-evidence lock, so a restrict that holds it commits first and nothing is recorded", async () => {
    // A concurrent restrict holds the exclusive lock when the record step starts,
    // and commits (project now restricted) only after the record step asks for it.
    let commit!: () => void;
    h.heldLock = new Promise<void>((resolve) => (commit = resolve));
    h.beforeRecord = () => void setTimeout(() => ((h.restricted = true), commit()), 5);
    await expect(upload()).rejects.toMatchObject({ code: "evidence_store_unavailable", message: expect.stringMatching(RELOCATE) });
    expect(h.locks).toEqual(["share"]);
    expect(h.patched).toHaveLength(0);
  });

  it("refuses to record on a task closed during the upload, and names the uploaded file", async () => {
    h.duringUpload = () => void (h.task = { ...h.task, stage: "verified" });
    await expect(upload()).rejects.toMatchObject({
      code: "task_closed",
      status: 409,
      message: expect.stringMatching(/^TASK-3166 is verified; it takes no new evidence\. The file \d{8}T\d{6}Z-[0-9a-f]{8}-flow\.svg was uploaded to https:\/\/.+ but is not recorded\.$/),
    });
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("refuses to relabel on a task cancelled before the record step", async () => {
    const sha256 = createHash("sha256").update(svg).digest("hex");
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [{ kind: "screenshot", driveItemId: "first", sha256 }] } };
    h.beforeRecord = () => void (h.task = { ...h.task, stage: "cancelled" });
    await expect(upload()).rejects.toMatchObject({ code: "task_closed", message: "TASK-3166 is cancelled; it takes no new evidence." });
    expect(h.uploads).toHaveLength(0);
    expect(h.patched).toHaveLength(0);
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

  // TASK-4421: throttling tells the caller when to retry; MC does not retry itself.
  it("returns Graph's Retry-After as retryAfterMs on a 429 or 503, without retrying", async () => {
    h.siteError = new GraphError(429, "slow down", "https://graph/sites", 7_000);
    await expect(upload()).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      status: 503,
      retryAfterMs: 7_000,
      message: expect.stringMatching(/Try again after 7 s/),
    });
    expect(driveIdByName).not.toHaveBeenCalled();
    h.siteError = new GraphError(503, "busy", "https://graph/sites", 1_500);
    await expect(upload()).rejects.toMatchObject({ retryAfterMs: 1_500 });
    h.siteError = new GraphError(500, "boom", "https://graph/sites", 1_500);
    await expect(upload()).rejects.toMatchObject({ retryAfterMs: undefined });
  });

  it("forgets the cached drive id on a 404, so a recreated library is found again", async () => {
    await upload();
    const graph = await import("@/lib/sync/graph");
    vi.mocked(graph.uploadSmallDriveFile).mockRejectedValueOnce(new GraphError(404, "gone", "https://graph/drives/drive-mc"));
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [] } };
    await expect(upload({ fileName: "second.svg", contentBase64: Buffer.from(svg + " ").toString("base64") })).rejects.toMatchObject({
      code: "evidence_store_unavailable",
    });
    h.driveId = "drive-new";
    await upload({ fileName: "third.svg", contentBase64: Buffer.from(svg + "  ").toString("base64") });
    expect(h.uploads.at(-1)?.driveId).toBe("drive-new");
  });
});

// TASK-3167: a video too big to send inline goes in an upload session. MC opens
// the session, the agent PUTs the bytes to SharePoint, and MC reads the file
// back to check its type, size and SHA-256 before it records it.
describe("mc_upload_evidence video upload session", () => {
  const mp4 = new Uint8Array([0, 0, 0, 0x20, ...[..."ftypisom"].map((c) => c.charCodeAt(0)), 1, 2, 3, 4, 5, 6]);
  const sha256 = createHash("sha256").update(mp4).digest("hex");
  const video = { kind: "video", fileName: "explainer.mp4", contentType: "video/mp4", caption: "How the gate works", contentBase64: undefined };
  const start = (over: Record<string, unknown> = {}) => upload({ ...video, size: mp4.length, sha256, ...over });

  it("opens a session at the task folder and records nothing yet", async () => {
    const res = await start();
    expect(res.upload).toMatchObject({ url: "https://petrasoap.sharepoint.com/upload/session-1", chunkBytes: 10 * 1024 * 1024 });
    expect(res.upload!.uploadedName).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-${sha256.slice(0, 8)}-explainer\\.mp4$`));
    expect(h.sessions).toEqual([
      { driveId: "drive-mc", path: `PLX Mission Control/PRJ-PLX-MC-FRONTIER/BKT-HUMAN/TASK-3166/${res.upload!.uploadedName}` },
    ]);
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("records the stored video once its bytes, size and SHA-256 check out", async () => {
    const { upload: session } = await start();
    h.stored = mp4;
    const res = await upload({ ...video, sha256, uploadedName: session!.uploadedName });
    expect(res.artifact).toMatchObject({ kind: "video", driveItemId: "item-video", size: mp4.length, sha256, contentType: "video/mp4" });
    const evidence = h.patched[0].evidence as { artifacts: { driveItemId: string }[] };
    expect(evidence.artifacts.map((a) => a.driveItemId)).toEqual(["old", "item-video"]);
    expect(h.events).toMatchObject([{ kind: "task.evidence.uploaded", payload: { kind: "video", sha256 } }]);
  });

  it("refuses a stored file whose SHA-256 or type does not match", async () => {
    const { upload: session } = await start();
    h.stored = new Uint8Array([...mp4.subarray(0, 12), 9, 9, 9, 9, 9, 9]);
    await expect(upload({ ...video, sha256, uploadedName: session!.uploadedName })).rejects.toMatchObject({
      code: "invalid_artifact", status: 400, message: expect.stringMatching(/SHA-256 does not match/),
    });
    h.stored = new TextEncoder().encode("<!DOCTYPE html><html></html>");
    await expect(upload({ ...video, sha256, uploadedName: session!.uploadedName })).rejects.toMatchObject({
      code: "invalid_artifact", message: "The file content is text/html, not video/mp4.",
    });
    expect(h.patched).toHaveLength(0);
  });

  it("says the upload is not finished when SharePoint has no file yet", async () => {
    const { upload: session } = await start();
    await expect(upload({ ...video, sha256, uploadedName: session!.uploadedName })).rejects.toMatchObject({ code: "upload_not_found", status: 409 });
  });

  it("refuses to relabel a diagram as a video using only its hash", async () => {
    const { artifact } = await upload();
    const patches = h.patched.length;
    const events = h.events.length;
    await expect(start({ sha256: artifact!.sha256, size: artifact!.size })).rejects.toMatchObject({
      code: "invalid_artifact", status: 400, message: /A video must be .*not image\/svg\+xml/,
    });
    expect(h.patched).toHaveLength(patches);
    expect(h.events).toHaveLength(events);
    expect(h.sessions).toHaveLength(0);
    expect((h.task!.evidence as { artifacts: { kind: string }[] }).artifacts.at(-1)!.kind).toBe("diagram");
  });

  it("checks a relabel that appears only under the task row lock", async () => {
    h.beforeRecord = () => {
      h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [
        { kind: "diagram", sha256, contentType: "image/png", size: mp4.length },
      ] } };
    };
    await expect(upload({ ...video, contentBase64: Buffer.from(mp4).toString("base64") })).rejects.toMatchObject({
      code: "invalid_artifact", status: 400,
    });
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
  });

  it("gives recovery instructions after a task move and accepts a new session", async () => {
    const { upload: session } = await start();
    h.stored = mp4;
    h.storedPath = h.sessions[0].path;
    h.task = { ...h.task, bucket: "BKT-OTHER" };
    await expect(upload({ ...video, sha256, uploadedName: session!.uploadedName })).rejects.toMatchObject({
      code: "upload_not_found", status: 409,
      message: expect.stringMatching(/task.*moved.*Start a new upload session/),
    });
    expect(h.patched).toHaveLength(0);
    expect(h.events).toHaveLength(0);
    const restarted = await start();
    h.storedPath = h.sessions[1].path;
    expect(h.storedPath).toContain("/BKT-OTHER/");
    const result = await upload({ ...video, sha256, uploadedName: restarted.upload!.uploadedName });
    expect(result.artifact).toMatchObject({ kind: "video", sha256 });
    expect(h.events).toHaveLength(1);
  });

  it("only finishes a name the session issued for this file", async () => {
    h.stored = mp4;
    for (const uploadedName of ["../TASK-1/x.mp4", `20261018T120000Z-${"f".repeat(8)}-explainer.mp4`, `20261018T120000Z-${sha256.slice(0, 8)}-other.mp4`]) {
      await expect(upload({ ...video, sha256, uploadedName })).rejects.toMatchObject({ code: "invalid_artifact", status: 400 });
    }
    expect(h.lookedUp).toHaveLength(0);
  });

  it("refuses a video over 100 MiB, the wrong extension, or a session for another kind", async () => {
    await expect(start({ size: 100 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: "invalid_artifact", message: /Limit: 104857600\.$/ });
    await expect(start({ fileName: "explainer.mov" })).rejects.toMatchObject({ code: "invalid_artifact", message: "A video/mp4 video must be named *.mp4." });
    await expect(start({ kind: "screenshot", contentType: "image/png", fileName: "x.png" })).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    expect(h.sessions).toHaveLength(0);
  });

  it("returns the existing record for a video the task already has, without a session", async () => {
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [{ kind: "video", driveItemId: "first", sha256 }] } };
    const res = await start();
    expect(res).toMatchObject({ duplicate: true, artifact: { driveItemId: "first" } });
    expect(h.sessions).toHaveLength(0);
  });

  it("keeps the store rules: uploads off never open a session", async () => {
    h.storeEnabled = false;
    await expect(start()).rejects.toMatchObject({ code: "evidence_store_unavailable", status: 503 });
    expect(h.sessions).toHaveLength(0);
  });
});
