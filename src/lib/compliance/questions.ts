// Questions for a named person (TASK-3567). A bot asks one person a question
// on a task, with options and a recommendation. Only that person sees it on
// their Approvals screen, and only that person can answer it, whatever their
// role: the 21 Oct gates show that a role check alone let one person decide
// another's gates. The answer is stored on the question and copied to the
// task as a comment, under the task row lock. Unlike an approval gate, an open
// question never freezes the task's stage. Every step lands in mc_events.

import { randomBytes, randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/route";
import { withTransaction } from "@/lib/db";
import { HUMANS } from "@/lib/mc-data/data";
import {
  normalizeAddressee,
  openQuestionsFor,
  QUESTION_CONTEXT_MAX,
  QUESTION_REMIND_COOLDOWN_MS,
} from "@/lib/mc-data/policy";
import type { Comment, Task, TaskQuestion } from "@/lib/mc-data/types";
import { publicMcBaseUrl } from "@/lib/mcp/envelope";
import { canAccessProject, principalFromTokens, type ProjectAclPrincipal } from "@/lib/permissions/project-acl";
import { loadProjectAclMaps, scopeHierarchy } from "@/lib/permissions/project-acl-guard";
import { ensureSeeded, patchTask } from "@/lib/sync";
import { getBuckets, getEntities, getEntity, getProjects, stamp } from "@/lib/sync/repo";
import { loadMyProjects } from "./my-projects";
import { isOwner } from "./owner-override";
import { appendEvent, appendEventTx } from "./repo";

export { normalizeAddressee };

// Bot-written text is one line on the card and in the answer comment, so it
// can never add its own "A:" or "Note:" lines under the person's name.
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Deep link that opens the Approvals screen on one question. */
export function questionLink(questionId: string): string {
  return `${publicMcBaseUrl()}/?screen=approvals&question=${encodeURIComponent(questionId)}`;
}

export interface AskQuestionInput {
  taskId: string;
  addressee: string;
  text: string;
  options: string[];
  recommended?: number;
  recommendationReason?: string;
  /** TASK-3720: background shown under the question; trimmed, at most QUESTION_CONTEXT_MAX. */
  context?: string;
  /** Audit label of the asking operator/agent session. */
  askedBy: string;
  /** Authenticated service principal (API-key identity). */
  askedByPrincipal: string;
  runtime?: string;
}

export async function askQuestion(
  input: AskQuestionInput
): Promise<{ question: TaskQuestion; created: boolean }> {
  const addressee = normalizeAddressee(input.addressee);
  if (!addressee) {
    throw new ApiError(
      "invalid_addressee",
      `Address the question to a person: a directory id (e.g. "ricardo") or an email. "${input.addressee}" is not one.`,
      400
    );
  }
  if (input.recommended !== undefined && !(input.recommended < input.options.length)) {
    throw new ApiError("invalid_request", "recommended must be the index of one of the options.", 400);
  }
  if (input.recommendationReason && input.recommended === undefined) {
    throw new ApiError("invalid_request", "recommendationReason needs a recommended option.", 400);
  }
  const text = oneLine(input.text);
  const options = input.options.map(oneLine);
  // Background may span lines: it is shown under the question, never copied into the answer comment.
  const context = input.context?.trim() || undefined;
  if (context && context.length > QUESTION_CONTEXT_MAX) {
    throw new ApiError("invalid_request", `context must be at most ${QUESTION_CONTEXT_MAX} characters.`, 400);
  }

  // Seed on the pool before the transaction holds a connection (as applyTaskCommentOp does).
  await ensureSeeded();
  return withTransaction(async (q) => {
    const row = await getEntity("task", input.taskId, q, true);
    if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
    const task = row.data as unknown as Task;
    // A question the person could never see or answer is refused, not stored.
    const bucket = (await getBuckets(q)).find((b) => b.id === task.bucket);
    const project = (await getProjects(q)).find((p) => p.id === bucket?.project);
    const addresseePrincipal = principalFromTokens(
      addressee,
      HUMANS[addressee]?.email,
      addressee.includes("@") ? addressee : undefined
    );
    if (!canAccessProject(project, addresseePrincipal)) {
      throw new ApiError(
        "addressee_no_access",
        `${addressee} is not a member of this task's restricted project, so they could never see the question.`,
        400
      );
    }
    // Asking again (a bot re-run) returns the open question instead of a duplicate.
    // A changed wording, option list or recommendation is a new question.
    const existing = (task.questions ?? []).find(
      (x) =>
        x.status === "open" &&
        normalizeAddressee(x.addressee) === addressee &&
        x.text === text &&
        JSON.stringify(x.options) === JSON.stringify(options) &&
        x.recommended === input.recommended
    );
    if (existing) return { question: existing, created: false };

    const question: TaskQuestion = {
      id: `q_${randomBytes(8).toString("hex")}`,
      addressee,
      text,
      options,
      ...(input.recommended !== undefined ? { recommended: input.recommended } : {}),
      ...(input.recommendationReason ? { recommendationReason: oneLine(input.recommendationReason) } : {}),
      ...(context ? { context } : {}),
      askedBy: input.askedBy,
      askedByPrincipal: input.askedByPrincipal,
      ...(input.runtime ? { askedRuntime: input.runtime } : {}),
      askedAt: new Date().toISOString(),
      status: "open",
    };
    await patchTask(
      input.taskId,
      {
        questions: [...(task.questions ?? []), question],
        activityLine: {
          who: input.runtime ?? input.askedBy,
          what: `asked ${addressee} a question — ${text}`,
          kind: "question",
        },
      },
      input.askedBy,
      { query: q, attribution: { source: "service", actorId: input.askedBy } }
    );
    await appendEventTx(q, {
      kind: "question.asked",
      actor: input.askedBy,
      taskId: input.taskId,
      payload: {
        questionId: question.id,
        addressee,
        principal: input.askedByPrincipal,
        runtime: input.runtime ?? null,
        options: question.options.length,
      },
    });
    return { question, created: true };
  });
}

export interface OpenQuestionRow {
  taskId: string;
  taskTitle: string;
  stage: string;
  question: TaskQuestion;
}

/** Open questions addressed to `viewerId` across `tasks`, oldest first. Pure. */
export function openQuestionRows(tasks: readonly Task[], viewerId: string): OpenQuestionRow[] {
  const out: OpenQuestionRow[] = [];
  for (const task of tasks) {
    for (const question of openQuestionsFor(task, viewerId)) {
      out.push({ taskId: task.id, taskTitle: task.title, stage: task.stage, question });
    }
  }
  return out.sort((a, b) => a.question.askedAt.localeCompare(b.question.askedAt));
}

/** The viewer's open questions on the tasks their project ACL lets them see. */
export async function listOpenQuestions(
  viewerId: string,
  principal: ProjectAclPrincipal
): Promise<OpenQuestionRow[]> {
  const [rows, { projects, buckets }] = await Promise.all([getEntities("task"), loadProjectAclMaps()]);
  const tasks = rows.map((row) => row.data as unknown as Task);
  const visible = scopeHierarchy({ tasks, buckets, projects, principal }).tasks;
  return openQuestionRows(visible, viewerId);
}

export interface AnswerQuestionInput {
  taskId: string;
  questionId: string;
  choice?: number;
  text?: string;
  /** sessionAuthorId of the signed-in person — never a body field. */
  answeredBy: string;
}

function answerCommentBody(question: TaskQuestion, choice: number | undefined, text: string | undefined): string {
  const lines = [`Answer to a question from ${question.askedRuntime ?? question.askedBy} (${question.id}):`, `Q: ${oneLine(question.text)}`];
  if (choice !== undefined) {
    const recommended = choice === question.recommended ? " (the recommended option)" : "";
    lines.push(`A: ${oneLine(question.options[choice])}${recommended}`);
    if (text) lines.push(`Note: ${text}`);
  } else {
    lines.push(`A: ${text}`);
  }
  return lines.join("\n");
}

export async function answerQuestion(
  input: AnswerQuestionInput
): Promise<{ question: TaskQuestion; comment: Comment }> {
  const text = input.text?.trim() || undefined;
  if (input.choice === undefined && !text) {
    throw new ApiError("invalid_request", "Pick an option or type an answer.", 400);
  }

  // Set inside the transaction when a non-addressee tries; read after its rollback.
  const denial: { addressee?: string } = {};
  await ensureSeeded();
  try {
    return await withTransaction(async (q) => {
      const row = await getEntity("task", input.taskId, q, true);
      if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
      const task = row.data as unknown as Task;
      const question = (task.questions ?? []).find((x) => x.id === input.questionId);
      if (!question) throw new ApiError("not_found", `unknown question ${input.questionId} on ${input.taskId}`, 404);
      // TASK-4308: the owner may answer a question addressed to anyone; logged below.
      const ownerOverride = normalizeAddressee(question.addressee) !== input.answeredBy && isOwner(input.answeredBy);
      if (normalizeAddressee(question.addressee) !== input.answeredBy && !ownerOverride) {
        denial.addressee = question.addressee;
        throw new ApiError("not_addressee", "Only the person the question is addressed to can answer it.", 403);
      }
      if (question.status !== "open") {
        throw new ApiError("question_already_answered", "This question already has an answer.", 409);
      }
      if (input.choice !== undefined && !(input.choice < question.options.length)) {
        throw new ApiError("invalid_request", "choice must be the index of one of the options.", 400);
      }

      const comment: Comment = {
        id: `CMT-${randomUUID()}`,
        author: input.answeredBy,
        body: answerCommentBody(question, input.choice, text),
        ts: stamp(),
        mentions: [],
      };
      const answered: TaskQuestion = {
        ...question,
        status: "answered",
        answer: {
          ...(input.choice !== undefined ? { choice: input.choice } : {}),
          ...(text ? { text } : {}),
          answeredBy: input.answeredBy,
          answeredAt: new Date().toISOString(),
          commentId: comment.id,
        },
      };
      await patchTask(
        input.taskId,
        {
          questions: (task.questions ?? []).map((x) => (x.id === question.id ? answered : x)),
          comments: [...(task.comments ?? []), comment],
        },
        input.answeredBy,
        { query: q, attribution: { source: "human", actorId: input.answeredBy } }
      );
      if (ownerOverride) {
        await appendEventTx(q, {
          kind: "question.owner_override",
          actor: input.answeredBy,
          taskId: input.taskId,
          payload: {
            questionId: question.id,
            reasonCode: "not_addressee",
            addressee: question.addressee,
            at: answered.answer!.answeredAt,
          },
        });
      }
      await appendEventTx(q, {
        kind: "question.answered",
        actor: input.answeredBy,
        taskId: input.taskId,
        payload: {
          questionId: question.id,
          choice: input.choice ?? null,
          typed: !!text,
          commentId: comment.id,
        },
      });
      return { question: answered, comment };
    });
  } catch (err) {
    if (denial.addressee) {
      // Outside the rolled-back transaction, so the refused attempt stays on the record.
      // A failed audit write must not turn the 403 into a 500.
      try {
        await appendEvent({
          kind: "question.denied",
          actor: input.answeredBy,
          taskId: input.taskId,
          payload: { questionId: input.questionId, addressee: denial.addressee },
        });
      } catch (auditErr) {
        console.warn("[questions] question.denied audit write failed: %s", (auditErr as Error).message);
      }
    }
    throw err;
  }
}

export interface RemindQuestionInput {
  taskId: string;
  questionId: string;
  /** sessionAuthorId of the signed-in person — never a body field. */
  remindedBy: string;
  /** ACL principal of the signed-in person: decides whether the task's project is theirs. */
  principal: ProjectAclPrincipal;
}

function reminderCommentBody(question: TaskQuestion, addressee: string): string {
  return [
    `@${addressee} a reminder: this question (${question.id}) is waiting for your answer.`,
    `Q: ${oneLine(question.text)}`,
    `Answer it on the Approvals screen: ${questionLink(question.id)}`,
  ].join("\n");
}

/**
 * A project member reminds the addressee of an open question (TASK-3720).
 * Every rule is checked here, in every enforcement mode: the task's project is
 * one of the person's projects, the question is open, the person is not the
 * addressee, and they have not reminded about it within the cooldown. Under
 * the task row lock the reminder is stored on the question and posted to the
 * task as the person's comment, which @mentions the addressee.
 */
export async function remindQuestion(
  input: RemindQuestionInput
): Promise<{ question: TaskQuestion; comment: Comment }> {
  // Reads every task (an open assigned task makes a project theirs), so on the pool before the lock.
  const mine = new Set((await loadMyProjects(input.principal)).map((project) => project.id));
  await ensureSeeded();
  return withTransaction(async (q) => {
    const row = await getEntity("task", input.taskId, q, true);
    if (!row) throw new ApiError("not_found", `unknown task ${input.taskId}`, 404);
    const task = row.data as unknown as Task;
    const projectId = (await getBuckets(q)).find((b) => b.id === task.bucket)?.project;
    if (!projectId || !mine.has(projectId)) {
      throw new ApiError("not_my_project", "Only people on this task's project can send a reminder.", 403);
    }
    const question = (task.questions ?? []).find((x) => x.id === input.questionId);
    if (!question) throw new ApiError("not_found", `unknown question ${input.questionId} on ${input.taskId}`, 404);
    if (question.status !== "open") {
      throw new ApiError("question_already_answered", "This question already has an answer.", 409);
    }
    const addressee = normalizeAddressee(question.addressee) ?? question.addressee;
    if (addressee === input.remindedBy) {
      throw new ApiError("self_reminder", "The question is addressed to you; answer it instead.", 400);
    }
    const now = Date.now();
    const reminders = question.reminders ?? [];
    if (reminders.some((r) => r.by === input.remindedBy && now - Date.parse(r.at) < QUESTION_REMIND_COOLDOWN_MS)) {
      throw new ApiError("already_reminded", "You already sent a reminder for this question in the last 12 hours.", 409);
    }

    const comment: Comment = {
      id: `CMT-${randomUUID()}`,
      author: input.remindedBy,
      body: reminderCommentBody(question, addressee),
      ts: stamp(),
      mentions: [addressee],
    };
    const reminded: TaskQuestion = {
      ...question,
      reminders: [...reminders, { by: input.remindedBy, at: new Date(now).toISOString(), commentId: comment.id }],
    };
    await patchTask(
      input.taskId,
      {
        questions: (task.questions ?? []).map((x) => (x.id === question.id ? reminded : x)),
        comments: [...(task.comments ?? []), comment],
      },
      input.remindedBy,
      { query: q, attribution: { source: "human", actorId: input.remindedBy } }
    );
    await appendEventTx(q, {
      kind: "question.reminded",
      actor: input.remindedBy,
      taskId: input.taskId,
      payload: { questionId: question.id, addressee, commentId: comment.id },
    });
    return { question: reminded, comment };
  });
}
