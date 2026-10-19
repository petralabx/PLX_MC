// Visual evidence rules (TASK-3166, TASK-3167). Pure: what an agent may upload
// for a person to open, and the SharePoint path it goes to. The upload itself is
// in src/lib/mcp/evidence-actions.ts; the store is decided there too.
import type { Evidence, EvidenceArtifact } from "@/lib/mc-data";

export const EVIDENCE_ARTIFACT_KINDS = ["diagram", "screenshot", "web-page", "video", "video-script"] as const;
export type EvidenceArtifactKind = EvidenceArtifact["kind"];

/** The kinds a person looks at. A video script is input for the recorder, not evidence to look at. */
export const VISUAL_ARTIFACT_KINDS: readonly EvidenceArtifactKind[] = ["diagram", "screenshot", "web-page", "video"];

/** The content types each kind accepts. */
export const ARTIFACT_CONTENT_TYPES: Readonly<Record<EvidenceArtifactKind, readonly string[]>> = {
  diagram: ["image/svg+xml", "image/png"],
  screenshot: ["image/png", "image/jpeg", "image/webp"],
  "web-page": ["text/html"],
  video: ["video/mp4"],
  "video-script": ["application/json"],
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

/** 200 MiB: a 3 to 5 minute explainer at 1600 px (TASK-3167). A video goes up in chunks, never inline. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** Where PLX evidence lives (decision, Vince, 2026-10-17). A person creates the library, never MC. */
export const PLX_EVIDENCE_STORE = { site: "/sites/PLXSite", library: "Mission Control" } as const;

/** Repos whose evidence goes on their own SharePoint site, never the PLX site. None is set up yet. */
const OWN_SITE_REPOS: Readonly<Record<string, string>> = { "petralabx/agentic-swarm": "Trading Lab" };

/** The name of the repo's own evidence site, or null when its evidence goes on the PLX site. */
export function ownEvidenceSite(repo: string): string | null {
  return OWN_SITE_REPOS[repo.trim().toLowerCase()] ?? null;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((b, i) => bytes[i] === b);

// MP4 major brands. HEIC, AVIF and QuickTime also start with an ftyp box; they are not MP4 videos.
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash"]);
const head = (bytes: Uint8Array) => new TextDecoder().decode(bytes.subarray(0, 2048)).toLowerCase();

/** The content type the bytes really have, or null when it is none of the accepted ones. */
export function sniffContentType(bytes: Uint8Array): string | null {
  // An MP4 starts with a box: 4 size bytes, "ftyp", then its major brand.
  if (startsWith(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])) {
    return MP4_BRANDS.has(String.fromCharCode(...bytes.subarray(8, 12))) ? "video/mp4" : null;
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  if (bytes.subarray(0, 2048).includes(0)) return null;
  const text = head(bytes);
  // JSON first: a video script's narration may name a tag such as <svg>.
  if (text.trimStart().startsWith("{")) return "application/json";
  // HTML before SVG: a web page often holds an inline <svg> diagram.
  if (/<!doctype html|<html[\s>]/.test(text)) return "text/html";
  if (/<svg[\s>]/.test(text)) return "image/svg+xml";
  return null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/;
// The recorder runs on an operator machine: a page is a path in the app, and an
// image is a file inside the demos folder, never anywhere else on that disk.
const APP_PATH = /^\/(?!\/)[^\s\\]*$/;
const DEMOS_IMAGE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:]+\.(?:png|jpe?g|webp)$/i;

/**
 * Why the bytes are not a plx-knowledge-video script, or null when they are
 * (TASK-3167). Each beat has a slug, narration, and a page `url` or an `image`.
 */
export function videoScriptProblem(bytes: Uint8Array): string | null {
  let script: unknown;
  try {
    script = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return "The video script is not valid JSON.";
  }
  const beats = (script as { beats?: unknown })?.beats;
  if (!Array.isArray(beats) || beats.length === 0) return "The video script needs a non-empty beats list.";
  if (beats.length > 40) return `The video script has ${beats.length} beats. Limit: 40.`;
  const slugs = new Set<string>();
  for (const [index, beat] of beats.entries()) {
    const { slug, narration, url, image } = (beat ?? {}) as Record<string, unknown>;
    const at = `Beat ${index + 1}`;
    if (typeof slug !== "string" || !SLUG.test(slug)) return `${at} needs a lowercase slug (a-z, 0-9, -).`;
    if (slugs.has(slug)) return `${at} repeats the slug ${slug}.`;
    slugs.add(slug);
    if (typeof narration !== "string" || !narration.trim()) return `${at} needs narration text.`;
    if ((typeof url === "string") === (typeof image === "string")) return `${at} needs a page url or an image, not both.`;
    if (typeof url === "string" && !APP_PATH.test(url)) return `${at} url must be a path in the app, such as /tasks/TASK-1.`;
    if (typeof image === "string" && !DEMOS_IMAGE.test(image)) {
      return `${at} image must be a PNG, JPEG or WebP path inside the demos folder, such as slides/flow.png.`;
    }
  }
  return null;
}

/** Why the file cannot be stored as this kind of evidence, or null when it can. */
export function artifactProblem(kind: EvidenceArtifactKind, contentType: string, bytes: Uint8Array): string | null {
  if (kind === "video") return "A video goes up in chunks: call mc_start_evidence_upload, then mc_finish_evidence_upload.";
  const allowed = ARTIFACT_CONTENT_TYPES[kind];
  if (!allowed.includes(contentType)) return `A ${kind} must be ${allowed.join(" or ")}, not ${contentType}.`;
  if (bytes.length === 0) return "The file is empty.";
  if (bytes.length > MAX_ARTIFACT_BYTES) return `The file has ${bytes.length} bytes. Limit: ${MAX_ARTIFACT_BYTES}, so the base64 upload fits the 4 MiB MCP limit.`;
  const actual = sniffContentType(bytes);
  if (actual !== contentType) return `The file content is ${actual ?? "not an accepted type"}, not ${contentType}.`;
  return kind === "video-script" ? videoScriptProblem(bytes) : null;
}

/** Why a video cannot start uploading, or null when it can (TASK-3167). The bytes are checked at finish. */
export function videoUploadProblem(contentType: string, size: number): string | null {
  if (contentType !== "video/mp4") return `A video must be video/mp4, not ${contentType}.`;
  if (!Number.isInteger(size) || size <= 0) return "The video is empty.";
  if (size > MAX_VIDEO_BYTES) return `The video has ${size} bytes. Limit: ${MAX_VIDEO_BYTES}.`;
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

/** A person can open visual evidence for this work: a diagram, annotated screenshot, web page or video. */
export function hasVisualArtifact(evidence: Pick<Evidence, "artifacts"> | undefined): boolean {
  return (evidence?.artifacts ?? []).some((artifact) => VISUAL_ARTIFACT_KINDS.includes(artifact.kind));
}

/** The work has an uploaded artifact of this kind (TASK-3167: "video" or "video-script"). */
export function hasArtifactKind(evidence: Pick<Evidence, "artifacts"> | undefined, kind: EvidenceArtifactKind): boolean {
  return (evidence?.artifacts ?? []).some((artifact) => artifact.kind === kind);
}
