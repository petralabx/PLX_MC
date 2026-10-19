// Human-verification evidence standard (TASK-3165, bucket
// BKT-HUMAN-VERIFICATION-EVIDE). Agent text that a person must verify is held to
// STE-lite (./ste-lite.ts). Pure: the MCP layer turns blocking findings into a
// 400; the PR verifier turns them into a reason or an advisory note.
import type { RiskTier } from "./types";
import { steLiteFindings, type WritingFinding } from "./ste-lite";

export const HUMAN_VERIFICATION_LABEL = "verify:human";

/** Midnight 2026-10-24 America/Toronto: warnings until then, blocking after (one warn-only week). */
export const EVIDENCE_STANDARD_ENFORCE_FROM = "2026-10-24T04:00:00.000Z";

export type EvidenceStandardMode = "warn" | "block";

export function evidenceStandardMode(now: number = Date.now()): EvidenceStandardMode {
  return now >= Date.parse(EVIDENCE_STANDARD_ENFORCE_FROM) ? "block" : "warn";
}

/** Midnight 2026-10-25 America/Toronto: visual evidence (TASK-3166) gets its own warn-only week. */
export const VISUAL_EVIDENCE_ENFORCE_FROM = "2026-10-25T04:00:00.000Z";

/**
 * Whether a missing visual artifact blocks: only after the warn-only week and
 * only while uploads are on. Agents cannot meet a rule whose store is off.
 */
export function visualEvidenceMode(now: number = Date.now(), storeEnabled = false): EvidenceStandardMode {
  return storeEnabled && now >= Date.parse(VISUAL_EVIDENCE_ENFORCE_FROM) ? "block" : "warn";
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
