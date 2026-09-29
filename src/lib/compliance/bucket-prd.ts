// Resolve whether a task's initiative has an http(s) PRD link (EN-007 P2).
// A missing initiative is no_bucket. A failed bucket read is store_unavailable.
// Any other non-empty string is absent: the gate does not treat it as a PRD.

import type { Task } from "@/lib/mc-data";
import { docLinkFromPrd } from "@/lib/mc-data/doc-links";
import { getBuckets } from "@/lib/sync/repo";

export type BucketPrdStatus = "present" | "absent" | "no_bucket" | "store_unavailable";

export async function bucketPrdForTask(task: Pick<Task, "bucket"> | null): Promise<BucketPrdStatus> {
  if (!task?.bucket) return "no_bucket";
  let buckets;
  try {
    buckets = await getBuckets();
  } catch {
    return "store_unavailable";
  }
  const bucket = buckets.find((b) => b.id === task.bucket);
  if (!bucket) return "no_bucket";
  return docLinkFromPrd(bucket.prd) ? "present" : "absent";
}
