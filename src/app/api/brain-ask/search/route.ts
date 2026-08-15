import { ApiError, route } from "@/lib/api/route";
import { searchBrainAsk } from "@/lib/brain-ask";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    throw new ApiError("invalid_query", "q is required.", 400);
  }
  return searchBrainAsk(q);
});
