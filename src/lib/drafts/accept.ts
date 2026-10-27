// Draft Projects Accept (step 3, TASK-4071; PRD § Accept). The author, signed in, turns
// the draft's current version into live records through the create functions
// in src/lib/sync/state.ts, unchanged, so every guard on them still applies:
// the repo allow-list, archive and close checks, the audit log and the
// SharePoint mirror queue. Server-only.
//
// Accept is resumable and never creates a record twice:
// - Each task's id is written to drafts.materialized inside the transaction
//   that creates the task (createTask's inTransaction), so a task never exists
//   without its record.
// - A project carries the frozen version's link as its PRD link, and a bucket
//   that link plus `#<bucket key>`. A retry finds one Accept already made by
//   that link and adopts it.
// - Once Accept has created a record, the draft's content cannot change
//   (accept_unfinished), so a retry always finishes the version it started.
// - A claim (accepted_at set while the draft is still in_review) refuses a
//   second Accept, and every edit and review, while one runs. A failed Accept
//   clears its claim; a crashed one goes stale after ACCEPT_CLAIM_STALE_MS.

import { ApiError } from "@/lib/api/route";
import { appendEvent } from "@/lib/compliance/repo";
import { HUMANS } from "@/lib/mc-data/data";
import type { Bucket, Project, Task } from "@/lib/mc-data/types";
import { publicMcBaseUrl } from "@/lib/mcp/envelope";
import { canAccessProject } from "@/lib/permissions/project-acl";
import { databaseConfigured } from "@/lib/secrets";
import { createBucket, createProject, createTask } from "@/lib/sync";
import { getBuckets, getProjects } from "@/lib/sync/repo";

import { dependencyOrder, submitIssues } from "./preflight";
import { draftDigest } from "./schema";
import { defaultDraftDeps, getVisibleDraft, isDraftWriter, type DraftActor, type DraftDeps } from "./service";
import * as store from "./store";
import { acceptInProgress, openBlockingFindings, type Draft, type DraftContent } from "./types";

/** The frozen version's permanent link: the project's and buckets' PRD link. */
export function draftLink(id: string, version: number): string {
  return `${publicMcBaseUrl()}/?screen=drafts&draftId=${encodeURIComponent(id)}&version=${version}`;
}

/** A bucket's PRD link: the version's link plus its draft key, so two buckets never share one. */
export function draftBucketLink(id: string, version: number, key: string): string {
  return `${draftLink(id, version)}#${key}`;
}

export interface AcceptDeps extends DraftDeps {
  createProject: typeof createProject;
  createBucket: typeof createBucket;
  createTask: typeof createTask;
  liveProjects(): Promise<Project[]>;
  liveBuckets(): Promise<Bucket[]>;
}

export const defaultAcceptDeps: AcceptDeps = {
  ...defaultDraftDeps,
  createProject,
  createBucket,
  createTask,
  liveProjects: () => getProjects(),
  liveBuckets: () => getBuckets(),
};

/** A directory id for a known person; any other Petra email as given. */
function ownerId(raw: string): string {
  const needle = raw.trim().toLowerCase();
  const human = Object.values(HUMANS).find((h) => h.id.toLowerCase() === needle || (h.email ?? "").toLowerCase() === needle);
  return human?.id ?? needle;
}

async function record(id: string, key: string, recordId: string): Promise<void> {
  await store.mutateDraft(id, (draft) =>
    draft.materialized[key] === recordId ? null : { draft: { ...draft, materialized: { ...draft.materialized, [key]: recordId } } }
  );
}

async function releaseClaim(id: string, claimedAt: string): Promise<void> {
  await store.mutateDraft(id, (draft) =>
    draft.status === "in_review" && draft.acceptedAt === claimedAt ? { draft: { ...draft, acceptedAt: null, acceptedBy: null } } : null
  );
}

export interface AcceptResult {
  draft: Draft;
  /** Draft key to live record id (PRJ-*, BKT-*, TASK-*). */
  created: Record<string, string>;
  /** True when the draft was already accepted; nothing was created. */
  alreadyAccepted: boolean;
}

/**
 * Accept a draft's current version. `version` is the one the author saw: a
 * newer version (or unsubmitted edits) refuses, so a person never accepts what
 * they did not read.
 */
export async function acceptDraft(actor: DraftActor, id: string, version: number, deps: AcceptDeps = defaultAcceptDeps): Promise<AcceptResult> {
  if (actor.kind !== "human") throw new ApiError("forbidden", "Only the draft's author, signed in, accepts it.", 403);
  const current = await getVisibleDraft(actor, id);
  if (!isDraftWriter(current, actor)) {
    throw new ApiError("not_draft_author", `Only ${current.author} accepts ${id}.`, 403);
  }
  if (current.status === "accepted") return { draft: current, created: current.materialized, alreadyAccepted: true };
  if (current.status !== "in_review") throw new ApiError("draft_not_in_review", `${id} is ${current.status}; submit it before Accept.`, 409);
  if (current.version !== version) {
    throw new ApiError("draft_version_moved", `${id} is at version ${current.version}, not ${version}. Read it again before Accept.`, 409);
  }
  if (draftDigest(current.working) !== current.digest) {
    throw new ApiError("draft_has_edits", `${id} has edits that are not submitted. Submit them, or undo them, before Accept.`, 409);
  }
  const blocking = openBlockingFindings(current);
  if (blocking.length > 0) {
    throw new ApiError("blocking_findings", `${id} has ${blocking.length} open blocking finding(s): ${blocking.map((f) => f.id).join(", ")}.`, 409);
  }
  const frozen = await store.getDraftVersion(id, version);
  if (!frozen) throw new ApiError("not_found", `${id} has no version ${version}.`, 404);
  const content: DraftContent = frozen.content;
  const [registry, projects] = await Promise.all([deps.registry(), deps.projects()]);
  const issues = submitIssues(content, { registry, projects, humans: deps.humans(), principal: actor.acl });
  if (issues.length > 0) {
    throw new ApiError("draft_not_ready", `${id} cannot be accepted: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`, 422);
  }
  const ordered = dependencyOrder(content.plan.tasks);
  if (!ordered) throw new ApiError("dependency_cycle", `${id} has a cycle in its task dependencies.`, 422);

  // Claim the Accept.
  const claimedAt = new Date().toISOString();
  const claimed = await store.mutateDraft(id, (draft) => {
    if (draft.status !== "in_review" || draft.version !== version) {
      throw new ApiError("draft_version_moved", `${id} changed during the Accept; read it again.`, 409);
    }
    if (acceptInProgress(draft)) {
      throw new ApiError("accept_in_progress", `An Accept of ${id} started at ${draft.acceptedAt} is still running.`, 409);
    }
    // Again under the lock: a reviewer may have raised a blocking finding since the read.
    const blockingNow = openBlockingFindings(draft);
    if (blockingNow.length > 0) {
      throw new ApiError("blocking_findings", `${id} has ${blockingNow.length} open blocking finding(s): ${blockingNow.map((f) => f.id).join(", ")}.`, 409);
    }
    return { draft: { ...draft, acceptedAt: claimedAt, acceptedBy: actor.email } };
  });
  if (!claimed) throw new ApiError("not_found", `Unknown draft ${id}.`, 404);
  const done: Record<string, string> = { ...claimed.draft.materialized };
  const link = draftLink(id, version);
  const author = claimed.draft.author;

  try {
    // The project.
    const plan = content.plan;
    let createdProject = false;
    if (!done.P) {
      if (plan.project.existing) {
        done.P = plan.project.existing;
      } else {
        const adopted = (await deps.liveProjects()).find((p) => p.prd === link);
        createdProject = !adopted;
        done.P =
          adopted?.id ??
          (
            await deps.createProject(
              {
                name: plan.project.name.trim(),
                owner: ownerId(plan.project.owner),
                desc: plan.project.desc,
                repos: plan.project.repos,
                prd: link,
                visibility: claimed.draft.visibility,
                ...(claimed.draft.visibility === "restricted" ? { members: [...claimed.draft.members, author] } : {}),
              },
              actor.email
            )
          ).id;
      }
      await record(id, "P", done.P);
    }
    // A project this run did not create (recorded, adopted or existing) may have
    // dropped the author since; the create functions do not check the caller.
    if (!createdProject) {
      const project = (await deps.liveProjects()).find((p) => p.id === done.P);
      if (!project || !canAccessProject(project, actor.acl)) {
        throw new ApiError("unknown_project", `Project ${done.P} does not exist.`, 404);
      }
    }

    // The buckets, in plan order.
    for (const b of plan.buckets) {
      if (done[b.key]) continue;
      // createBucket stores the PRD link as new URL(link).href; match that form.
      const bucketLink = draftBucketLink(id, version, b.key);
      const adopted = (await deps.liveBuckets()).find((x) => x.prd === new URL(bucketLink).href && x.project === done.P);
      done[b.key] =
        adopted?.id ??
        (await deps.createBucket({ name: b.name.trim(), owner: ownerId(b.owner), desc: b.desc, repos: b.repos, prd: bucketLink, project: done.P }, actor.email))
          .id;
      await record(id, b.key, done[b.key]);
    }

    // The tasks, each after the draft tasks it depends on.
    for (const t of ordered) {
      if (done[t.key]) continue;
      const depends = t.dependsOn.map((dep) => (dep.startsWith("TASK-") ? dep : done[dep])).filter(Boolean);
      const task: Task = await deps.createTask(
        {
          title: t.title.trim(),
          description: [t.description.trim(), `From draft ${id} (version ${version}, ${t.key}): ${link}`].filter(Boolean).join("\n\n"),
          bucket: done[t.bucket],
          priority: t.priority,
          reporter: actor.email,
          accountableOwner: ownerId(t.accountableOwner ?? author),
          repos: t.repos,
          kind: t.kind,
          labels: [`draft:${id}`, ...depends.map((dep) => `depends-on:${dep}`)],
        },
        { source: "human", actorId: actor.principalId },
        {
          // The task and its record commit together, so a retry never makes it twice.
          inTransaction: async (q, created) => {
            if (!databaseConfigured()) return;
            await q(
              "UPDATE drafts SET materialized = materialized || jsonb_build_object($2::text, $3::text), updated_at = now() WHERE id = $1",
              [id, t.key, created.id]
            );
          },
        }
      );
      done[t.key] = task.id;
      await record(id, t.key, task.id);
    }
  } catch (err) {
    await releaseClaim(id, claimedAt).catch(() => undefined);
    throw err;
  }

  const accepted = await store.mutateDraft(id, (draft) => ({
    draft: { ...draft, status: "accepted", materialized: { ...draft.materialized, ...done }, acceptedAt: new Date().toISOString(), acceptedBy: actor.email },
  }));
  if (databaseConfigured()) {
    await appendEvent({
      kind: "draft.accepted",
      actor: actor.email,
      payload: { draftId: id, version, digest: current.digest, created: done, actorKind: "human", principalId: actor.principalId },
    });
  }
  return { draft: accepted!.draft, created: done, alreadyAccepted: false };
}
