// Visual evidence rules (TASK-3166). Pure: what an agent may upload for a person
// to open, and the SharePoint path it goes to. The upload itself is in
// src/lib/mcp/evidence-actions.ts; the store is decided there too.
import type { Evidence, EvidenceArtifact } from "@/lib/mc-data";

export const EVIDENCE_ARTIFACT_KINDS = ["diagram", "screenshot", "web-page", "video"] as const;
export type EvidenceArtifactKind = EvidenceArtifact["kind"];

/** The kinds that count as visual evidence (TASK-3166). A video is checked on its own (TASK-3167). */
export const VISUAL_ARTIFACT_KINDS: readonly EvidenceArtifactKind[] = ["diagram", "screenshot", "web-page"];

/** The content types each kind accepts. */
export const ARTIFACT_CONTENT_TYPES: Readonly<Record<EvidenceArtifactKind, readonly string[]>> = {
  diagram: ["image/svg+xml", "image/png"],
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  "web-page": ["text/html"],
  video: ["video/mp4", "video/webm"],
};

/** A video's file name must end in the extension of its type, so SharePoint plays it. */
export const VIDEO_EXTENSIONS: Readonly<Record<string, string>> = { "video/mp4": ".mp4", "video/webm": ".webm" };

/** The MCP transport refuses a request body over 4 MiB. */
export const MCP_TRANSPORT_LIMIT_BYTES = 4 * 1024 * 1024;
/** Room kept for the JSON-RPC envelope and the other arguments (64 KiB). */
export const MCP_ENVELOPE_RESERVE_BYTES = 64 * 1024;
/**
 * The largest raw file whose base64 body plus the envelope fits the 4 MiB MCP limit.
 * base64 turns every 3 bytes into 4 characters: 3,096,576 bytes (about 2.95 MiB).
 */
export const MAX_ARTIFACT_BYTES = Math.floor((MCP_TRANSPORT_LIMIT_BYTES - MCP_ENVELOPE_RESERVE_BYTES) / 4) * 3;

/**
 * 100 MiB: a 3–5 minute plx-knowledge-video MP4 (1600 px, CRF 20) fits. A larger
 * file than MAX_ARTIFACT_BYTES goes straight to SharePoint in an upload session.
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const maxArtifactBytes = (kind: EvidenceArtifactKind) => (kind === "video" ? MAX_VIDEO_BYTES : MAX_ARTIFACT_BYTES);

/** Where PLX evidence lives (decision, Vince, 2026-10-17). A person creates the library, never MC. */
export const PLX_EVIDENCE_STORE = { site: "/sites/PLXSite", library: "Mission Control" } as const;

/** Repos whose evidence goes on their own SharePoint site, never the PLX site. None is set up yet. */
const OWN_SITE_REPOS: Readonly<Record<string, string>> = { "petralabx/agentic-swarm": "Trading Lab" };

/** The name of the repo's own evidence site, or null when its evidence goes on the PLX site. */
export function ownEvidenceSite(repo: string): string | null {
  return OWN_SITE_REPOS[repo.trim().toLowerCase()] ?? null;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((b, i) => bytes[i] === b);
const head = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 2048)).toLowerCase();

/** The content type the bytes really have, or null when it is none of the accepted ones. */
export function sniffContentType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  // ISO base media "ftyp" box. QuickTime ("qt  ") shares it but is not accepted.
  if (startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
    return startsWith(bytes.subarray(8), [0x71, 0x74, 0x20, 0x20]) ? null : "video/mp4";
  }
  // EBML header with DocType "webm" (Matroska .mkv shares the header but is not accepted).
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return /webm/.test(head(bytes.subarray(0, 64))) ? "video/webm" : null;
  if (bytes.subarray(0, 2048).includes(0)) return null;
  const text = head(bytes);
  // HTML first: a web page often holds an inline <svg> diagram.
  if (/<!doctype html|<html[\s>]/.test(text)) return "text/html";
  if (/<svg[\s>]/.test(text)) return "image/svg+xml";
  return null;
}

/**
 * Why the file cannot be stored as this kind of evidence, or null when it can.
 * `bytes` may be only the start of the file when `size` gives the full length
 * (a video in an upload session). Without `bytes`, only the type and size are checked.
 */
export function artifactProblem(
  kind: EvidenceArtifactKind,
  contentType: string,
  bytes: Uint8Array | null,
  size = bytes?.length ?? 0
): string | null {
  const allowed = ARTIFACT_CONTENT_TYPES[kind];
  if (!allowed.includes(contentType)) return `A ${kind} must be ${allowed.join(" or ")}, not ${contentType}.`;
  if (size === 0) return "The file is empty.";
  if (size > maxArtifactBytes(kind)) {
    return kind === "video"
      ? `The file has ${size} bytes. Limit: ${MAX_VIDEO_BYTES}.`
      : `The file has ${size} bytes. Limit: ${MAX_ARTIFACT_BYTES}, so the base64 upload fits the 4 MiB MCP limit.`;
  }
  if (!bytes) return null;
  const actual = sniffContentType(bytes);
  if (actual !== contentType) return `The file content is ${actual ?? "not an accepted type"}, not ${contentType}.`;
  return null;
}

/** A name SharePoint accepts: no " * : < > ? / \\ | # % characters, no leading or trailing dots or spaces. */
export function sharePointSafeName(name: string): string {
  const safe = name.replace(/["*:<>?/\\|#%]/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
  return safe || "unnamed";
}

/** The folder for a task's evidence: <system>/<project>/<bucket>/<task id> (decision, Vince, 2026-10-17). */
export function artifactFolder(parts: { system: string; project: string | null; bucket: string; taskId: string }): string {
  return [parts.system, parts.project ?? "No project", parts.bucket, parts.taskId].map(sharePointSafeName).join("/");
}

/** Why a video's file name will not play on SharePoint, or null when it will. */
export function videoNameProblem(contentType: string, fileName: string): string | null {
  const extension = VIDEO_EXTENSIONS[contentType];
  return extension && !fileName.toLowerCase().endsWith(extension) ? `A ${contentType} video must be named *${extension}.` : null;
}

/** A person can open visual evidence for this work: a diagram, annotated screenshot or web page. */
export function hasVisualArtifact(evidence: Pick<Evidence, "artifacts"> | undefined): boolean {
  return (evidence?.artifacts ?? []).some((artifact) => VISUAL_ARTIFACT_KINDS.includes(artifact.kind));
}

/** A person can watch an explainer video for this work (TASK-3167). */
export function hasVideoArtifact(evidence: Pick<Evidence, "artifacts"> | undefined): boolean {
  return (evidence?.artifacts ?? []).some((artifact) => artifact.kind === "video");
}
