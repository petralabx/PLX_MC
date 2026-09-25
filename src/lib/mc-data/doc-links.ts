// Doc links for the project and bucket screens.
//
// Project.prd / Bucket.prd hold either a built-in PRD id (looked up in PRDS on
// the bucket screen) or a URL to a spec that lives elsewhere — e.g. a
// GitHub blob in a tracked repo. Only http(s) URLs become links; anything else
// (bare ids, javascript:, data:, junk) is not a link.

import type { Bucket, Project } from "./types";

export interface DocLink {
  href: string;
  /** File name from the URL path, or the host when the path is empty. */
  label: string;
}

export interface ScopedDocLink extends DocLink {
  scope: "project" | "bucket";
  scopeId: string;
  scopeName: string;
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

/** Project link first, then each bucket's, in the order the buckets are given. */
export function projectDocLinks(
  project: Pick<Project, "id" | "name" | "prd">,
  buckets: ReadonlyArray<Pick<Bucket, "id" | "name" | "prd">>
): ScopedDocLink[] {
  const links: ScopedDocLink[] = [];
  const projectLink = docLinkFromPrd(project.prd);
  if (projectLink) {
    links.push({ ...projectLink, scope: "project", scopeId: project.id, scopeName: project.name });
  }
  for (const bucket of buckets) {
    const link = docLinkFromPrd(bucket.prd);
    if (link) {
      links.push({ ...link, scope: "bucket", scopeId: bucket.id, scopeName: bucket.name });
    }
  }
  return links;
}
