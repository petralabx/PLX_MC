// Shared wire schema: REST, HTTP MCP and the operator-local stdio client.
import { z } from "zod";

export const taskSearchShape = {
  q: z.string().optional().describe("Search text (alias of query)"),
  query: z.string().optional().describe("Search text (alias of q)"),
  bucket: z.string().optional(),
  stage: z.string().optional(),
  assignee: z.string().optional(),
  completedAfter: z.string().optional().describe("ISO-8601; completedAt >= this (inclusive)"),
  completedBefore: z.string().optional().describe("ISO-8601; completedAt < this (exclusive)"),
  label: z.string().optional().describe("Exact label"),
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(4096).optional(),
  searchComments: z.boolean().optional(),
  in: z.array(z.enum(["title", "description", "comments", "notes"])).min(1).optional(),
  fields: z.enum(["full", "compact"]).optional(),
};
export const taskSearchSchema = z.object(taskSearchShape).strict();
export type SearchTasksInput = z.infer<typeof taskSearchSchema>;
