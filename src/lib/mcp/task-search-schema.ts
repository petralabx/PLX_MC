// Web module entry point for the shared wire schema. Its definition lives in
// the standalone tool package so Zod resolves in both tool-only and app installs.
export { taskSearchShape, taskSearchSchema, type SearchTasksInput } from "../../../tools/plx-mc-mcp/task-search-schema";
