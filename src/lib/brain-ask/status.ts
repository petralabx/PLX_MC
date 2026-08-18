import type {
  BrainAskOpenResult,
  BrainAskSearchResult,
  BrainAskUpstreamStatus,
} from "./types";

export function classifyBrainAskStatus(
  configured: boolean,
  httpStatus: number,
): BrainAskUpstreamStatus {
  if (!configured) return "not_configured";
  if (httpStatus === 0) return "upstream_unreachable";
  if (httpStatus < 200 || httpStatus >= 300) return "upstream_error";
  return "ok";
}

export function searchStatusMessage(result: BrainAskSearchResult): string | null {
  switch (result.status) {
    case "not_configured":
      return "Brain credentials are not configured. Search stays empty until VMC_API_KEY is set on Mission Control.";
    case "upstream_unreachable":
      return "Company brain is unreachable. The search list is empty because VMC did not respond.";
    case "upstream_error":
      return "Company brain search failed. The search list is empty because VMC returned an error.";
    case "ok":
      return result.hits.length === 0 ? "No hits for this query." : null;
  }
}

export function openStatusMessage(result: BrainAskOpenResult): string | null {
  if (result.article) return null;
  switch (result.status) {
    case "not_configured":
      return "Brain credentials are not configured.";
    case "upstream_unreachable":
      return "Company brain is unreachable. The article did not load.";
    case "upstream_error":
      return "Company brain failed to load this article.";
    case "ok":
      return "Article not found or body was empty.";
  }
}
