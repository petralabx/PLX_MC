// Deep-link alias (TASK-3163). MCP `taskLink()` and links already posted in
// PRs, comments and MC events point at /tasks/TASK-n, but the app is a single
// client shell on "/". Redirect to the query-string route the shell reads; an
// id that is not TASK-<digits> goes to home. Gated like "/" by the middleware.
import { redirect } from "next/navigation";

import { routeToUrl } from "@/components/mc/route";

const TASK_ID = /^TASK-[0-9]+$/;

export default async function TaskDeepLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(TASK_ID.test(id) ? routeToUrl({ screen: "task", taskId: id }) : "/");
}
