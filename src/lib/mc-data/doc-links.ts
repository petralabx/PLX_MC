// Doc links for the project and bucket screens.
//
// Project.prd / Bucket.prd hold either a built-in PRD id (looked up in PRDS on
// the bucket screen) or a URL to a spec that lives elsewhere — e.g. a
// GitHub blob in a tracked repo. Only http(s) URLs become links; anything else
// (bare ids, javascript:, data:, junk) is not a link.

export interface DocLink {
  href: string;
  /** File name from the URL path, or the host when the path is empty. */
  label: string;
}

function lastPathSegment(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Store an http(s) PRD link, clear a blank value, or reject anything else. */
export function normalizeBucketPrd(
  prd: string | null | undefined
): { ok: true; value: string | null | undefined } | { ok: false } {
  if (prd === undefined) return { ok: true, value: undefined };
  if (prd === null) return { ok: true, value: null };
  const trimmed = prd.trim();
  if (!trimmed) return { ok: true, value: null };
  const link = docLinkFromPrd(trimmed);
  if (!link) return { ok: false };
  return { ok: true, value: link.href };
}

export function docLinkFromPrd(prd: string | null | undefined): DocLink | null {
  const raw = prd?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { href: url.toString(), label: lastPathSegment(url) ?? url.host };
}

/** Which icon a spec link earns: a TASK-* page, a GitHub issue, or a document. */
export function docLinkKind(link: DocLink): "task" | "issue" | "doc" {
  if (/^TASK-\d+/i.test(link.label)) return "task";
  if (/\/issues\/\d+/.test(new URL(link.href).pathname)) return "issue";
  return "doc";
}

// The five SharePoint registers every project and initiative links to — one
// list so the bucket aside and the project resource tiles never drift.
export type SharePointRegisterKey = "plan" | "roadmap" | "milestones" | "risks" | "documents";

export interface SharePointRegister {
  key: SharePointRegisterKey;
  label: string;
  source: "MS List" | "Library";
}

export const SHAREPOINT_REGISTERS: readonly SharePointRegister[] = [
  { key: "plan", label: "Project Plan", source: "MS List" },
  { key: "roadmap", label: "Roadmap", source: "MS List" },
  { key: "milestones", label: "Milestone Register", source: "MS List" },
  { key: "risks", label: "Risk Register", source: "MS List" },
  { key: "documents", label: "Project Documents", source: "Library" },
];
