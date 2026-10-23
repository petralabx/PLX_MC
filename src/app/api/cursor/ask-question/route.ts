// POST /api/cursor/ask-question — mc_ask_question (TASK-3567).
// A bot asks one named person a question on a task; only that person sees it
// on their Approvals screen and answers it. Shared with the HTTP MCP tool via
// actionAskQuestion.

import { taskLink } from "@/lib/mcp/envelope";
import { actionAskQuestion, askQuestionSchema } from "@/lib/mcp/question-actions";
import { cursorRoute, parseCursorBody } from "@/lib/mcp/route";

export const POST = cursorRoute("mc_ask_question", async (req, _ctx, identity, meta) => {
  const body = await parseCursorBody(req, askQuestionSchema);
  const data = await actionAskQuestion(identity, body);
  return {
    data,
    meta: {
      links: {
        ...meta.links,
        task: taskLink(body.taskId),
      },
    },
  };
});
