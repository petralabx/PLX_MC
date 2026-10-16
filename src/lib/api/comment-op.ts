// The request body of one comment write — PATCH /api/buckets/{id}/comments and
// PATCH /api/tasks/{id}/comments (TASK-3011, TASK-3043). No author, id or stamp:
// the server sets those from the session.

import { z } from "zod";

const text = z.string().trim().min(1).max(5000);
const mentions = z.array(z.string()).max(50);

export const commentOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), body: text, mentions }),
  z.object({ op: z.literal("edit"), id: z.string().min(1), body: text, mentions }),
  z.object({ op: z.literal("delete"), id: z.string().min(1) }),
]);
