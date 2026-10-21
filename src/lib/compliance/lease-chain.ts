// TASK-3410: the checkout lease chain. Pure rules over a checkout row and its
// recorded heads (repo.dispatchHeads). service.ts loads the rows, records heads
// and decides the verdict.
//
// A checkout's chain is its base SHA plus every head recorded for it, oldest
// first. A head joins the chain when the owning launcher records it, when the
// pull_request webhook sees a fast-forward from a chain head (a first-parent
// staging merge included), or when the gate finds a chain head among the PR's
// commits. A rewritten history (rebase, force-push) leaves the chain.
//
// The chain and launch-record rules hold only checkouts the launcher took (a
// launch record) and Agent trailers naming a launcher lane. Claude web, Cursor
// cloud, Codex and people never have a launch record, so they are unaffected.
// Reasons block only while PLX_MC_LEASE_CHAIN_ENFORCE=1; until then they warn.

import type { DispatchHead, DispatchRow } from "./repo";

export const FULL_SHA_RE = /^[0-9a-f]{40}$/;
export const LAUNCH_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Block on chain and launch-record reasons. Off by default: warn first. */
export function leaseChainEnforced(): boolean {
  return (process.env.PLX_MC_LEASE_CHAIN_ENFORCE ?? "").trim() === "1";
}

function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/** Principals allowed to attach a launch record to a checkout (PLX_MC_LAUNCHER_PRINCIPALS). Empty = none. */
export function isLauncherPrincipal(principalId: string | null | undefined): boolean {
  const id = (principalId ?? "").trim().toLowerCase();
  return !!id && csv("PLX_MC_LAUNCHER_PRINCIPALS").includes(id);
}

/**
 * True when an Agent trailer names a launcher lane (PLX_MC_LAUNCH_LANES: exact
 * `<runtime>/<lane>` values, or prefixes ending in `*`). Empty = no lane, so the
 * no-launch-record rule stays off until Infra lists the coding-1 lanes.
 */
export function namesLaunchLane(agent: string | null | undefined): boolean {
  const value = (agent ?? "").trim().toLowerCase();
  if (!value) return false;
  return csv("PLX_MC_LAUNCH_LANES").some((entry) =>
    entry.endsWith("*") ? value.startsWith(entry.slice(0, -1)) : value === entry
  );
}

/** The PR a chain is bound to: the first recorded head that names one. */
export function boundPr(heads: readonly DispatchHead[]): number | null {
  return heads.find((h) => h.pr !== null)?.pr ?? null;
}

function onChain(d: Pick<DispatchRow, "baseSha">, heads: readonly DispatchHead[], sha: string | null | undefined): boolean {
  if (!sha) return false;
  return sha === d.baseSha || heads.some((h) => h.headSha === sha);
}

/**
 * Whether a pull_request webhook delivery extends the chain. An empty chain
 * attaches the PR head and binds the PR; after that only a fast-forward from a
 * chain head (the push's `before`) on the bound PR joins it.
 */
export function webhookExtendsChain(
  d: Pick<DispatchRow, "baseSha">,
  heads: readonly DispatchHead[],
  evt: { prNumber: number; headSha: string; beforeSha?: string | null }
): boolean {
  if (!FULL_SHA_RE.test(evt.headSha) || heads.some((h) => h.headSha === evt.headSha)) return false;
  const bound = boundPr(heads);
  if (bound !== null && bound !== evt.prNumber) return false;
  if (heads.length === 0) return true;
  return onChain(d, heads, evt.beforeSha);
}

export type ChainVerdict =
  | { ok: true; record: boolean }
  | { ok: false; reason: string };

/**
 * The gate's chain check for one launcher checkout at one PR head. `prCommitShas`
 * is every commit on the PR (ancestors of the head that are not on the base).
 * record = the head joins the chain (empty chain, or descends from a chain head).
 */
export function chainVerdict(
  d: Pick<DispatchRow, "id" | "baseSha">,
  heads: readonly DispatchHead[],
  input: { prNumber: number; headSha: string },
  prCommitShas: readonly string[]
): ChainVerdict {
  const ref = `dsp_…${d.id.slice(-4)}`;
  const bound = boundPr(heads);
  if (bound !== null && bound !== input.prNumber) {
    return { ok: false, reason: `checkout ${ref}'s SHA chain is bound to PR #${bound}, not #${input.prNumber}` };
  }
  if (heads.some((h) => h.headSha === input.headSha)) return { ok: true, record: false };
  if (heads.length === 0) return { ok: true, record: true };
  const shas = new Set(prCommitShas);
  if (heads.some((h) => shas.has(h.headSha))) return { ok: true, record: true };
  const last = heads[heads.length - 1].headSha.slice(0, 7);
  return {
    ok: false,
    reason: `head ${input.headSha.slice(0, 7)} is outside checkout ${ref}'s recorded SHA chain (last recorded ${last}) — history was rewritten; the owning launcher must record the new head (mc_record_checkout_head)`,
  };
}
