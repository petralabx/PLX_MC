// Deep-link alias for projects (TASK-3442), the same shape as /tasks/[id]
// (TASK-3163): the app is a single client shell on "/", so /projects/PRJ-n
// redirects to the query-string route the shell reads. An id that is not
// PRJ-<A-Z0-9-> goes to home. Gated like "/" by the middleware.
import { redirect } from "next/navigation";

import { routeToUrl } from "@/components/mc/route";

const PROJECT_ID = /^PRJ-[A-Z0-9-]+$/;

export default async function ProjectDeepLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(PROJECT_ID.test(id) ? routeToUrl({ screen: "project", projectId: id }) : "/");
}
