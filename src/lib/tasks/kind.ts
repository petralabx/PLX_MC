// Task kind taxonomy: every task carries exactly one `kind:*` label. The
// steward leases only `kind:code`, so a defaulted `kind:needs-review` task is
// never auto-leased. Labels stay DB-only jsonb; no schema change.
import { ApiError } from "@/lib/api/route";

import { KIND_LABELS, KIND_PREFIX, TASK_KIND_DEFAULT, kindsOf, type TaskKind } from "./kind-labels";

export * from "./kind-labels";

/** Throws invalid_request for two or more kinds or a kind outside the taxonomy. */
export function assertValidKinds(kinds: readonly string[]): void {
  const unknown = kinds.find((kind) => !KIND_LABELS.includes(kind));
  if (unknown) {
    throw new ApiError("invalid_request", `Unknown task kind "${unknown}". Use one of: ${KIND_LABELS.join(", ")}.`, 400);
  }
  if (kinds.length > 1) {
    throw new ApiError("invalid_request", `A task takes exactly one kind:* label; got ${kinds.join(", ")}.`, 400);
  }
}

/**
 * Trim and lowercase labels (dropping blanks and duplicates), validate the
 * kinds, and add `defaultKind` when none is present.
 */
export function normalizeKindLabels(
  labels: readonly string[],
  { defaultKind }: { defaultKind: string },
): string[] {
  const normalized = [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
  const kinds = kindsOf(normalized);
  assertValidKinds(kinds);
  return kinds.length === 0 ? [...normalized, defaultKind] : normalized;
}

/** Create-path helper: merge the optional `kind` param into labels (400 on disagreement), then default. */
export function createLabelsWithKind(labels: readonly string[] | undefined, kind?: TaskKind): string[] {
  const merged = [...(labels ?? [])];
  if (kind !== undefined) {
    const wanted = `${KIND_PREFIX}${kind}`;
    const existing = kindsOf(merged.map((label) => label.trim().toLowerCase()));
    if (existing.some((label) => label !== wanted)) {
      throw new ApiError("invalid_request", `kind "${kind}" disagrees with label ${existing.join(", ")}.`, 400);
    }
    merged.push(wanted);
  }
  return normalizeKindLabels(merged, { defaultKind: TASK_KIND_DEFAULT });
}
