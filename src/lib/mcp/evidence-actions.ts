// mc_upload_evidence (TASK-3166): an agent uploads a diagram, annotated
// screenshot or web page that a person opens to verify the work. MC stores the
// file on SharePoint and records a link and a SHA-256 on the task.
//
// A video (TASK-3167) larger than an inline upload goes in two calls: the first
// sends size and sha256 and gets a SharePoint upload session; the agent PUTs
// the file there; the second sends uploadedName, and MC reads the file back,
// checks its type, size and SHA-256, and records it.
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
  videoNameProblem,
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
  driveIdByName,
  driveItemByPath,
  driveItemContent,
  siteIdByPath,
  uploadSmallDriveFile,
} from "@/lib/sync/graph";
import { getBuckets, getEntity, lockSharedEvidence } from "@/lib/sync/repo";
import { mcpAuditActor, type McpIdentity } from "./auth";
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
  contentBase64: z.string().min(1).max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4).optional(),
  // A video over an upload session (TASK-3167): size and sha256 start it, uploadedName and sha256 finish it.
  size: z.number().int().positive().max(MAX_VIDEO_BYTES).optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  uploadedName: z.string().trim().min(1).max(200).optional(),
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

/** Upload-session chunks: a multiple of 320 KiB, as Graph requires. */
export const UPLOAD_CHUNK_BYTES = 32 * 320 * 1024;

type UploadStep = "inline" | "start" | "finish";

function uploadStep(input: UploadEvidenceInput): UploadStep {
  if (input.contentBase64 && input.size === undefined && input.sha256 === undefined && input.uploadedName === undefined) {
    return "inline";
  }
  if (input.contentBase64 === undefined && input.kind === "video" && input.sha256) {
    if (input.size !== undefined && input.uploadedName === undefined) return "start";
    if (input.uploadedName !== undefined && input.size === undefined) return "finish";
  }
  throw new ApiError(
    "invalid_request",
    "Send contentBase64 alone, or for a video: size and sha256 to start an upload session, then uploadedName and sha256.",
    400
  );
}

// The second and the content hash make the name unique: no upload replaces another.
const storedName = (uploadedAt: string, sha256: string, fileName: string) =>
  `${uploadedAt.replace(/[-:]/g, "").slice(0, 15)}Z-${sha256.slice(0, 8)}-${sharePointSafeName(fileName)}`;

/** Every SharePoint failure becomes a 503 that says what to do; other errors stay errors. */
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

/** Reads a stored file back: its size, SHA-256 and first bytes (for the type sniff). */
async function digestStream(stream: ReadableStream<Uint8Array>): Promise<{ size: number; sha256: string; head: Uint8Array }> {
  const hash = createHash("sha256");
  const head = new Uint8Array(2048);
  let size = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    if (size < head.length) head.set(chunk.subarray(0, head.length - size), size);
    size += chunk.length;
    if (size > MAX_VIDEO_BYTES) break;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex"), head: head.subarray(0, Math.min(size, head.length)) };
}

// A verified or cancelled task takes no new evidence; `after` names a file already uploaded.
function assertTaskOpen(taskId: string, task: Task, after = ""): void {
  if (task.stage === "cancelled" || task.stage === "verified") {
    throw new ApiError("task_closed", `${taskId} is ${task.stage}; it takes no new evidence.${after}`, 409);
  }
}

/** A recorded (or already stored) artifact, or for a video's first call the upload session to PUT to. */
export type UploadEvidenceResult = {
  ok: boolean;
  taskId: string;
  link: string;
  artifact?: EvidenceArtifact;
  duplicate?: boolean;
  upload?: { url: string; expiresAt: string; uploadedName: string; chunkBytes: number };
  next?: string;
};

export async function actionUploadEvidence(identity: McpIdentity, input: UploadEvidenceInput): Promise<UploadEvidenceResult> {
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  if (!dispatch?.taskId || dispatch.revoked || dispatch.releasedAt || new Date(dispatch.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
  }
  const taskId = dispatch.taskId;
  // The same grant as the hand-in, scoped to this task and repo. An open approval
  // gate does not stop uploads: the person who approves needs the evidence.
  requireMcpActor(identity, "task.complete", { type: "task", id: taskId }, { repositoryId: dispatch.repo });
  await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));

  const step = uploadStep(input);
  const bytes = input.contentBase64 ? new Uint8Array(Buffer.from(input.contentBase64, "base64")) : null;
  // A finished session is checked once MC has read the file back.
  const problem =
    (step === "finish" ? null : artifactProblem(input.kind, input.contentType, bytes, bytes?.length ?? input.size)) ??
    (input.kind === "video" ? videoNameProblem(input.contentType, input.fileName) : null);
  if (problem) throw new ApiError("invalid_artifact", problem, 400);

  const ownSite = ownEvidenceSite(dispatch.repo);
  if (ownSite) {
    throw unavailable(`${ownSite} evidence goes on its own SharePoint site, never the PLX site. A person must set that site up first.`);
  }
  if (!evidenceStoreEnabled()) {
    throw unavailable(`Evidence uploads are off. ${PERSON_ACTION} Then set PLX_MC_EVIDENCE_STORE_ENABLED=1.`);
  }

  const task = (await getEntity("task", taskId))?.data as unknown as Task | undefined;
  if (!task) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
  assertTaskOpen(taskId, task);
  // Everyone with access to the shared library could read a restricted project's
  // evidence. MC never grants or narrows access itself, so it refuses instead.
  if (await isBucketInRestrictedProject(task.bucket)) {
    throw unavailable(
      `${taskId} is in a restricted project. Its evidence cannot go to the shared "${PLX_EVIDENCE_STORE.library}" library. ` +
        "A person must set up a destination that keeps the project's access rules."
    );
  }
  // A session's sha256 is checked against the stored file when it finishes.
  const sha256 = bytes ? createHash("sha256").update(bytes).digest("hex") : input.sha256!;
  // The same file again (a retry) returns the record it already has. Sent with
  // another kind, it reuses the stored file and corrects the kind and caption.
  const existing = task.evidence?.artifacts?.find((artifact) => artifact.sha256 === sha256);
  if (existing?.kind === input.kind) return { ok: true, taskId, link: taskLink(taskId), artifact: existing, duplicate: true };

  let uploaded: EvidenceArtifact | null = null;
  if (!existing) {
    const bucket = (await getBuckets()).find((candidate) => candidate.id === task.bucket);
    const system =
      TRACKED_REPOS.find((tracked) => tracked.repo.toLowerCase() === dispatch.repo.toLowerCase())?.displayName ?? dispatch.repo;
    const uploadedAt = new Date().toISOString();
    const folder = artifactFolder({ system, project: bucket?.project ?? null, bucket: task.bucket, taskId });

    if (step === "start") {
      const name = storedName(uploadedAt, sha256, input.fileName);
      const session = await onSharePoint(async () => createDriveUploadSession(await evidenceDriveId(), `${folder}/${name}`));
      return {
        ok: true,
        taskId,
        link: taskLink(taskId),
        upload: { url: session.uploadUrl, expiresAt: session.expirationDateTime, uploadedName: name, chunkBytes: UPLOAD_CHUNK_BYTES },
        next: "PUT the file to upload.url in chunks of chunkBytes with Content-Range and no Authorization header. Then call again with uploadedName and sha256.",
      };
    }

    let name: string;
    let item: { id: string; webUrl: string };
    let size: number;
    if (step === "finish") {
      // Only a name MC issued for this file: its hash prefix and file name must match.
      name = input.uploadedName!;
      if (!/^\d{8}T\d{6}Z$/.test(name.slice(0, 16)) || name.slice(16) !== `-${sha256.slice(0, 8)}-${sharePointSafeName(input.fileName)}`) {
        throw new ApiError("invalid_artifact", "uploadedName is not the name the upload session returned for this file.", 400);
      }
      const stored = await onSharePoint(async () => driveItemByPath(await evidenceDriveId(), `${folder}/${name}`));
      if (!stored) {
        throw new ApiError(
          "upload_not_found",
          `No file named ${name} in this task's current evidence folder. ` +
            "If the task or its bucket moved since the session started, the file may be in the original folder. " +
            "Start a new upload session for the current folder and upload the file again. " +
            "Otherwise, finish the PUTs to the existing session and retry.",
          409
        );
      }
      const digest = await onSharePoint(async () => digestStream(await driveItemContent(stored["@microsoft.graph.downloadUrl"])));
      const storedProblem = artifactProblem(input.kind, input.contentType, digest.head, digest.size);
      if (storedProblem) throw new ApiError("invalid_artifact", storedProblem, 400);
      if (digest.sha256 !== sha256) {
        throw new ApiError("invalid_artifact", "The stored file's SHA-256 does not match sha256. Start a new upload session.", 400);
      }
      item = stored;
      size = digest.size;
    } else {
      name = storedName(uploadedAt, sha256, input.fileName);
      item = await onSharePoint(async () => uploadSmallDriveFile(await evidenceDriveId(), `${folder}/${name}`, bytes!, input.contentType));
      size = bytes!.length;
    }
    uploaded = {
      kind: input.kind,
      name,
      caption: input.caption,
      url: item.webUrl,
      driveItemId: item.id,
      contentType: input.contentType,
      size,
      sha256,
      uploadedAt,
    };
  }

  // Recheck by hash under the task row lock: of two identical calls at the same
  // time, the second finds the first's record and appends nothing.
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
    const stored = artifacts.find((artifact) => artifact.sha256 === sha256);
    if (stored?.kind === input.kind) return { ok: true, taskId, link: taskLink(taskId), artifact: stored, duplicate: true };
    const base = stored ?? existing;
    if (base) {
      // The original upload sniffed the bytes before recording this type.
      // A session start supplies only a hash; its claimed type cannot relabel
      // a stored image as video. Check again here for concurrent relabels.
      const relabelProblem = artifactProblem(input.kind, base.contentType, null, base.size);
      if (relabelProblem) throw new ApiError("invalid_artifact", relabelProblem, 400);
    }
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
      actor: mcpAuditActor(identity),
      repo: dispatch.repo,
      taskId,
      payload: { kind: artifact.kind, name: artifact.name, url: artifact.url, size: artifact.size, sha256 },
    });
    return base
      ? { ok: true, taskId, link: taskLink(taskId), artifact, duplicate: true }
      : { ok: true, taskId, link: taskLink(taskId), artifact };
  });
}
