// mc_ask_question (TASK-3567) — shared by POST /api/cursor/ask-question and
// the HTTP MCP transport. A bot asks one named person a question on a task,
// with options and a recommendation. It shows only on that person's Approvals
// screen; only that person can answer, and the answer lands on the task as a
// comment. Agents never answer (question.answer is human-only).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { askQuestion, questionLink } from "@/lib/compliance/questions";
import { assertTaskProjectAccess } from "@/lib/permissions/project-acl-guard";
import { aclPrincipalFromMcp, requireMcpActor } from "@/lib/routing/mutations/actors";
import type { McpIdentity } from "./auth";
import { mcpJsonResult, taskLink } from "./envelope";

export const askQuestionSchema = z.object({
  taskId: z.string().min(1),
  addressee: z.string().trim().min(1).max(254),
  question: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  recommended: z.number().int().nonnegative().optional(),
  recommendationReason: z.string().trim().min(1).max(1000).optional(),
});

export type AskQuestionActionInput = z.infer<typeof askQuestionSchema>;

export async function actionAskQuestion(identity: McpIdentity, input: AskQuestionActionInput) {
  requireMcpActor(identity, "question.ask", { type: "task", id: input.taskId }, { repositoryId: identity.repo });
  // Same restricted-project guard as every other MCP task write.
  await assertTaskProjectAccess(input.taskId, aclPrincipalFromMcp(identity));
  const { question, created } = await askQuestion({
    taskId: input.taskId,
    addressee: input.addressee,
    text: input.question,
    options: input.options,
    recommended: input.recommended,
    recommendationReason: input.recommendationReason,
    askedBy: identity.operatorEmail,
    askedByPrincipal: identity.servicePrincipalId,
    runtime: identity.runtime,
  });
  return {
    taskId: input.taskId,
    questionId: question.id,
    addressee: question.addressee,
    status: question.status,
    // false: the same open question was already on the task; nothing new was stored.
    created,
    // Send this to the person: it opens their Approvals screen on the question.
    questionLink: questionLink(question.id),
    link: taskLink(input.taskId),
  };
}

export function registerQuestionTools(server: McpServer, identity: McpIdentity): void {
  server.tool(
    "mc_ask_question",
    "Ask one named person a question on a task (question.ask). addressee is a directory id (e.g. ricardo) or an email, never an agent. Pass up to 8 options, the index of the option you recommend and why. The question shows only on that person's Approvals screen; only they can answer, and the answer is posted to the task as a comment (read it with mc_get_task). Asking the same open question again returns it instead of a duplicate. Send them questionLink. An open question does not freeze the task. Agents never answer questions.",
    askQuestionSchema.shape,
    async (args) => mcpJsonResult({ data: await actionAskQuestion(identity, askQuestionSchema.parse(args)) })
  );
}
