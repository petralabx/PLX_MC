// POST /api/questions/remind — remind the addressee of an open question
// (TASK-3720). Session person only, with task.progress (the task comments
// capability) and the task's project ACL. The service refuses, in every
// enforcement mode: a task outside the person's projects (403 not_my_project),
// an unknown question (404), an answered one (409 question_already_answered),
// the addressee themselves (400 self_reminder), and a second reminder from the
// same person inside the cooldown (409 already_reminded). The reminder is
// stored on the question and posted to the task as the person's comment,
// @mentioning the addressee.

import { z } from "zod";
import { parseBody, route } from "@/lib/api/route";
import { sessionAuthorId } from "@/lib/api/session-actor";
import { remindQuestion } from "@/lib/compliance/questions";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromAuthorized, requireSessionActor } from "@/lib/routing/mutations/actors";

const remindSchema = z.object({
  taskId: z.string().min(1),
  questionId: z.string().min(1),
});

export const POST = route(async (req) => {
  const { taskId, questionId } = await parseBody(req, remindSchema);
  const authorized = await requireSessionActor("task.progress", { type: "task", id: taskId });
  const principal = aclPrincipalFromAuthorized(authorized);
  await assertTaskProjectAccess(taskId, principal);
  const { question } = await remindQuestion({
    taskId,
    questionId,
    remindedBy: sessionAuthorId(authorized.auditLabel),
    principal,
  });
  return { question };
});
