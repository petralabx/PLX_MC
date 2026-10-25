// Human-verification evidence standard (TASK-3165, bucket
// BKT-HUMAN-VERIFICATION-EVIDE). Agent text that a person must verify is held to
// STE-lite (./ste-lite.ts). Pure: the MCP layer turns blocking findings into a
// 400; the PR verifier turns them into a reason or an advisory note.
import type { Task } from "@/lib/mc-data";
import type { RiskTier } from "./types";
import { NUMBERED_STEP, steLiteFindings, type WritingFinding } from "./ste-lite";

export const HUMAN_VERIFICATION_LABEL = "verify:human";

/** Midnight 2026-10-24 America/Toronto: warnings until then, blocking after (one warn-only week). */
export const EVIDENCE_STANDARD_ENFORCE_FROM = "2026-10-24T04:00:00.000Z";

export type EvidenceStandardMode = "warn" | "block";

export function evidenceStandardMode(now: number = Date.now()): EvidenceStandardMode {
  return now >= Date.parse(EVIDENCE_STANDARD_ENFORCE_FROM) ? "block" : "warn";
}

/**
 * Midnight 2026-11-01 America/Toronto: visual evidence (TASK-3166) gets its own warn-only week.
 * Vince moved it from 2026-10-25 on 2026-10-25: uploads were still off, so no agent could upload during the first week.
 */
export const VISUAL_EVIDENCE_ENFORCE_FROM = "2026-11-01T04:00:00.000Z";

/**
 * Whether a missing visual artifact blocks: only after the warn-only week and
 * only while uploads are on. Agents cannot meet a rule whose store is off.
 */
export function visualEvidenceMode(now: number = Date.now(), storeEnabled = false): EvidenceStandardMode {
  return storeEnabled && now >= Date.parse(VISUAL_EVIDENCE_ENFORCE_FROM) ? "block" : "warn";
}

/** Midnight 2026-11-01 America/Toronto: the explainer video (TASK-3167) gets its own warn-only week. */
export const VIDEO_EVIDENCE_ENFORCE_FROM = "2026-11-01T04:00:00.000Z";

/** Like visualEvidenceMode: a missing video blocks only after its week and while uploads are on. */
export function videoEvidenceMode(now: number = Date.now(), storeEnabled = false): EvidenceStandardMode {
  return storeEnabled && now >= Date.parse(VIDEO_EVIDENCE_ENFORCE_FROM) ? "block" : "warn";
}

/** More steps than this in a person's procedure make the work complex. */
export const COMPLEX_PROCEDURE_STEPS = 5;
/** This many systems (task repos) or more make the work complex. */
export const COMPLEX_SYSTEM_COUNT = 2;

/** The numbered steps in a text: a person's procedure. */
export function procedureSteps(text: string | null | undefined): number {
  return (text ?? "").split("\n").filter((line) => NUMBERED_STEP.test(line)).length;
}

/**
 * Why the work is complex enough to need an explainer video (TASK-3167): a
 * high-risk change, a procedure of more than 5 steps in the description or
 * evidence summary, or 2 or more systems. Empty when it is not complex.
 */
export function complexityReasons(task: Pick<Task, "description" | "repos" | "evidence">, tier?: RiskTier): string[] {
  const reasons: string[] = [];
  if (tier === "high") reasons.push("high-risk change");
  const steps = Math.max(procedureSteps(task.description), procedureSteps(task.evidence?.summary));
  if (steps > COMPLEX_PROCEDURE_STEPS) reasons.push(`${steps}-step procedure`);
  const systems = new Set((task.repos ?? []).map((repo) => repo.trim().toLowerCase()).filter(Boolean)).size;
  if (systems >= COMPLEX_SYSTEM_COUNT) reasons.push(`${systems} systems`);
  return reasons;
}

/** A person must verify the work: labelled verify:human, a kind:human-test task, or a high-risk change. */
export function requiresHumanVerification(labels: readonly string[] | undefined, tier?: RiskTier): boolean {
  const set = new Set((labels ?? []).map((label) => label.trim().toLowerCase()));
  return set.has(HUMAN_VERIFICATION_LABEL) || set.has("kind:human-test") || tier === "high";
}

export interface EvidenceStandardReport {
  /** Whether the standard applies to this work (see requiresHumanVerification). */
  applies: boolean;
  mode: EvidenceStandardMode;
  enforceFrom: string;
  findings: WritingFinding[];
}

export function evidenceStandardReport(text: string, applies: boolean, now?: number): EvidenceStandardReport {
  return {
    applies,
    mode: evidenceStandardMode(now),
    enforceFrom: EVIDENCE_STANDARD_ENFORCE_FROM,
    findings: steLiteFindings(text),
  };
}

/** The findings that stop the work: errors, on work that needs human verification, once blocking has started. */
export function blockingFindings(report: EvidenceStandardReport): WritingFinding[] {
  return report.applies && report.mode === "block" ? report.findings.filter((f) => f.severity === "error") : [];
}

/** Up to `max` finding messages in one line, then a count of the rest. */
export function describeFindings(findings: readonly WritingFinding[], max = 3): string {
  const shown = findings.slice(0, max).map((f) => f.message);
  const rest = findings.length - shown.length;
  return [...shown, ...(rest > 0 ? [`${rest} more.`] : [])].join(" ");
}
