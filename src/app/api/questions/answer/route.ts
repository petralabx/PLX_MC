// POST /api/questions/answer — answer a question asked of the signed-in person
// (TASK-3567). Session human only (question.answer, which agents can never
// hold). The answerer is the session, never a body field, and must be the
// person the question is addressed to, whatever their role: an owner gets 403
// for someone else's question. The answer is stored on the question and posted
// to the task as a comment in one locked write.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { answerQuestion } from "@/lib/compliance/questions";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

const answerSchema = z
  .object({
    taskId: z.string().min(1),
    questionId: z.string().min(1),
    choice: z.number().int().nonnegative().optional(),
    text: z.string().trim().max(2000).optional(),
  })
  .refine((b) => b.choice !== undefined || !!b.text, { message: "Pick an option or type an answer." });

export const POST = route(async (req) => {
  const { taskId, questionId, choice, text } = await parseBody(req, answerSchema);
  const authorized = await requireSessionActor("question.answer", { type: "task", id: taskId });
  await assertTaskProjectAccess(taskId, aclPrincipalFromAuthorized(authorized));
  const { question, comment } = await answerQuestion({
    taskId,
    questionId,
    choice,
    text,
    answeredBy: sessionAuthorId(authorized.auditLabel),
  });
  return { question, comment, taskId };
});
