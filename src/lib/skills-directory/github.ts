// GitHub content fetch for skills catalog (canonical: petralabx/skills).

import { resolveGithubToken } from "@/lib/github-app";

import { parseManifestJson, resolveEffectiveGitRef } from "./manifest";
import type {
  CatalogPointer,
  ContentFetchResult,
  ManifestFetchReason,
  ManifestFetchResult,
  SkillsSourceReader,
} from "./types";

const GH_API = "https://api.github.com";

function ghHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
}

function parseRepo(slug: string): { owner: string; name: string } | null {
  const parts = slug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], name: parts[1] };
}

function refForPointer(pointer: CatalogPointer): string {
  return pointer.pinSha || pointer.pinTag || pointer.sourceBranch;
}

function httpReason(status: number, res: Response): ManifestFetchReason {
  if (status === 429) return "rate_limit";
  if (status === 401) return "permission_denied";
  if (status === 403) {
    return res.headers.get("x-ratelimit-remaining") === "0"
      ? "rate_limit"
      : "permission_denied";
  }
  if (status === 404) return "not_found";
  return "network_error";
}

async function fetchRaw(
  owner: string,
  name: string,
  ref: string,
  path: string,
  token: string
): Promise<ContentFetchResult> {
  let res: Response;
  try {
    res = await fetch(
      `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      {
        headers: {
          ...ghHeaders(token),
          accept: "application/vnd.github.raw+json",
        },
      }
    );
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      note: `network error fetching ${path}: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: httpReason(res.status, res),
      note: `${owner}/${name}/${path} fetch failed (HTTP ${res.status})`,
    };
  }
  const content = await res.text();
  if (!content.trim()) {
    return { ok: false, reason: "not_found", note: `empty content at ${path}` };
  }
  return { ok: true, content };
}

export class GithubSkillsSource implements SkillsSourceReader {
  async fetchManifest(pointer: CatalogPointer): Promise<ManifestFetchResult> {
    const parsed = parseRepo(pointer.sourceRepo);
    if (!parsed) {
      return {
        ok: false,
        reason: "not_found",
        note: `sourceRepo "${pointer.sourceRepo}" is not owner/name`,
      };
    }
    const token = await resolveGithubToken({ repoOwner: parsed.owner });
    if (!token) {
      return {
        ok: false,
        reason: "token_missing",
        note: "no GitHub auth configured — skills catalog cannot be fetched",
      };
    }
    const ref = refForPointer(pointer);
    const raw = await fetchRaw(
      parsed.owner,
      parsed.name,
      ref,
      pointer.manifestPath,
      token
    );
    if (!raw.ok) {
      return { ok: false, reason: raw.reason, note: raw.note };
    }
    const manifest = parseManifestJson(raw.content, { fallbackGitRef: ref });
    if (!manifest.ok) {
      return {
        ok: false,
        reason: "invalid_manifest",
        note: manifest.error,
      };
    }
    return {
      ok: true,
      manifest: {
        ...manifest.manifest,
        // Prefer publisher stamp, else the ref we actually fetched.
        gitRef: resolveEffectiveGitRef(manifest.manifest.gitRef, ref),
      },
      ref,
    };
  }

  async fetchSkillContent(
    pointer: CatalogPointer,
    contentPath: string
  ): Promise<ContentFetchResult> {
    const parsed = parseRepo(pointer.sourceRepo);
    if (!parsed) {
      return {
        ok: false,
        reason: "not_found",
        note: `sourceRepo "${pointer.sourceRepo}" is not owner/name`,
      };
    }
    const token = await resolveGithubToken({ repoOwner: parsed.owner });
    if (!token) {
      return {
        ok: false,
        reason: "token_missing",
        note: "no GitHub auth configured — skill content cannot be fetched",
      };
    }
    const ref = refForPointer(pointer);
    const normalized = contentPath.replace(/\/$/, "");
    const skillPath = `${normalized}/SKILL.md`;
    return fetchRaw(parsed.owner, parsed.name, ref, skillPath, token);
  }
}

export function createSkillsSource(): SkillsSourceReader {
  return new GithubSkillsSource();
}
