import { cursorRoute } from "@/lib/mcp/route";
import { actionGetContext } from "@/lib/mcp/actions";

function parseTaskIds(sp: URLSearchParams): string[] | undefined {
  const repeated = sp.getAll("taskIds").flatMap((v) => v.split(","));
  const singular = sp.getAll("taskId");
  const ids = [...repeated, ...singular].map((id) => id.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

export const GET = cursorRoute("mc_get_context", async (req) => {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const depth = sp.get("depth") === "full" ? "full" : "compact";
  const bucket = sp.get("bucket") ?? undefined;
  const taskIds = parseTaskIds(sp);
  const result = await actionGetContext({ depth, bucket, taskIds });
  const { filter, ...data } = result;
  return { data, meta: { filter } };
});
