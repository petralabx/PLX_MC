// Client-safe pure half of the task kind taxonomy (no ApiError, no server
// imports). The validating half lives in ./kind.ts, which re-exports this.
import { TASK_KINDS } from "../../../tools/plx-mc-mcp/task-kind-schema";

export { TASK_KINDS };
export type TaskKind = (typeof TASK_KINDS)[number];

export const KIND_PREFIX = "kind:";
export const TASK_KIND_DEFAULT = "kind:needs-review";
export const KIND_LABELS: readonly string[] = TASK_KINDS.map((kind) => `${KIND_PREFIX}${kind}`);

export const isKindLabel = (label: string): boolean => label.startsWith(KIND_PREFIX);

/** The `kind:*` labels present, in order. */
export function kindsOf(labels: readonly string[]): string[] {
  return labels.filter(isKindLabel);
}

/** Replace any existing `kind:*` label with `kind` (one kind per task). */
export function withKind(labels: readonly string[], kind: string): string[] {
  return [...labels.filter((label) => !isKindLabel(label)), kind];
}
