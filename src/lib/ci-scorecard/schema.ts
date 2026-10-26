// The snapshot weekly_metrics.py writes (its --json output), as POST
// /api/cursor/ci-scorecard accepts it and the store reads it back (TASK-3913).
// Separate from ./index.ts so the screen's bundle carries no zod.

import { z } from "zod";

const count = z.number().int().min(0);
const summary = z.object({ n: count, p50: z.number().min(0).nullable(), p90: z.number().min(0).nullable() });
const attempts = z.object({ n: count, failed: count });

// Loose objects keep every field the script adds, so a later rubric can grade
// stored weeks again; the scorecard reads only the fields named here.
const repoSnapshotSchema = z.looseObject({
  merged: count,
  open_to_merge_hours: summary,
  dependabot_open_to_merge_hours: summary.optional(),
  landing_wait_minutes: summary,
  landing_wait_minutes_non_dependabot: summary.optional(),
  runs: z.looseObject({
    runs: count,
    pr_ci_first_attempt: attempts,
    compliance_first_attempt: attempts,
    passed_on_rerun: count,
  }),
  // Point-in-time sections: null for a window that ended in the past.
  bypass_merges: count.nullable(),
  open: z
    .looseObject({
      non_draft: count,
      auto_merge_armed: count,
      green_unmerged: z.array(z.array(z.union([z.number(), z.string()]))),
    })
    .nullable(),
  merge_queue: z.looseObject({ enqueue_to_merge_minutes: summary }).optional(),
  commit_to_verdict_minutes: summary.optional(),
  lane_cap_failures: count.optional(),
});

export const snapshotSchema = z
  .object({
    window: z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }),
    repos: z.record(z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), repoSnapshotSchema),
    errors: z.array(z.string().max(2000)).max(20).default([]),
  })
  .refine((s) => Date.parse(s.window.start) < Date.parse(s.window.end), {
    message: "window.start must be before window.end",
    path: ["window"],
  })
  .refine((s) => Object.keys(s.repos).length > 0, { message: "at least one repo", path: ["repos"] });

export type Snapshot = z.infer<typeof snapshotSchema>;
export type RepoSnapshot = Snapshot["repos"][string];

