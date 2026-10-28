// POST /api/drafts/{id}/review — a signed-in person reviews a draft (Draft
// Projects step 3): comment, finding (blocking or not), approve or request
// changes on the version the reviewer read, which must be the current one; resolve a finding they raised (the author may
// resolve any); dismiss a finding (the author only, with a reason of 10
// characters or more). The reviewer is the session, never a body field.

import { z } from "zod";

import { parseBody, route } from "@/lib/api/route";
import { draftTextSchema } from "@/lib/drafts/schema";
import { closeFinding, draftSummary, reviewDraft } from "@/lib/drafts/service";
import { draftActorFromSession } from "@/lib/drafts/session";

export const dynamic = "force-dynamic";

const body = draftTextSchema(1, 8_000);
const target = draftTextSchema(0, 120).optional();

const version = z.number().int().positive();

const reviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["comment", "approve", "request_changes"]), version, body, target }),
  z.object({ kind: z.literal("finding"), version, body, blocking: z.boolean().default(false), target }),
  z.object({
    kind: z.enum(["resolve", "dismiss"]),
    findingId: z.string().trim().regex(/^drv_[0-9a-f]{16}$/),
    body: draftTextSchema(0, 2_000).optional(),
  }),
]);

export const POST = route(async (req, ctx) => {
  const { id } = await ctx.params;
  const actor = await draftActorFromSession("draft.review");
  const input = await parseBody(req, reviewSchema);
  if (input.kind === "resolve" || input.kind === "dismiss") {
    const closed = await closeFinding(actor, id, input.findingId, input.kind, input.body || null);
    return { review: closed.review, draft: draftSummary(closed.draft) };
  }
  const review = input as Exclude<typeof input, { kind: "resolve" | "dismiss" }>;
  const result = await reviewDraft(actor, id, {
    kind: review.kind,
    version: review.version,
    body: review.body,
    blocking: review.kind === "finding" ? review.blocking : undefined,
    target: review.target || null,
  });
  return { review: result.review, draft: draftSummary(result.draft) };
});
