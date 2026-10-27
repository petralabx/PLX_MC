// Draft Projects (TASK-4059): input validation and the content digest.
// Server-only: the digest uses node:crypto.
//
// A save may be incomplete: the working copy is a draft. Submit runs the
// completeness and preflight checks (./preflight.ts) before it freezes a version.

import { createHash } from "node:crypto";
import { z } from "zod";

import { TASK_KINDS } from "@/lib/tasks/kind-labels";

import {
  DRAFT_ARTIFACT_KINDS,
  DRAFT_BUCKET_KEY_RE,
  DRAFT_TASK_KEY_RE,
  type DraftContent,
  type DraftPlan,
  type DraftResearch,
} from "./types";

// Postgres jsonb refuses a NUL character (22P05); refuse it here as a 400, not a 500.
const NO_NUL = /^[^\u0000]*$/;
const text = (max: number) => z.string().trim().max(max).regex(NO_NUL, "text may not contain a NUL character");
const line = (max = 255) => text(max);
const repos = z.array(z.string().trim().min(1).max(200)).max(20).default([]);
const level = z.enum(["low", "medium", "high"]);

/** Empty, http(s), or anything that does not start with a URI scheme. */
const SAFE_SOURCE_URL = /^(?:|https?:\/\/\S+|(?![a-z][a-z0-9+.-]*:)\S[^\u0000]*)$/i;

/** The largest working copy a draft may hold, as JSON (MCP bodies cap at 4 MiB). */
export const MAX_DRAFT_CONTENT_BYTES = 512 * 1024;

export const draftProjectSchema = z
  .object({
    key: z.literal("P").default("P"),
    existing: z.string().trim().regex(/^PRJ-[A-Z0-9-]+$/, "existing must be a PRJ-* id").nullable().default(null),
    name: line().default(""),
    owner: line(320).default(""),
    repos,
    desc: text(32_000).default(""),
  })
  .strict();

export const draftBucketSchema = z
  .object({
    key: z.string().regex(DRAFT_BUCKET_KEY_RE, "a bucket key is B1, B2, …"),
    name: line().default(""),
    owner: line(320).default(""),
    repos,
    desc: text(32_000).default(""),
  })
  .strict();

export const draftTaskSchema = z
  .object({
    key: z.string().regex(DRAFT_TASK_KEY_RE, "a task key is T1, T2, …"),
    bucket: z.string().regex(DRAFT_BUCKET_KEY_RE, "bucket must be a draft bucket key (B1)"),
    title: line().default(""),
    description: text(32_000).default(""),
    priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
    kind: z.enum(TASK_KINDS).default("code"),
    repos,
    accountableOwner: line(320).nullable().default(null),
    dependsOn: z
      .array(z.string().regex(/^(T\d{1,3}|TASK-\d+)$/, "dependsOn takes draft task keys (T2) or TASK-* ids"))
      .max(50)
      .default([]),
  })
  .strict();

export const draftPlanSchema = z
  .object({
    project: draftProjectSchema.default({ key: "P", existing: null, name: "", owner: "", repos: [], desc: "" }),
    buckets: z.array(draftBucketSchema).max(50).default([]),
    tasks: z.array(draftTaskSchema).max(300).default([]),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const unique = (keys: string[], path: "buckets" | "tasks") => {
      const seen = new Set<string>();
      keys.forEach((key, i) => {
        if (seen.has(key)) ctx.addIssue({ code: "custom", path: [path, i, "key"], message: `duplicate key ${key}` });
        seen.add(key);
      });
    };
    unique(plan.buckets.map((b) => b.key), "buckets");
    unique(plan.tasks.map((t) => t.key), "tasks");
  });

const sourceSchema = z
  .object({
    ref: z.string().trim().regex(/^\[\d{1,3}\]$/, 'a source ref is "[1]", "[2]", …'),
    title: line(500),
    // A web link, or a scheme-less internal ref (a repo path, an MC id). Never javascript:, data: or another scheme.
    url: text(2_000)
      .regex(SAFE_SOURCE_URL, "a source url is http(s), or a repo path or MC id with no scheme")
      .default(""),
    kind: z.enum(["internal", "external"]),
    excerpt: text(4_000).default(""),
    accessed: text(40).default(""),
  })
  .strict();

const artifactSchema = z
  .object({
    kind: z.enum(DRAFT_ARTIFACT_KINDS),
    name: line(255),
    url: z.string().trim().url().max(2_000).regex(/^https?:\/\//i, "an artifact link is http or https").nullable().default(null),
    inline: z.string().max(100_000).regex(NO_NUL, "text may not contain a NUL character").nullable().default(null),
  })
  .strict()
  .refine((a) => (a.url === null) !== (a.inline === null), { message: "an artifact is either a url or inline content" });

export const draftResearchSchema = z
  .object({
    summary: text(8_000).default(""),
    context: text(32_000).default(""),
    findings: z
      .array(z.object({ text: text(8_000).min(1), sources: z.array(z.string().trim()).max(20).default([]) }).strict())
      .max(200)
      .default([]),
    approaches: z
      .array(
        z
          .object({
            name: line(255).min(1),
            pros: z.array(text(2_000)).max(30).default([]),
            cons: z.array(text(2_000)).max(30).default([]),
            risk: level.default("medium"),
            effort: z.enum(["S", "M", "L"]).default("M"),
            chosen: z.boolean().default(false),
          })
          .strict()
      )
      .max(10)
      .default([]),
    recommendation: text(16_000).default(""),
    risks: z
      .array(
        z
          .object({ text: text(4_000).min(1), likelihood: level.default("medium"), impact: level.default("medium"), mitigation: text(4_000).default("") })
          .strict()
      )
      .max(100)
      .default([]),
    openQuestions: z.array(text(2_000).min(1)).max(100).default([]),
    sources: z.array(sourceSchema).max(200).default([]),
    artifacts: z.array(artifactSchema).max(50).default([]),
  })
  .strict();

export const draftTitleSchema = z.string().trim().min(1).max(255).regex(NO_NUL, "text may not contain a NUL character");

/** Free text from a caller (a review body, a reason): trimmed, bounded, no NUL. */
export function draftTextSchema(min: number, max: number) {
  return z.string().trim().min(min).max(max).regex(NO_NUL, "text may not contain a NUL character");
}

/** Parse a plan section; throws ZodError. */
export function parseDraftPlan(input: unknown): DraftPlan {
  return draftPlanSchema.parse(input) as DraftPlan;
}

/** Parse a research section; throws ZodError. */
export function parseDraftResearch(input: unknown): DraftResearch {
  return draftResearchSchema.parse(input) as DraftResearch;
}

/** JSON with object keys sorted at every level, so equal content has equal bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** A frozen version's identity: sha256 over its canonical content. */
export function draftDigest(content: DraftContent): string {
  return `sha256:${createHash("sha256").update(canonicalJson(content)).digest("hex")}`;
}

export function draftContentBytes(content: DraftContent): number {
  return Buffer.byteLength(canonicalJson(content), "utf8");
}
