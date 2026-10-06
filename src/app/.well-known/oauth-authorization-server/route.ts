import { ApiError, route } from "@/lib/api/route";

// This service is not an OAuth authorization server in the header-key phase.
// Return JSON without an Auth.js redirect or fabricated issuer metadata.
export const GET = route(async () => {
  throw new ApiError("oauth_not_supported", "OAuth authorization server is not configured.", 404);
});
