// The SharePoint evidence store (TASK-3166): the drive id of the "Mission Control"
// library on the PLX site, and a health probe of it (TASK-4421).
//
// PLX_MC_EVIDENCE_STORE_ENABLED=1 says a person set the library up. It does not
// say the library still exists or that the Graph grant still works. The gate asks
// the probe before it blocks a PR on missing visual evidence: when uploads fail,
// an agent cannot satisfy the requirement, so it only warns.
//
// Server-only (Graph). Not in the compliance barrel, which client screens import.
import { GraphError, driveIdByName, siteIdByPath } from "@/lib/sync/graph";
import { PLX_EVIDENCE_STORE } from "./evidence-artifacts";

/** A healthy probe is trusted this long. */
export const EVIDENCE_PROBE_OK_TTL_MS = 5 * 60_000;
/** A failed probe is trusted only briefly, so a fixed library is seen soon. */
export const EVIDENCE_PROBE_FAIL_TTL_MS = 30_000;
/** The gate never waits longer than this for SharePoint. */
export const EVIDENCE_PROBE_TIMEOUT_MS = 5_000;

export type EvidenceStoreHealth = { ok: true } | { ok: false; problem: string };

// The library's drive id does not change while the library exists. A miss is never
// cached, and a failed probe or a 404 forgets it, so a recreated library is found again.
let cachedDriveId: string | null = null;
let cachedProbe: { at: number; health: EvidenceStoreHealth } | null = null;
let inFlight: Promise<EvidenceStoreHealth> | null = null;

async function lookUpDriveId(): Promise<string | null> {
  return driveIdByName(await siteIdByPath(PLX_EVIDENCE_STORE.site), PLX_EVIDENCE_STORE.library);
}

/** The library's drive id, or null when the library does not exist. Graph errors propagate. */
export async function evidenceStoreDriveId(): Promise<string | null> {
  if (cachedDriveId) return cachedDriveId;
  const driveId = await lookUpDriveId();
  if (driveId) cachedDriveId = driveId;
  return driveId;
}

/** Forget the drive id and the probe result: the next call looks the library up again. */
export function invalidateEvidenceStore(): void {
  cachedDriveId = null;
  cachedProbe = null;
}

class ProbeTimeout extends Error {}

function problemOf(err: unknown): string {
  if (err instanceof ProbeTimeout) return `SharePoint did not answer within ${EVIDENCE_PROBE_TIMEOUT_MS / 1000} s`;
  if (err instanceof GraphError) return `SharePoint returned ${err.status} for the site or library lookup`;
  return `could not reach SharePoint (${err instanceof Error ? err.name : "unknown error"})`;
}

async function runProbe(): Promise<EvidenceStoreHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout()), EVIDENCE_PROBE_TIMEOUT_MS);
  });
  try {
    // Always a real lookup: a cached drive id proves nothing about the library now.
    const driveId = await Promise.race([lookUpDriveId(), timeout]);
    if (!driveId) {
      cachedDriveId = null;
      return { ok: false, problem: `the "${PLX_EVIDENCE_STORE.library}" library does not exist on ${PLX_EVIDENCE_STORE.site}` };
    }
    cachedDriveId = driveId;
    return { ok: true };
  } catch (err) {
    cachedDriveId = null;
    return { ok: false, problem: problemOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Whether the evidence store answers: site and library resolve. Cached; never throws. */
export async function evidenceStoreHealth(): Promise<EvidenceStoreHealth> {
  if (cachedProbe) {
    const ttl = cachedProbe.health.ok ? EVIDENCE_PROBE_OK_TTL_MS : EVIDENCE_PROBE_FAIL_TTL_MS;
    if (Date.now() - cachedProbe.at < ttl) return cachedProbe.health;
  }
  inFlight ??= runProbe()
    .then((health) => {
      cachedProbe = { at: Date.now(), health };
      return health;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function __resetEvidenceStoreForTests(): void {
  cachedDriveId = null;
  cachedProbe = null;
  inFlight = null;
}
