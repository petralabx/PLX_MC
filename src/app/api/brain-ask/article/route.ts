import { ApiError, route } from "@/lib/api/route";
import { openBrainAskArticle } from "@/lib/brain-ask";

export const GET = route(async (req) => {
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) {
    throw new ApiError("invalid_id", "id is required.", 400);
  }
  return openBrainAskArticle(id);
});
