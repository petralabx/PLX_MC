// One week of the UAT fix loop as the portal measures it (plx-uat-scorecard/v1,
// GET <portal>/api/internal/uat-feedback/scorecard?week=YYYY-MM-DD), as the
// daily pull accepts it and the store reads it back (TASK-4196). Separate from
// ./index.ts so the screen's bundle carries no zod.

import { z } from "zod";

// A count is null when its section could not be read (readErrors names it) or,
// for a point-in-time count, in a closed week's final read.
const count = z.number().int().min(0).nullable();
// A median or an average; null = no data.
const stat = z.number().min(0).nullable();
const instant = z.iso.datetime({ offset: true });
const median = z.looseObject({ p50: stat, n: count });

// Loose objects keep every field the portal adds, so a later rubric can grade
// stored weeks again; the scorecard reads only the fields named here.
export const snapshotSchema = z
  .looseObject({
    schema: z.literal("plx-uat-scorecard/v1"),
    window: z.looseObject({ start: instant, end: instant, timeZone: z.string().min(1).max(64), complete: z.boolean() }),
    generatedAt: instant,
    outcomes: z.looseObject({
      verdicts: count,
      pass: count,
      fail: count,
      stale: count,
      legacyStallExpiries: count,
      passWithin5bdOfFiling: count,
      firstAttemptPass: count,
      // PASS verdicts on a ticket with no agent run (legacy): the first-attempt
      // share leaves them out. Absent until the portal sends it.
      passWithoutRun: count.optional(),
      reopened: count,
      // Distinct tickets that moved to RESOLVED or REJECTED in the window and
      // whose submitter can answer the closing poll (signed in, not rejected
      // at identity review): the poll's denominator. Absent until the portal
      // sends it.
      closedPollable: count.optional(),
    }),
    speed: z.looseObject({
      filedToPass: z.looseObject({ p50: stat, p90: stat, n: count }),
      holders: z.looseObject({ plx: median, agent: median, pipeline: median, submitter: median }),
    }),
    // open, overClock, waitingOnPlx and stuck are read at generatedAt, so a
    // closed week has them null; the whole section may be null there.
    flow: z
      .looseObject({
        filed: count,
        open: count,
        overClock: count,
        waitingOnPlx: count,
        stuck: count,
        duplicatesClosed: count,
      })
      .nullable(),
    users: z.looseObject({
      // lowWithFollowUp counts only the follow-ups made before window.end.
      closingPoll: z.looseObject({ responses: count, average: stat, low: count, lowWithFollowUp: count }),
      // The newest two scored pulse rounds opened before window.end, oldest
      // first. A round's question averages and responses cover all of its
      // answers created before window.end, not only the week's.
      pulse: z
        .array(
          z.looseObject({
            campaignId: z.string().max(200),
            title: z.string().max(500),
            responses: count,
            questions: z
              .array(z.looseObject({ id: z.string().max(200), label: z.string().max(500), average: stat }))
              .max(50),
          })
        )
        .max(50)
        .nullable(),
    }),
    reliability: z.looseObject({ outboxFailedTerminal: count, watchdogPages: count, deadOutboxOpen: count }),
    readErrors: z.array(z.string().max(2000)).max(20).default([]),
  })
  .refine((s) => Date.parse(s.window.start) < Date.parse(s.window.end), {
    message: "window.start must be before window.end",
    path: ["window"],
  });

export type Snapshot = z.infer<typeof snapshotSchema>;
