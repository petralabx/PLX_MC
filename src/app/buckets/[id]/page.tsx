// Deep-link alias for buckets (TASK-3442), the same shape as /tasks/[id]
// (TASK-3163): the app is a single client shell on "/", so /buckets/BKT-n
// redirects to the query-string route the shell reads. An id that is not
// BKT-<A-Z0-9-> goes to home. Gated like "/" by the middleware.
import { redirect } from "next/navigation";

import { routeToUrl } from "@/components/mc/route";

const BUCKET_ID = /^BKT-[A-Z0-9-]+$/;

export default async function BucketDeepLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(BUCKET_ID.test(id) ? routeToUrl({ screen: "bucket", bucketId: id }) : "/");
}
