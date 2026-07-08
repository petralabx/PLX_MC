// Resolve whether a task's bucket has an approved PRD (EN-007 P2). Reads the
// persisted buckets table — the gate uses present/absent, not "unknown", when the
// bucket row exists.

import type { Task } from "@/lib/mc-data";
import { getBuckets } from "@/lib/sync/repo";

export type BucketPrdStatus = "present" | "absent" | "unknown";

export async function bucketPrdForTask(task: Pick<Task, "bucket"> | null): Promise<BucketPrdStatus> {
  if (!task?.bucket) return "unknown";
  const buckets = await getBuckets();
  const bucket = buckets.find((b) => b.id === task.bucket);
  if (!bucket) return "unknown";
  return bucket.prd ? "present" : "absent";
}
