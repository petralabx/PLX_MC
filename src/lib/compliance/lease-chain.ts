// TASK-3410: the checkout lease chain. Pure rules over a checkout row and its
// recorded heads (repo.dispatchHeads). service.ts loads the rows, records heads
// and decides the verdict.
//
// A checkout's chain is its base SHA plus every head recorded for it, oldest
// first. A head joins the chain when the owning launcher records it, when the
// pull_request webhook sees a fast-forward from a chain head (a first-parent
// staging merge included), or when the gate proves the head descends from a
// chain head (GitHub compare of the immutable head, never the PR's current
// commits). A rewritten history (rebase, force-push) leaves the chain. A head
// recorded before its PR existed binds to the first PR that presents it.
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

/** A webhook needs verified ancestry, never just GitHub's previous head. */
export function webhookExtendsChain(
  d: Pick<DispatchRow, "baseSha">,
  heads: readonly DispatchHead[],
  evt: { prNumber: number; headSha: string; forced?: boolean },
  verifiedAncestorSha?: string | null
): boolean {
  if (evt.forced || !FULL_SHA_RE.test(evt.headSha) || heads.some((h) => h.headSha === evt.headSha)) return false;
  const bound = boundPr(heads);
  if (bound !== null && bound !== evt.prNumber) return false;
  if (heads.length === 0 && !d.baseSha) return true;
  // Once heads exist, descending from the base alone does not prove continuity.
  return !!verifiedAncestorSha && (heads.length === 0
    ? verifiedAncestorSha === d.baseSha
    : heads.some((h) => h.headSha === verifiedAncestorSha));
}

export type ChainVerdict =
  | { ok: true; record: boolean; bind: boolean }
  | { ok: false; reason: string };

/**
 * The gate's chain check for one launcher checkout at one PR head.
 * `verifiedAncestorSha` = the chain head (or, for an empty chain, the base SHA)
 * that a GitHub compare proved `input.headSha` itself descends from. The PR's
 * current commits prove nothing about a delayed or replayed head.
 * record = the head joins the chain; bind = the recorded head has no PR yet.
 */
export function chainVerdict(
  d: Pick<DispatchRow, "id" | "baseSha">,
  heads: readonly DispatchHead[],
  input: { prNumber: number; headSha: string },
  verifiedAncestorSha: string | null = null
): ChainVerdict {
  const ref = `dsp_…${d.id.slice(-4)}`;
  const own = heads.find((h) => h.headSha === input.headSha);
  const bound = heads.find((h) => h.pr !== null && h.pr !== input.prNumber)?.pr ?? boundPr(heads);
  if (bound !== null && bound !== input.prNumber) {
    return { ok: false, reason: `checkout ${ref}'s SHA chain is bound to PR #${bound}, not #${input.prNumber}` };
  }
  if (own) return { ok: true, record: false, bind: own.pr === null };
  if (heads.length === 0) {
    if (!d.baseSha || (!!verifiedAncestorSha && verifiedAncestorSha === d.baseSha)) return { ok: true, record: true, bind: false };
    return {
      ok: false,
      reason: `head ${input.headSha.slice(0, 7)} has no verified ancestry from checkout ${ref}'s base ${d.baseSha.slice(0, 7)} — the owning launcher must record the first head (mc_record_checkout_head)`,
    };
  }
  if (verifiedAncestorSha && heads.some((h) => h.headSha === verifiedAncestorSha)) return { ok: true, record: true, bind: false };
  const last = heads[heads.length - 1].headSha.slice(0, 7);
  return {
    ok: false,
    reason: `head ${input.headSha.slice(0, 7)} is outside checkout ${ref}'s recorded SHA chain (last recorded ${last}) — history was rewritten; the owning launcher must record the new head (mc_record_checkout_head)`,
  };
}
