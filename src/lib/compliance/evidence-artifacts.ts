// Visual evidence rules (TASK-3166). Pure: what an agent may upload for a person
// to open, and the SharePoint path it goes to. The upload itself is in
// src/lib/mcp/evidence-actions.ts; the store is decided there too.
import type { Evidence, EvidenceArtifact } from "@/lib/mc-data";

export const EVIDENCE_ARTIFACT_KINDS = ["diagram", "screenshot", "web-page"] as const;
export type EvidenceArtifactKind = EvidenceArtifact["kind"];

/** The content types each kind accepts. */
export const ARTIFACT_CONTENT_TYPES: Readonly<Record<EvidenceArtifactKind, readonly string[]>> = {
  diagram: ["image/svg+xml", "image/png"],
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  "web-page": ["text/html"],
};

/** The MCP transport refuses a request body over 4 MiB. */
export const MCP_TRANSPORT_LIMIT_BYTES = 4 * 1024 * 1024;
/** Room kept for the JSON-RPC envelope and the other arguments (64 KiB). */
export const MCP_ENVELOPE_RESERVE_BYTES = 64 * 1024;
/**
 * The largest raw file whose base64 body plus the envelope fits the 4 MiB MCP limit.
 * base64 turns every 3 bytes into 4 characters: 3,096,576 bytes (about 2.95 MiB).
 */
export const MAX_ARTIFACT_BYTES = Math.floor((MCP_TRANSPORT_LIMIT_BYTES - MCP_ENVELOPE_RESERVE_BYTES) / 4) * 3;

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
  if (bytes.subarray(0, 2048).includes(0)) return null;
  const text = head(bytes);
  // HTML first: a web page often holds an inline <svg> diagram.
  if (/<!doctype html|<html[\s>]/.test(text)) return "text/html";
  if (/<svg[\s>]/.test(text)) return "image/svg+xml";
  return null;
}

/** Why the file cannot be stored as this kind of evidence, or null when it can. */
export function artifactProblem(kind: EvidenceArtifactKind, contentType: string, bytes: Uint8Array): string | null {
  const allowed = ARTIFACT_CONTENT_TYPES[kind];
  if (!allowed.includes(contentType)) return `A ${kind} must be ${allowed.join(" or ")}, not ${contentType}.`;
  if (bytes.length === 0) return "The file is empty.";
  if (bytes.length > MAX_ARTIFACT_BYTES) return `The file has ${bytes.length} bytes. Limit: ${MAX_ARTIFACT_BYTES}, so the base64 upload fits the 4 MiB MCP limit.`;
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

/** A person can open visual evidence for this work: a diagram, annotated screenshot or web page. */
export function hasVisualArtifact(evidence: Pick<Evidence, "artifacts"> | undefined): boolean {
  return (evidence?.artifacts ?? []).some((artifact) => EVIDENCE_ARTIFACT_KINDS.includes(artifact.kind));
}
