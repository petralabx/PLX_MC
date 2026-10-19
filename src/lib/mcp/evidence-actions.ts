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
  PLX_EVIDENCE_STORE,
  TRACKED_REPOS,
  artifactFolder,
  artifactProblem,
  ownEvidenceSite,
  sharePointSafeName,
} from "@/lib/compliance";
import * as complianceRepo from "@/lib/compliance/repo";
import type { EvidenceArtifact, Task } from "@/lib/mc-data";
import { assertTaskProjectAccess, isBucketInRestrictedProject } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { evidenceStoreEnabled } from "@/lib/secrets";
import { patchTask } from "@/lib/sync";
import { GraphError, driveIdByName, siteIdByPath, uploadSmallDriveFile } from "@/lib/sync/graph";
import { getBuckets, getEntity } from "@/lib/sync/repo";
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

export async function actionUploadEvidence(identity: McpIdentity, input: UploadEvidenceInput) {
  const dispatch = await complianceRepo.getDispatch(input.checkoutId);
  if (!dispatch?.taskId || dispatch.revoked || dispatch.releasedAt || new Date(dispatch.expiresAt).getTime() <= Date.now()) {
    throw new ApiError("invalid_checkout", "Unknown, revoked, released, or expired checkout.", 409);
  }
  const taskId = dispatch.taskId;
  // The same grant as the hand-in, scoped to this task and repo. An open approval
  // gate does not stop uploads: the person who approves needs the evidence.
  requireMcpActor(identity, "task.complete", { type: "task", id: taskId }, { repositoryId: dispatch.repo });
  await assertTaskProjectAccess(taskId, aclPrincipalFromMcp(identity));

  const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
  const problem = artifactProblem(input.kind, input.contentType, bytes);
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
  if (task.stage === "cancelled" || task.stage === "verified") {
    throw new ApiError("task_closed", `${taskId} is ${task.stage}; it takes no new evidence.`, 409);
  }
  // Everyone with access to the shared library could read a restricted project's
  // evidence. MC never grants or narrows access itself, so it refuses instead.
  if (await isBucketInRestrictedProject(task.bucket)) {
    throw unavailable(
      `${taskId} is in a restricted project. Its evidence cannot go to the shared "${PLX_EVIDENCE_STORE.library}" library. ` +
        "A person must set up a destination that keeps the project's access rules."
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
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
    // The second and the content hash make the name unique: no upload replaces another.
    const name = `${uploadedAt.replace(/[-:]/g, "").slice(0, 15)}Z-${sha256.slice(0, 8)}-${sharePointSafeName(input.fileName)}`;
    const folder = artifactFolder({ system, project: bucket?.project ?? null, bucket: task.bucket, taskId });

    let item: { id: string; webUrl: string };
    try {
      item = await uploadSmallDriveFile(await evidenceDriveId(), `${folder}/${name}`, bytes, input.contentType);
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      if (err.status === 403 || err.status === 404) {
        throw unavailable(`SharePoint refused the upload (${err.status}). ${PERSON_ACTION}`);
      }
      throw unavailable(`SharePoint returned ${err.status}. Try again later. If it repeats, tell a person.`);
    }
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

  // Recheck by hash under the task row lock: of two identical calls at the same
  // time, the second finds the first's record and appends nothing.
  return withTransaction(async (q) => {
    const current = (await getEntity("task", taskId, q, true))?.data as unknown as Task | undefined;
    if (!current) throw new ApiError("not_found", `unknown task ${taskId}`, 404);
    // A move into a restricted project may have committed since the first check.
    if (current.bucket !== task.bucket && (await isBucketInRestrictedProject(current.bucket, q))) {
      throw unavailable(
        `${taskId} moved into a restricted project during the upload. Nothing was recorded.` +
          (uploaded ? ` A person must remove ${uploaded.url} from the shared "${PLX_EVIDENCE_STORE.library}" library.` : "")
      );
    }
    const evidence = current.evidence ?? { summary: "", items: [] };
    const artifacts = evidence.artifacts ?? [];
    const stored = artifacts.find((artifact) => artifact.sha256 === sha256);
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
