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
  patched: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  sessions: [] as { driveId: string; path: string }[],
  stored: null as null | { path: string; bytes: Uint8Array },
  deleted: [] as string[],
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
      return { uploadUrl: "https://sp/upload-session", expirationDateTime: "2026-10-18T00:00:00Z" };
    }),
    driveItemByPath: vi.fn(async (_driveId: string, path: string) =>
      h.stored?.path === path ? { id: "video-1", webUrl: `https://sp/${path}`, size: h.stored.bytes.length } : null
    ),
    driveItemContent: vi.fn(async () => new Blob([h.stored!.bytes as BlobPart]).stream()),
    deleteDriveItem: vi.fn(async (_driveId: string, itemId: string) => {
      h.deleted.push(itemId);
    }),
  };
});

import { GraphError, driveIdByName, driveItemContent } from "@/lib/sync/graph";
import { getEntity } from "@/lib/sync/repo";
import { requireMcpActor } from "@/lib/routing/mutations/actors";
import {
  VIDEO_UPLOAD_CHUNK_BYTES,
  __clearEvidenceDriveCacheForTests,
  actionFinishEvidenceUpload,
  actionStartEvidenceUpload,
  actionUploadEvidence,
} from "@/lib/mcp/evidence-actions";
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
  h.patched.length = 0;
  h.events.length = 0;
  h.sessions.length = 0;
  h.stored = null;
  h.deleted.length = 0;
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
});

// TASK-3167: a video is too large for one request. Start opens an upload session
// under the same folder rules; the client PUTs the bytes to SharePoint; finish
// re-reads the stored file and keeps it only when its SHA-256 and type match.
describe("explainer video upload (TASK-3167)", () => {
  const video = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4, 5, 6, 7, 8]);
  const sha = createHash("sha256").update(video).digest("hex");
  const start = (over: Record<string, unknown> = {}) =>
    actionStartEvidenceUpload(identity, {
      checkoutId: "dsp_live", kind: "video", fileName: "explainer.mp4", contentType: "video/mp4", size: video.length, sha256: sha,
      ...over,
    } as Parameters<typeof actionStartEvidenceUpload>[1]);
  const finish = (name: string, over: Record<string, unknown> = {}) =>
    actionFinishEvidenceUpload(identity, {
      checkoutId: "dsp_live", name, caption: "How uploads work", sha256: sha, narrationVoice: "piper:en_US-lessac-medium", ...over,
    } as Parameters<typeof actionFinishEvidenceUpload>[1]);
  const folder = "PLX Mission Control/PRJ-PLX-MC-FRONTIER/BKT-HUMAN/TASK-3166";

  it("opens a session at <folder>/<time>-<hash>-<name> and returns the chunk size", async () => {
    const res = await start();
    if (!("uploadUrl" in res)) throw new Error("expected a session");
    expect(res).toMatchObject({ uploadUrl: "https://sp/upload-session", chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES });
    expect(VIDEO_UPLOAD_CHUNK_BYTES % (320 * 1024)).toBe(0);
    expect(res.name).toMatch(new RegExp(`^\\d{8}T\\d{6}Z-${sha.slice(0, 8)}-explainer\\.mp4$`));
    expect(h.sessions).toEqual([{ driveId: "drive-mc", path: `${folder}/${res.name}` }]);
    expect(requireMcpActor).toHaveBeenCalledWith(identity, "task.complete", { type: "task", id: "TASK-3166" }, { repositoryId: "petralabx/PLX_MC" });
  });

  it("refuses a file that is not an MP4 or is too large, and keeps the step 2 refusals", async () => {
    await expect(start({ contentType: "video/webm" })).rejects.toMatchObject({ code: "invalid_artifact", status: 400 });
    await expect(start({ size: 300 * 1024 * 1024 })).rejects.toMatchObject({ code: "invalid_artifact" });
    h.restricted = true;
    await expect(start()).rejects.toMatchObject({ code: "evidence_store_unavailable" });
    expect(h.sessions).toHaveLength(0);
  });

  it("keeps the stored video when its SHA-256 matches, with the narration voice", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: video };
    const done = await finish(res.name);
    expect(done.artifact).toMatchObject({
      kind: "video", name: res.name, driveItemId: "video-1", contentType: "video/mp4", size: video.length, sha256: sha,
      narrationVoice: "piper:en_US-lessac-medium",
    });
    const evidence = h.patched[0].evidence as { artifacts: { kind: string }[] };
    expect(evidence.artifacts.map((a) => a.kind)).toEqual(["screenshot", "video"]);
    expect(h.events).toMatchObject([{ kind: "task.evidence.uploaded", taskId: "TASK-3166" }]);
    expect(h.deleted).toEqual([]);
  });

  it("names the sent file when the task closed or came under a restricted project after start, and deletes nothing", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: video };
    const sent = `If you sent the bytes, the file ${res.name} is stored but not recorded. A person must relocate it.`;
    h.restricted = true;
    await expect(finish(res.name)).rejects.toMatchObject({ code: "evidence_store_unavailable", message: expect.stringContaining(sent) });
    h.restricted = false;
    h.task = { ...h.task, stage: "cancelled" };
    await expect(finish(res.name)).rejects.toMatchObject({ code: "task_closed", status: 409, message: expect.stringContaining(sent) });
    expect(h.patched).toHaveLength(0);
    expect(h.deleted).toEqual([]);
  });

  it("records nothing when the project is restricted before the record step, under the shared-evidence lock", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: video };
    h.beforeRecord = () => void (h.restricted = true);
    await expect(finish(res.name)).rejects.toMatchObject({
      code: "evidence_store_unavailable",
      message: expect.stringContaining(`Nothing was recorded. The file ${res.name} was uploaded to`),
    });
    expect(h.locks).toEqual(["share"]);
    expect(h.patched).toHaveLength(0);
    expect(h.deleted).toEqual([]);
  });

  it("deletes a stored file whose SHA-256 differs or that is not an MP4", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: new Uint8Array([...video, 9]) };
    await expect(finish(res.name)).rejects.toMatchObject({ code: "invalid_artifact", message: expect.stringMatching(/its SHA-256 differs\. MC deleted it/) });
    const text = new TextEncoder().encode("not a video at all");
    const textSha = createHash("sha256").update(text).digest("hex");
    const name = res.name.replace(sha.slice(0, 8), textSha.slice(0, 8));
    h.stored = { path: `${folder}/${name}`, bytes: text };
    await expect(finish(name, { sha256: textSha })).rejects.toMatchObject({ message: expect.stringMatching(/it is not an MP4/) });
    expect(h.deleted).toEqual(["video-1", "video-1"]);
    expect(h.patched).toHaveLength(0);
  });

  it("names the stored file .mp4 whatever the client called it", async () => {
    const res = await start({ fileName: "explainer" });
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    expect(res.name).toMatch(/-explainer\.mp4$/);
  });

  it("never touches a file the task already records, even with a matching hash prefix", async () => {
    const recorded = `20261017T120000Z-${sha.slice(0, 8)}-diagram.mp4`;
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [{ kind: "diagram", name: recorded, driveItemId: "video-1", sha256: "f".repeat(64) }] } };
    h.stored = { path: `${folder}/${recorded}`, bytes: new Uint8Array([9, 9, 9]) };
    await expect(finish(recorded)).rejects.toMatchObject({ code: "invalid_artifact", status: 409 });
    const other = `20261017T120000Z-${sha.slice(0, 8)}-other.mp4`;
    h.stored = { path: `${folder}/${other}`, bytes: new Uint8Array([9, 9, 9]) };
    await expect(finish(other)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already recorded evidence/) });
    expect(h.deleted).toEqual([]);
  });

  it("records a raced retry once", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: video };
    const first = await finish(res.name);
    // The retry read the task before the first call committed; the row lock sees the record.
    const before = structuredClone(h.task);
    h.task = { ...h.task!, evidence: { summary: "s", items: [], artifacts: [first.artifact] } };
    vi.mocked(getEntity).mockImplementationOnce(async () => ({ data: before }) as never);
    const second = await finish(res.name);
    expect(second.artifact).toEqual(first.artifact);
    expect(h.patched).toHaveLength(1);
  });

  it("turns a broken download into a 503 to retry", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    h.stored = { path: `${folder}/${res.name}`, bytes: video };
    vi.mocked(driveItemContent).mockImplementationOnce(async () =>
      new ReadableStream({ pull: (controller) => controller.error(new Error("socket hang up")) })
    );
    await expect(finish(res.name)).rejects.toMatchObject({ code: "evidence_store_unavailable", status: 503 });
    expect(h.deleted).toEqual([]);
  });

  it("says the upload is incomplete when no file is stored, and refuses a foreign name", async () => {
    const res = await start();
    if (!("name" in res) || !res.name) throw new Error("expected a session");
    await expect(finish(res.name)).rejects.toMatchObject({ code: "upload_incomplete", status: 409 });
    await expect(finish("20261017T170000Z-ffffffff-other.mp4")).rejects.toMatchObject({ code: "invalid_artifact", status: 400 });
    await expect(finish(`../${res.name}`)).rejects.toMatchObject({ code: "invalid_artifact" });
    await expect(finish(res.name.replace(/\.mp4$/, ".png"))).rejects.toMatchObject({ code: "invalid_artifact", status: 400 });
  });

  it("returns the existing record for a video the task already has", async () => {
    h.task = { ...h.task, evidence: { summary: "s", items: [], artifacts: [{ kind: "video", driveItemId: "first", sha256: sha }] } };
    expect(await start()).toMatchObject({ duplicate: true, artifact: { driveItemId: "first" } });
    expect(h.sessions).toHaveLength(0);
  });

  it("sends a video through the session, and takes a valid video script inline", async () => {
    await expect(upload({ kind: "video", contentType: "video/mp4", contentBase64: Buffer.from(video).toString("base64") })).rejects.toMatchObject({
      code: "invalid_artifact",
      message: expect.stringMatching(/^A video goes up in chunks/),
    });
    const beats = JSON.stringify({ beats: [{ slug: "01-map", image: "map.png", narration: "The flow." }] });
    const res = await upload({ kind: "video-script", fileName: "beats.json", contentType: "application/json", contentBase64: Buffer.from(beats).toString("base64") });
    expect(res.artifact).toMatchObject({ kind: "video-script", contentType: "application/json" });
  });
});
