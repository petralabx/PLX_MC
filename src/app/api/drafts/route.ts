// GET /api/drafts — the drafts the signed-in person can see, for the Drafts
// screen (Draft Projects step 3). status (open default, all, drafting,
// in_review, accepted, withdrawn), q, mine and needsMyReview filter, as
// mc_list_drafts does.
// POST /api/drafts — the signed-in person starts a draft from the New draft
// form (TASK-4109). They are its author; a title is required, and any other
// section may come with it. Off when PLX_MC_DRAFTS_ENABLED=0.

import { z } from "zod";

import { ApiError, parseBody, route } from "@/lib/api/route";
import { draftSectionsSchema, draftTitleSchema } from "@/lib/drafts/schema";
import { createDraft, draftSummary, listVisibleDrafts } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";

export const dynamic = "force-dynamic";

const filterSchema = z.object({
  status: z.enum(["open", "all", "drafting", "in_review", "accepted", "withdrawn"]).optional(),
  q: z.string().trim().max(200).optional(),
  mine: z.boolean().optional(),
  needsMyReview: z.boolean().optional(),
});

export const GET = route(async (req) => {
  const actor = await draftActorFromSession("task.read");
  const sp = new URL(req.url).searchParams;
  const flag = (name: string) => (sp.get(name) === null ? undefined : sp.get(name) === "true");
  const parsed = filterSchema.safeParse({
    status: sp.get("status") ?? undefined,
    q: sp.get("q") ?? undefined,
    mine: flag("mine"),
    needsMyReview: flag("needsMyReview"),
  });
  if (!parsed.success) throw new ApiError("invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
  const drafts = await listVisibleDrafts(actor, parsed.data);
  return { drafts, count: drafts.length, viewer: actor.email };
});

const createSchema = draftSectionsSchema.extend({ title: draftTitleSchema });

export const POST = route(async (req) => {
  const actor = await draftActorFromSession("draft.create");
  const draft = await createDraft(actor, await parseBody(req, createSchema));
  return { draft: draftSummary(draft) };
});
