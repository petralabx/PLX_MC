// Review links (TASK-3168, evidence standard 4/4): a reviewer opens what a PR
// changed in one click. config/review-links-map.json maps file paths to modules
// and modules to their links (a live screen, a doc). A PR that touches a module
// needs a link to it in the body's `## Review links` section, the portal's rule
// (plx-customer-portal docs/runbooks/AGENT-PR-REVIEW-LINKS.md). Unmapped paths
// need nothing. Pure: the gate (service.ts) reads the body and applies the result.
import reviewLinksMap from "../../../config/review-links-map.json";
import type { EvidenceStandardMode } from "./evidence-standard";
import type { VerifyResult } from "./types";

/** Midnight 2026-11-01 America/Toronto: warnings until then, blocking after. */
export const REVIEW_LINKS_ENFORCE_FROM = "2026-11-01T04:00:00.000Z";

/** Reason code on the gate event: a touched module has no link. */
export const REVIEW_LINKS_MISSING = "review_links_missing";
/** Reason code on the gate event: the PR body could not be read (advisory, never blocks). */
export const REVIEW_LINKS_UNCHECKED = "review_links_unchecked";

export function reviewLinksMode(now: number = Date.now()): EvidenceStandardMode {
  return now >= Date.parse(REVIEW_LINKS_ENFORCE_FROM) ? "block" : "warn";
}

export interface ReviewModule {
  id: string;
  /** A path ending in "/" matches everything under it; any other path matches one file. */
  paths: string[];
  /** Screen path relative to the repo's liveUrl; matches on any host (per-PR previews count). */
  screen?: string;
  /** Repo path of the module doc; matches a GitHub blob link on any branch. */
  doc?: string;
}

interface RepoReviewMap {
  liveUrl: string;
  modules: ReviewModule[];
}

const REPOS = new Map(
  Object.entries((reviewLinksMap as { repos: Record<string, RepoReviewMap> }).repos).map(
    ([slug, entry]) => [slug.toLowerCase(), entry] as const
  )
);

/** The mapped modules a PR touches. Unknown repos and unmapped paths give none. */
export function touchedModules(repoFullName: string, changedPaths: readonly string[]): ReviewModule[] {
  const entry = REPOS.get(repoFullName.toLowerCase());
  if (!entry) return [];
  return entry.modules.filter((m) =>
    m.paths.some((prefix) =>
      changedPaths.some((path) => (prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix))
    )
  );
}

export interface ReviewLinksSection {
  /** The body has a `## Review links` heading. */
  found: boolean;
  /** Every http(s) URL in the section, `[label](url)` or bare. */
  urls: string[];
}

/** Parse the `## Review links` section, up to the next level-1 or level-2 heading. */
export function parseReviewLinks(body: string): ReviewLinksSection {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+review links\s*$/i.test(line.trim()));
  if (start < 0) return { found: false, urls: [] };
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  const section = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  const urls = Array.from(section.matchAll(/https?:\/\/[^\s<>()[\]]+/g), (m) => m[0].replace(/[.,;:!?'"`*_]+$/, ""));
  return { found: true, urls };
}

function samePathOrBelow(path: string, base: string): boolean {
  return path === base || (base !== "/" && path.startsWith(base.endsWith("/") ? base : `${base}/`));
}

function linksModule(link: string, repoFullName: string, liveUrl: string, m: ReviewModule): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false; // not a URL, so not a link to anything
  }
  if (m.screen) {
    const screen = new URL(m.screen, liveUrl);
    const params = Array.from(screen.searchParams);
    if (samePathOrBelow(url.pathname, screen.pathname) && params.every(([k, v]) => url.searchParams.get(k) === v)) {
      return true;
    }
  }
  if (m.doc && url.hostname === "github.com") {
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return false; // a malformed escape links to nothing; the other links still count
    }
    return path.toLowerCase().startsWith(`/${repoFullName.toLowerCase()}/blob/`) && path.endsWith(`/${m.doc}`);
  }
  return false;
}

export interface ReviewLinksReport {
  mode: EvidenceStandardMode;
  enforceFrom: string;
  /** Touched module ids, in map order. */
  modules: string[];
  /** Touched modules with no link, each with the links that would satisfy it. */
  missing: Array<{ id: string; links: string[] }>;
  /** Whether the body has the section; null when the body could not be read. */
  section: boolean | null;
}

/** Check a PR's Review links. `section` null means the body could not be read. */
export function reviewLinksReport(
  repoFullName: string,
  changedPaths: readonly string[],
  section: ReviewLinksSection | null,
  now?: number
): ReviewLinksReport {
  const liveUrl = REPOS.get(repoFullName.toLowerCase())?.liveUrl ?? "";
  const modules = touchedModules(repoFullName, changedPaths);
  const urls = section?.urls ?? [];
  return {
    mode: reviewLinksMode(now),
    enforceFrom: REVIEW_LINKS_ENFORCE_FROM,
    modules: modules.map((m) => m.id),
    missing: section
      ? modules
          .filter((m) => !urls.some((url) => linksModule(url, repoFullName, liveUrl, m)))
          .map((m) => ({
            id: m.id,
            links: [
              ...(m.screen ? [new URL(m.screen, liveUrl).toString()] : []),
              ...(m.doc ? [`https://github.com/${repoFullName}/blob/<branch>/${m.doc}`] : []),
            ],
          }))
      : [],
    section: section ? section.found : null,
  };
}

/**
 * Add the Review links outcome to a task's verdict: a reason after the block
 * date, a note before it. Each line starts with its reason code, so the gate
 * event records it. An unread body is a note only, never a block.
 */
export function applyReviewLinks(result: VerifyResult, report: ReviewLinksReport | null): VerifyResult {
  if (!report || report.modules.length === 0) return result;
  if (report.section === null) {
    const note = `${REVIEW_LINKS_UNCHECKED}: could not read the PR body, so review links were not checked (advisory).`;
    return { ...result, reasons: [...result.reasons, note] };
  }
  if (report.missing.length === 0) return result;
  const wanted = report.missing.map((m) => `${m.id} (${m.links.join(" or ")})`).join("; ");
  const line = report.section
    ? `${REVIEW_LINKS_MISSING}: the "## Review links" section has no link for ${wanted}.`
    : `${REVIEW_LINKS_MISSING}: add a "## Review links" section with a link for each module this PR touches: ${wanted}.`;
  return report.mode === "block"
    ? { verdict: "block", reasons: [line, ...result.reasons] }
    : { ...result, reasons: [...result.reasons, `${line} Warning only until ${report.enforceFrom.slice(0, 10)}.`] };
}
