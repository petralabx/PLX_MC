// mc_upload_evidence (TASK-3166): an agent uploads a diagram, annotated
// screenshot or web page that a person opens to verify the work. MC stores the
// file on SharePoint and records a link and a SHA-256 on the task.
//
// Storage (decision, Vince, 2026-10-17): PLX work goes to the "Mission Control"
// library on the PLX site, under <system>/<project>/<bucket>/<task id>.
// Trading Lab (petralabx/agentic-swarm) evidence goes on its own site, never the
// PLX site. Agents never create the library or grant access: a person does,
// then sets PLX_MC_EVIDENCE_STORE_ENABLED=1. Until then every call says so.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import {
  EVIDENCE_ARTIFACT_KINDS,
  MAX_ARTIFACT_BYTES,
  MAX_VIDEO_BYTES,
  PLX_EVIDENCE_STORE,
  TRACKED_REPOS,
  artifactFolder,
  artifactProblem,
  ownEvidenceSite,
  sharePointSafeName,
  sniffContentType,
  videoUploadProblem,
} from "@/lib/compliance";
import * as complianceRepo from "@/lib/compliance/repo";
import type { EvidenceArtifact, Task } from "@/lib/mc-data";
import { assertTaskProjectAccess, isBucketInRestrictedProject } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { evidenceStoreEnabled } from "@/lib/secrets";
import { patchTask } from "@/lib/sync";
import {
  GraphError,
  createDriveUploadSession,
  deleteDriveItem,
  driveIdByName,
  driveItemByPath,
  driveItemContent,
  siteIdByPath,
  uploadSmallDriveFile,
} from "@/lib/sync/graph";
import { getBuckets, getEntity, lockSharedEvidence } from "@/lib/sync/repo";
import type { McpIdentity } from "./auth";
import { taskLink } from "./envelope";

const PERSON_ACTION =
  `A person must create the "${PLX_EVIDENCE_STORE.library}" library on the PLX SharePoint site ` +
  `(${PLX_EVIDENCE_STORE.site}) and allow the Mission Control app to use the site.`;

export const uploadEvidenceInputShape = {
  checkoutId: z.string().min(1),
  kind: z.enum(EVIDENCE_ARTIFACT_KINDS),
  fileName: z.string().trim().min(1).max(120),
  contentType: z.string().trim().min(1),
  caption: z.string().trim().min(1).max(500),
  contentBase64: z.string().min(1).max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4),
};
type UploadEvidenceInput = z.infer<z.ZodObject<typeof uploadEvidenceInputShape>>;

const unavailable = (message: string) => new ApiError("evidence_store_unavailable", message, 503);

// The library's drive id does not change: look it up once per process. A miss is never cached.
let cachedDriveId: string | null = null;
async function evidenceDriveId(): Promise<string> {
  if (cachedDriveId) return cachedDriveId;
  const driveId = await driveIdByName(await siteIdByPath(PLX_EVIDENCE_STORE.site), PLX_EVIDENCE_STORE.library);
  if (!driveId) {
    throw unavailable(`The "${PLX_EVIDENCE_STORE.library}" library does not exist on ${PLX_EVIDENCE_STORE.site}. ${PERSON_ACTION}`);
  }
  cachedDriveId = driveId;
  return driveId;
}

export function __clearEvidenceDriveCacheForTests(): void {
  cachedDriveId = null;
}

type LiveDispatch = NonNullable<Awaited<ReturnType<typeof complianceRepo.getDispatch>>> & { taskId: string };

/** A live checkout and the hand-in grant on its task and repo. An open approval gate does not stop uploads: the approver needs the evidence. */
async function authorizeUpload(identity: McpIdentity, checkoutId: string): Promise<LiveDispatch> {
  const dispatch = await complianceRepo.getDispatch(checkoutId);
  if (!dispatch?.taskId || dispatch.revoked || dispatch.releasedAt || new Date(dispatch.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
  }
  requireMcpActor(identity, "task.complete", { type: "task", id: dispatch.taskId }, { repositoryId: dispatch.repo });
  await assertTaskProjectAccess(dispatch.taskId, aclPrincipalFromMcp(identity));
  return dispatch as LiveDispatch;
}

// A verified or cancelled task takes no new evidence; `after` names a file already uploaded.
function assertTaskOpen(taskId: string, task: Task, after = ""): void {
  if (task.stage === "cancelled" || task.stage === "verified") {
    throw new ApiError("task_closed", `${taskId} is ${task.stage}; it takes no new evidence.${after}`, 409);
  }
}

/** The store must take this task's evidence, and the task must be open. `after` names a file already sent. */
async function openTaskForEvidence(dispatch: LiveDispatch, after = ""): Promise<Task> {
  const { taskId } = dispatch;
  const ownSite = ownEvidenceSite(dispatch.repo);
  if (ownSite) {
    throw unavailable(`${ownSite} evidence goes on its own SharePoint site, never the PLX site. A person must set that site up first.`);
  }
  if (!evidenceStoreEnabled()) {
    throw unavailable(`Evidence uploads are off. ${PERSON_ACTION} Then set PLX_MC_EVIDENCE_STORE_ENABLED=1.`);
  }
  const task = (await getEntity("task", taskId))?.data as unknown as Task | undefined;
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  assertTaskOpen(taskId, task, after);
  // Everyone with access to the shared library could read a restricted project's
  // evidence. MC never grants or narrows access itself, so it refuses instead.
  if (await isBucketInRestrictedProject(task.bucket)) {
    throw unavailable(
      `${taskId} is in a restricted project. Its evidence cannot go to the shared "${PLX_EVIDENCE_STORE.library}" library. ` +
        "A person must set up a destination that keeps the project's access rules." +
        after
    );
  }
  return task;
}

/** The record the task already has for this file, by SHA-256. */
const existingArtifact = (task: Task, sha256: string) => task.evidence?.artifacts?.find((artifact) => artifact.sha256 === sha256);

async function evidenceFolder(dispatch: LiveDispatch, task: Task): Promise<string> {
  const bucket = (await getBuckets()).find((candidate) => candidate.id === task.bucket);
  const system =
    TRACKED_REPOS.find((tracked) => tracked.repo.toLowerCase() === dispatch.repo.toLowerCase())?.displayName ?? dispatch.repo;
  return artifactFolder({ system, project: bucket?.project ?? null, bucket: task.bucket, taskId: dispatch.taskId });
}

// The second and the content hash make the name unique: no upload replaces another.
const EVIDENCE_NAME = /^\d{8}T\d{6}Z-([0-9a-f]{8})-/;
const evidenceName = (at: string, sha256: string, fileName: string) =>
  `${at.replace(/[-:]/g, "").slice(0, 15)}Z-${sha256.slice(0, 8)}-${sharePointSafeName(fileName)}`;

/** Runs a SharePoint call; every Graph error becomes a 503 that says what to do. */
async function onSharePoint<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof GraphError)) throw err;
    if (err.status === 403 || err.status === 404) {
      throw unavailable(`SharePoint refused the upload (${err.status}). ${PERSON_ACTION}`);
    }
    throw unavailable(`SharePoint returned ${err.status}. Try again later. If it repeats, tell a person.`);
  }
}

/**
 * Records the artifact under the task row lock. Of two identical calls at the
 * same time, the second finds the first's record and appends nothing. Sent with
 * another kind, the same file keeps its stored copy and gets the new kind and
 * caption. `uploaded` is the file this call stored, or null when the task has it.
 */
async function recordArtifact(
  identity: McpIdentity,
  dispatch: LiveDispatch,
  sha256: string,
  input: { kind: EvidenceArtifact["kind"]; caption: string },
  existing: EvidenceArtifact | undefined,
  uploaded: EvidenceArtifact | null
) {
  const { taskId } = dispatch;
  return withTransaction(async (q) => {
    const current = (await getEntity("task", taskId, q, true))?.data as unknown as Task | undefined;
    if (!current) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    // The task may have closed during the upload. MC never deletes the file.
    assertTaskOpen(taskId, current, uploaded ? ` The file ${uploaded.name} was uploaded to ${uploaded.url} but is not recorded.` : "");
    // A task move, bucket re-parent or project restrict may have committed since
    // the first check. Those take the shared-evidence lock exclusive, so under the
    // shared lock the task -> bucket -> project chain cannot change until commit.
    await lockSharedEvidence(q, "share");
    if (await isBucketInRestrictedProject(current.bucket, q)) {
      throw unavailable(
        `${taskId} came under a restricted project during the upload. Nothing was recorded.` +
          (uploaded
            ? ` The file ${uploaded.name} was uploaded to ${uploaded.url}. ` +
              `A person must relocate it out of the shared "${PLX_EVIDENCE_STORE.library}" library.`
            : "")
      );
    }
    const evidence = current.evidence ?? { summary: "", items: [] };
    const artifacts = evidence.artifacts ?? [];
    const stored = existingArtifact(current, sha256);
    if (stored?.kind === input.kind) return { ok: true, taskId, link: taskLink(taskId), artifact: stored, duplicate: true };
    const base = stored ?? existing;
    const artifact: EvidenceArtifact = base ? { ...base, kind: input.kind, caption: input.caption } : uploaded!;
    await patchTask(
      taskId,
      {
        evidence: { ...evidence, artifacts: stored ? artifacts.map((a) => (a === stored ? artifact : a)) : [...artifacts, artifact] },
      } as Parameters<typeof patchTask>[1],
      dispatch.accountableHuman ?? identity.operatorEmail,
      { query: q, attribution: { source: "service", actorId: identity.actor.id } }
    );
    await complianceRepo.appendEventTx(q, {
      kind: base ? "task.evidence.relabeled" : "task.evidence.uploaded",
      actor: `${identity.runtime}:${identity.operatorEmail}`,
      repo: dispatch.repo,
      taskId,
      payload: { kind: artifact.kind, name: artifact.name, url: artifact.url, size: artifact.size, sha256 },
    });
    return base
      ? { ok: true, taskId, link: taskLink(taskId), artifact, duplicate: true }
      : { ok: true, taskId, link: taskLink(taskId), artifact };
  });
}

export async function actionUploadEvidence(identity: McpIdentity, input: UploadEvidenceInput) {
  const dispatch = await authorizeUpload(identity, input.checkoutId);
  const { taskId } = dispatch;
  const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
  const problem = artifactProblem(input.kind, input.contentType, bytes);
  if (problem) throw new ApiError("invalid_artifact", problem, 400);
  const task = await openTaskForEvidence(dispatch);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // The same file again (a retry) returns the record it already has. Sent with
  // another kind, it reuses the stored file and corrects the kind and caption.
  const existing = existingArtifact(task, sha256);
  if (existing?.kind === input.kind) return { ok: true, taskId, link: taskLink(taskId), artifact: existing, duplicate: true };

  let uploaded: EvidenceArtifact | null = null;
  if (!existing) {
    const uploadedAt = new Date().toISOString();
    const name = evidenceName(uploadedAt, sha256, input.fileName);
    const folder = await evidenceFolder(dispatch, task);
    const item = await onSharePoint(async () =>
      uploadSmallDriveFile(await evidenceDriveId(), `${folder}/${name}`, bytes, input.contentType)
    );
    uploaded = {
      kind: input.kind,
      name,
      caption: input.caption,
      url: item.webUrl,
      driveItemId: item.id,
      contentType: input.contentType,
      size: bytes.length,
      sha256,
      uploadedAt,
    };
  }
  return recordArtifact(identity, dispatch, sha256, input, existing, uploaded);
}

// ─── Explainer video (TASK-3167) ─────────────────────────────────────────────
// A video is too large for one request (Vercel takes 4.5 MB). The agent starts an
// upload session, PUTs the bytes straight to SharePoint in chunks, then asks MC to
// finish. Finish re-reads the stored file and keeps it only when its SHA-256 and
// type match.

/** 10 MiB: a multiple of 320 KiB, as Graph upload sessions require. */
export const VIDEO_UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024;

const sha256Shape = z.string().regex(/^[0-9a-f]{64}$/, "a lowercase hex SHA-256");
const narrationVoiceShape = z.string().trim().min(1).max(120);

export const startEvidenceUploadInputShape = {
  checkoutId: z.string().min(1),
  kind: z.literal("video"),
  fileName: z.string().trim().min(1).max(120),
  contentType: z.string().trim().min(1),
  size: z.number().int().positive(),
  sha256: sha256Shape,
};
type StartEvidenceUploadInput = z.infer<z.ZodObject<typeof startEvidenceUploadInputShape>>;

export async function actionStartEvidenceUpload(identity: McpIdentity, input: StartEvidenceUploadInput) {
  const dispatch = await authorizeUpload(identity, input.checkoutId);
  const { taskId } = dispatch;
  const problem = videoUploadProblem(input.contentType, input.size);
  if (problem) throw new ApiError("invalid_artifact", problem, 400);
  const task = await openTaskForEvidence(dispatch);
  const existing = existingArtifact(task, input.sha256);
  if (existing) return { ok: true, taskId, link: taskLink(taskId), artifact: existing, duplicate: true };

  // The stored name always ends in .mp4, whatever the client called the file.
  const fileName = /\.mp4$/i.test(input.fileName) ? input.fileName : `${input.fileName}.mp4`;
  const name = evidenceName(new Date().toISOString(), input.sha256, fileName);
  const folder = await evidenceFolder(dispatch, task);
  const session = await onSharePoint(async () => createDriveUploadSession(await evidenceDriveId(), `${folder}/${name}`));
  return {
    ok: true,
    taskId,
    name,
    uploadUrl: session.uploadUrl,
    expiresAt: session.expirationDateTime,
    chunkBytes: VIDEO_UPLOAD_CHUNK_BYTES,
    next:
      "PUT the bytes to uploadUrl in chunks of chunkBytes, with Content-Range and no Authorization header. " +
      "Then call mc_finish_evidence_upload with this name.",
  };
}

export const finishEvidenceUploadInputShape = {
  checkoutId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(500),
  sha256: sha256Shape,
  narrationVoice: narrationVoiceShape,
};
type FinishEvidenceUploadInput = z.infer<z.ZodObject<typeof finishEvidenceUploadInputShape>>;

/** Reads the stored file: its SHA-256, its size and whether it starts like an MP4. */
async function readStoredVideo(stream: ReadableStream<Uint8Array>): Promise<{ sha256: string; size: number; mp4: boolean }> {
  const hash = createHash("sha256");
  const reader = stream.getReader();
  let size = 0;
  let head = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    size += value.length;
    if (head.length < 16) head = new Uint8Array([...head, ...value.subarray(0, 16 - head.length)]);
  }
  return { sha256: hash.digest("hex"), size, mp4: sniffContentType(head) === "video/mp4" };
}

/** Reads the stored video; a broken or slow stream becomes a 503 to retry, not an internal error. */
async function readStoredVideoOrRetry(driveId: string, itemId: string) {
  const stream = await onSharePoint(() => driveItemContent(driveId, itemId));
  try {
    return await readStoredVideo(stream);
  } catch {
    throw unavailable("SharePoint stopped sending the stored video. Call mc_finish_evidence_upload again.");
  }
}

export async function actionFinishEvidenceUpload(identity: McpIdentity, input: FinishEvidenceUploadInput) {
  const dispatch = await authorizeUpload(identity, input.checkoutId);
  const { taskId } = dispatch;
  const prefix = EVIDENCE_NAME.exec(input.name)?.[1];
  if (prefix !== input.sha256.slice(0, 8) || input.name.includes("/") || !/\.mp4$/i.test(input.name)) {
    throw new ApiError("invalid_artifact", "Use the name mc_start_evidence_upload returned for this file.", 400);
  }
  // The bytes may already be on SharePoint: a refusal here names that file, which MC never deletes.
  const task = await openTaskForEvidence(dispatch, ` If you sent the bytes, the file ${input.name} is stored but not recorded. A person must relocate it.`);
  const existing = existingArtifact(task, input.sha256);
  if (existing) return { ok: true, taskId, link: taskLink(taskId), artifact: existing, duplicate: true };
  // Finish may delete what it checks, so it never touches a file the task already records.
  if (task.evidence?.artifacts?.some((artifact) => artifact.name === input.name)) {
    throw new ApiError("invalid_artifact", `${input.name} is already recorded evidence; finish takes only a new upload.`, 409);
  }

  const folder = await evidenceFolder(dispatch, task);
  const driveId = await onSharePoint(evidenceDriveId);
  const item = await onSharePoint(() => driveItemByPath(driveId, `${folder}/${input.name}`));
  if (!item) {
    throw new ApiError(
      "upload_incomplete",
      `No file named ${input.name} is stored yet. PUT every chunk first; an expired session needs a new start.`,
      409
    );
  }
  if (task.evidence?.artifacts?.some((artifact) => artifact.driveItemId === item.id)) {
    throw new ApiError("invalid_artifact", `${input.name} is already recorded evidence; finish takes only a new upload.`, 409);
  }
  const stored = item.size > MAX_VIDEO_BYTES ? null : await readStoredVideoOrRetry(driveId, item.id);
  if (!stored || stored.sha256 !== input.sha256 || !stored.mp4) {
    // MC removes only the file it just checked, in its own evidence folder.
    await onSharePoint(() => deleteDriveItem(driveId, item.id));
    const why = !stored ? `it has ${item.size} bytes (limit ${MAX_VIDEO_BYTES})` : !stored.mp4 ? "it is not an MP4" : "its SHA-256 differs";
    throw new ApiError("invalid_artifact", `The stored file is not the video you started: ${why}. MC deleted it. Start again.`, 400);
  }
  const artifact: EvidenceArtifact = {
    kind: "video",
    name: input.name,
    caption: input.caption,
    url: item.webUrl,
    driveItemId: item.id,
    contentType: "video/mp4",
    size: stored.size,
    sha256: stored.sha256,
    uploadedAt: new Date().toISOString(),
    narrationVoice: input.narrationVoice,
  };
  return recordArtifact(identity, dispatch, stored.sha256, artifact, undefined, artifact);
}
