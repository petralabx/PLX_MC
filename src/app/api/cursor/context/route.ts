import { cursorRoute } from "@/lib/mcp/route";
import { actionGetContext } from "@/lib/mcp/actions";

export const GET = cursorRoute("mc_get_context", async (req) => {
  const url = new URL(req.url);
  const depth = url.searchParams.get("depth") === "full" ? "full" : "compact";
  const project = url.searchParams.get("bucket") ?? undefined;
  const data = await actionGetContext(depth);
  if (project && depth === "compact" && "topTasks" in data && data.topTasks) {
    return {
      data: {
        ...data,
        topTasks: data.topTasks.filter((t) => t.bucket === project),
      },
    };
  }
  return { data };
});
