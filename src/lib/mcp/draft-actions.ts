// Draft Projects tools (TASK-4059; PRD docs/product/PRD-draft-projects.md):
// mc_save_draft, mc_submit_draft, mc_get_draft, mc_list_drafts,
// mc_review_draft and mc_upload_draft_artifact (TASK-4130), shared by the HTTP
// MCP transport and the /api/cursor/drafts REST routes (the stdio client proxies
// to those). The rules live in src/lib/drafts/service.ts. Every tool is off when
// PLX_MC_DRAFTS_ENABLED=0; uploads also wait for PLX_MC_EVIDENCE_STORE_ENABLED=1.
//
// An agent writes and reviews drafts for its person, the operator email on the
// call. It never accepts one: there is no accept tool (step 3 is a signed-in
// session action), and the agent bundle holds no draft.accept.

import { createHash } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ApiError } from "@/lib/api/route";
import { MAX_ARTIFACT_BYTES, artifactProblem, sharePointSafeName } from "@/lib/compliance";
import { assertDraftsEnabled } from "@/lib/drafts/flag";
import { draftPeopleSchema, draftPlanSchema, draftResearchSchema, draftTextSchema, draftTitleSchema } from "@/lib/drafts/schema";
import {
  addDraftArtifact,
  assertArtifactRoom,
  closeFinding,
  createDraft,
  draftEditBase,
  draftForUpload,
  draftOwnSite,
  draftPreflight,
  draftSummary,
  getVisibleDraft,
  getVisibleDraftVersion,
  listVisibleDrafts,
  reviewDraft,
  saveDraft,
  submitDraft,
  withdrawDraft,
  type DraftActor,
  type DraftDeps,
  defaultDraftDeps,
} from "@/lib/drafts/service";
import { DRAFT_ID_RE, isStaleReview, openBlockingFindings, type Draft, type DraftArtifact } from "@/lib/drafts/types";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import { evidenceStoreEnabled } from "@/lib/secrets";
import { uploadSmallDriveFile } from "@/lib/sync/graph";

import type { McpIdentity } from "./auth";
import { mcpJsonResult } from "./envelope";
import { PERSON_ACTION, evidenceDriveId, onSharePoint, storedName, unavailable } from "./evidence-actions";
import { assertMcpToolAllowed } from "./tool-allowlist";

const draftId = z.string().trim().regex(DRAFT_ID_RE, "a draft id is DRF-<n>");

export const saveDraftSchema = z
  .object({
    draftId: draftId.optional().describe("Omit to create a draft; set it to edit or withdraw one"),
    title: draftTitleSchema.optional().describe("Required on create"),
    plan: draftPlanSchema.optional().describe("Replaces the whole plan: {project, buckets[], tasks[]} under draft keys P, B1, T1"),
    research: draftResearchSchema.optional().describe("Replaces the whole research section"),
    visibility: z.enum(["shared", "restricted"]).optional(),
    members: draftPeopleSchema(200).optional().describe("Restricted drafts: emails, Entra oids, directory ids or sp_* ids"),
    reviewers: draftPeopleSchema(20).optional().describe("People asked to review: directory ids or emails"),
    withdraw: z.object({ reason: draftTextSchema(10, 2000) }).strict().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (!body.draftId && body.title === undefined) ctx.addIssue({ code: "custom", path: ["title"], message: "A new draft needs a title." });
    if (!body.draftId && body.withdraw) ctx.addIssue({ code: "custom", path: ["withdraw"], message: "Withdraw needs a draftId." });
    const edits = ["title", "plan", "research", "visibility", "members", "reviewers"] as const;
    if (body.withdraw && edits.some((k) => body[k] !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["withdraw"], message: "A withdraw cannot be mixed with edits." });
    }
    if (body.draftId && !body.withdraw && edits.every((k) => body[k] === undefined)) {
      ctx.addIssue({ code: "custom", message: "Send at least one of title, plan, research, visibility, members or reviewers." });
    }
  });

export const submitDraftSchema = z.object({ draftId }).strict();

export const getDraftSchema = z
  .object({
    draftId,
    version: z.number().int().positive().optional().describe("Read one frozen version instead of the current draft"),
  })
  .strict();

export const listDraftsSchema = z
  .object({
    status: z.enum(["open", "all", "drafting", "in_review", "accepted", "withdrawn"]).optional().describe("Default open (drafting and in_review)"),
    q: z.string().trim().max(200).optional().describe("Matches the draft id or title"),
    mine: z.boolean().optional().describe("Drafts whose author is your operator email"),
    needsMyReview: z.boolean().optional().describe("In review, naming you as a reviewer, with no review from you on the current version"),
  })
  .strict();

export const reviewDraftSchema = z
  .object({
    draftId,
    kind: z.enum(["comment", "finding", "approve", "request_changes", "resolve"]),
    version: z.number().int().positive().optional().describe("The version you read (mc_get_draft returns it); required except for resolve"),
    body: draftTextSchema(1, 8_000).optional(),
    blocking: z.boolean().optional().describe("Findings only: a blocking finding refuses Accept until it is closed"),
    target: draftTextSchema(0, 120).optional().describe("A plan key (P, B1, T3) or a research section"),
    findingId: z.string().trim().regex(/^drv_[0-9a-f]{16}$/).optional().describe("resolve only: the finding you raised"),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.kind === "resolve") {
      if (!body.findingId) ctx.addIssue({ code: "custom", path: ["findingId"], message: "resolve needs findingId." });
    } else {
      if (!body.body) ctx.addIssue({ code: "custom", path: ["body"], message: `A ${body.kind} needs a body.` });
      if (body.version === undefined) ctx.addIssue({ code: "custom", path: ["version"], message: `A ${body.kind} needs the version you read.` });
    }
    if (body.blocking !== undefined && body.kind !== "finding") {
      ctx.addIssue({ code: "custom", path: ["blocking"], message: "blocking applies to findings only." });
    }
  });

/** The visual evidence kinds: a draft's uploads pass the checks mc_upload_evidence runs. */
const DRAFT_UPLOAD_KINDS = ["diagram", "screenshot", "web-page"] as const;

export const uploadDraftArtifactSchema = z
  .object({
    draftId,
    kind: z.enum(DRAFT_UPLOAD_KINDS),
    fileName: z.string().trim().min(1).max(120),
    contentType: z.string().trim().min(1),
    name: z.string().trim().min(1).max(255).optional().describe("The artifact's name on the draft; defaults to fileName"),
    contentBase64: z.string().min(1).max(Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4),
  })
  .strict();

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError("invalid_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  }
  return parsed.data;
}

/** The agent, acting for the person on its operator email. */
export function draftActorFromMcp(identity: McpIdentity): DraftActor {
  return {
    kind: "agent",
    email: identity.operatorEmail,
    principalId: identity.servicePrincipalId,
    acl: aclPrincipalFromMcp(identity),
    runtime: identity.runtime,
    repo: identity.repo,
  };
}

function guard(identity: McpIdentity, tool: string, capability: "draft.create" | "draft.review" | "task.read"): DraftActor {
  assertMcpToolAllowed(identity, tool);
  assertDraftsEnabled();
  requireMcpActor(identity, capability);
  return draftActorFromMcp(identity);
}

function fullDraft(draft: Draft) {
  return {
    ...draft,
    reviews: draft.reviews.map((r) => ({ ...r, stale: isStaleReview(r, draft) })),
    openBlockingFindings: openBlockingFindings(draft).map((r) => r.id),
  };
}

export async function actionSaveDraft(identity: McpIdentity, input: unknown, deps: DraftDeps = defaultDraftDeps) {
  const actor = guard(identity, "mc_save_draft", "draft.create");
  const body = parseInput(saveDraftSchema, input);
  const sections = {
    title: body.title,
    plan: body.plan,
    research: body.research,
    visibility: body.visibility,
    members: body.members,
    reviewers: body.reviewers,
  };
  let draft: Draft;
  let changed = true;
  if (!body.draftId) draft = await createDraft(actor, { ...sections, title: body.title! });
  else if (body.withdraw) draft = await withdrawDraft(actor, body.draftId, body.withdraw.reason);
  else ({ draft, changed } = await saveDraft(actor, body.draftId, sections));
  // Advisory: the checks a submit will run. A withdrawn draft has none to run.
  const preflight = draft.status === "withdrawn" ? [] : await draftPreflight(actor, draft, deps);
  return { draftId: draft.id, created: !body.draftId, changed, preflight, draft: draftSummary(draft) };
}

export async function actionSubmitDraft(identity: McpIdentity, input: unknown, deps: DraftDeps = defaultDraftDeps) {
  const actor = guard(identity, "mc_submit_draft", "draft.create");
  const body = parseInput(submitDraftSchema, input);
  const { draft, frozen, duplicates } = await submitDraft(actor, body.draftId, deps);
  return { draftId: draft.id, frozen, duplicatesRaised: duplicates, draft: draftSummary(draft) };
}

export async function actionGetDraft(identity: McpIdentity, input: unknown) {
  const actor = guard(identity, "mc_get_draft", "task.read");
  const body = parseInput(getDraftSchema, input);
  if (body.version !== undefined) {
    return { draftId: body.draftId, version: await getVisibleDraftVersion(actor, body.draftId, body.version) };
  }
  return { draftId: body.draftId, draft: fullDraft(await getVisibleDraft(actor, body.draftId)) };
}

export async function actionListDrafts(identity: McpIdentity, input: unknown = {}) {
  const actor = guard(identity, "mc_list_drafts", "task.read");
  const filter = parseInput(listDraftsSchema, input ?? {});
  const drafts = await listVisibleDrafts(actor, filter);
  return { drafts, count: drafts.length, filter: { ...filter, status: filter.status ?? "open" } };
}

export async function actionReviewDraft(identity: McpIdentity, input: unknown) {
  const actor = guard(identity, "mc_review_draft", "draft.review");
  const body = parseInput(reviewDraftSchema, input);
  const result =
    body.kind === "resolve"
      ? await closeFinding(actor, body.draftId, body.findingId!, "resolve", body.body ?? null)
      : await reviewDraft(actor, body.draftId, { kind: body.kind, version: body.version!, body: body.body!, blocking: body.blocking, target: body.target });
  return { draftId: body.draftId, review: result.review, draft: draftSummary(result.draft) };
}

/** A draft's files share one folder in the Mission Control library. */
export const draftArtifactFolder = (draftId: string) => `Drafts/${draftId}`;

/** Whether a draft's artifact links a file stored from these bytes and name: a retry adds nothing. */
function isStoredFile(artifact: DraftArtifact, draftId: string, sha256: string, fileName: string): boolean {
  if (!artifact.url) return false;
  try {
    const path = decodeURIComponent(new URL(artifact.url).pathname);
    return path.includes(`/${draftArtifactFolder(draftId)}/`) && path.endsWith(`-${sha256.slice(0, 8)}-${sharePointSafeName(fileName)}`);
  } catch {
    return false;
  }
}

/**
 * Stores a file for a draft and links it from the draft's research artifacts:
 * mc_upload_draft_artifact for an agent, and the New draft form's upload for its
 * signed-in author, who sends the edit base the form was read with.
 */
export async function uploadDraftArtifact(
  actor: DraftActor,
  body: z.infer<typeof uploadDraftArtifactSchema>,
  options: { base?: string } = {}
) {
  const bytes = new Uint8Array(Buffer.from(body.contentBase64, "base64"));
  const problem = artifactProblem(body.kind, body.contentType, bytes, bytes.length);
  if (problem) throw new ApiError("invalid_artifact", problem, 400);
  if (!evidenceStoreEnabled()) throw unavailable(`Uploads are off. ${PERSON_ACTION} Then set PLX_MC_EVIDENCE_STORE_ENABLED=1.`);

  const draft = await draftForUpload(actor, body.draftId, options);
  const ownSite = await draftOwnSite(draft);
  if (ownSite) {
    throw unavailable(`${ownSite} files go on its own SharePoint site, never the PLX site. A person must set that site up first. Until then, link the file from where it is.`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sameFile = (artifact: DraftArtifact) => isStoredFile(artifact, draft.id, sha256, body.fileName);
  const existing = draft.working.research.artifacts.find(sameFile);
  if (existing) return { draftId: draft.id, artifact: existing, duplicate: true, draft: draftSummary(draft), editBase: draftEditBase(draft) };
  assertArtifactRoom(draft);

  // MC never deletes a stored file: one whose draft closes before it is linked stays in the library.
  const path = `${draftArtifactFolder(draft.id)}/${storedName(new Date().toISOString(), sha256, body.fileName)}`;
  const item = await onSharePoint(async () => uploadSmallDriveFile(await evidenceDriveId(), path, bytes, body.contentType));
  const stored: DraftArtifact = { kind: body.kind, name: body.name ?? body.fileName, url: item.webUrl, inline: null };
  // A concurrent upload of the same file may have linked its copy first; this copy then stays unlinked.
  const { draft: saved, artifact, added } = await addDraftArtifact(actor, draft.id, stored, sameFile, options);
  return { draftId: saved.id, artifact, duplicate: !added, sha256, size: bytes.length, draft: draftSummary(saved), editBase: draftEditBase(saved) };
}

export async function actionUploadDraftArtifact(identity: McpIdentity, input: unknown) {
  const actor = guard(identity, "mc_upload_draft_artifact", "draft.create");
  return uploadDraftArtifact(actor, parseInput(uploadDraftArtifactSchema, input));
}

export function registerDraftTools(server: McpServer, identity: McpIdentity): void {
  server.registerTool("mc_save_draft", {
    description:
      "Create or edit a Draft Project: a reviewable plan (one project, its buckets and tasks under draft keys P, B1, T1) plus its research (summary, context, findings citing sources by ref, two or more approaches with exactly one chosen, recommendation, risks, open questions, sources, artifacts). Nothing in a draft is live. Omit draftId to create; the author is your operator email and must be a person in the PLX directory, not a service mailbox. With draftId, each section you send replaces that section; an edit during review returns the draft to drafting. withdraw {reason} closes the draft. Only the agent that wrote the draft, for the same person, may edit it. Returns preflight: the checks mc_submit_draft will run. Off when PLX_MC_DRAFTS_ENABLED=0.",
    inputSchema: saveDraftSchema,
  }, async (args) => mcpJsonResult({ data: await actionSaveDraft(identity, args) }));
  server.registerTool("mc_submit_draft", {
    description:
      "Freeze a draft's working copy as its next version (sha256 digest) and open it for review. Refuses with draft_not_ready and every problem when the research is incomplete or the plan fails preflight: repos not in the allow-list, a closed or archived parent project, unknown owners, missing names. Raises likely duplicate open tasks as non-blocking findings. Submitting an unchanged draft changes nothing.",
    inputSchema: submitDraftSchema,
  }, async (args) => mcpJsonResult({ data: await actionSubmitDraft(identity, args) }));
  server.registerTool("mc_get_draft", {
    description:
      "Read a draft you can see: its working copy, status, version, digest, reviews (each marked stale when given on an older version) and open blocking findings. Pass version to read that frozen version instead. A restricted draft you are not a member of reads as not found.",
    inputSchema: getDraftSchema,
  }, async (args) => mcpJsonResult({ data: await actionGetDraft(identity, args) }));
  server.registerTool("mc_list_drafts", {
    description:
      "List drafts you can see, newest change first, with counts of buckets, tasks and open findings. status: open (default: drafting and in_review) | all | drafting | in_review | accepted | withdrawn. mine: your operator email is the author. needsMyReview: in review, naming you as a reviewer, with no review from you on the current version.",
    inputSchema: listDraftsSchema,
  }, async (args) => mcpJsonResult({ data: await actionListDrafts(identity, args) }));
  server.registerTool("mc_review_draft", {
    description:
      "Review a submitted draft's current version: comment, finding (blocking: true refuses Accept until it is closed), approve (advisory for an agent) or request_changes; target names a plan key or research section. Send version: the version you read; a newer one refuses with draft_version_moved. resolve {findingId} closes a finding you raised. Only the author, signed in, dismisses a finding. Agents never accept drafts.",
    inputSchema: reviewDraftSchema,
  }, async (args) => mcpJsonResult({ data: await actionReviewDraft(identity, args) }));
  server.registerTool("mc_upload_draft_artifact", {
    description:
      "Upload a file to a draft you wrote, as one of its research artifacts: kind diagram (svg, png), screenshot (png, jpeg, webp) or web-page (html), 3 MiB or less, sent as contentBase64 with fileName and contentType. MC stores it in the Mission Control library on the PLX SharePoint site under Drafts/DRF-<n>/ and adds it to the draft's artifacts as a link named name (default fileName). The same file again adds nothing. A restricted draft refuses with draft_restricted, because the library is shared; a Trading Lab draft (its plan names petralabx/agentic-swarm) refuses with evidence_store_unavailable, because its files go on its own site. An upload during review returns the draft to drafting. evidence_store_unavailable says what a person must set up. Off when PLX_MC_DRAFTS_ENABLED=0.",
    inputSchema: uploadDraftArtifactSchema,
  }, async (args) => mcpJsonResult({ data: await actionUploadDraftArtifact(identity, args) }));
}
