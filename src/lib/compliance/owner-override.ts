// TASK-4308 owner override. The owner (PLX_MC_OWNER_EMAIL, default
// vince@petrasoap.com) may decide any approval gate and answer any question,
// including a gate a bot raised in the owner's name (requestedBy = owner) and a
// question addressed to someone else. Of the gates raised in the owner's name,
// only those an agent raised on the owner's behalf qualify: the gate names the
// service principal that raised it (TASK-4168). Every use is recorded as an
// *.owner_override mc_event. Nobody else gains anything: separation of duties
// and addressee-only answers still hold for every other person, and routing
// (who a question or gate is sent to) is unchanged.

import { normalizeAddressee } from "@/lib/mc-data/policy";

export const DEFAULT_OWNER_EMAIL = "vince@petrasoap.com";

export type OwnerOverrideReason = "self_requested" | "not_addressee";

/** The configured owner email, lowercased. */
export function ownerEmail(): string {
  return (process.env.PLX_MC_OWNER_EMAIL ?? "").trim().toLowerCase() || DEFAULT_OWNER_EMAIL;
}

/** True when `actor` (an email or a directory id such as "vince") is the owner. */
export function isOwner(actor: string | null | undefined): boolean {
  if (!actor) return false;
  const value = actor.trim().toLowerCase();
  if (!value) return false;
  const owner = ownerEmail();
  if (value === owner) return true;
  const ownerId = normalizeAddressee(owner);
  return ownerId !== null && normalizeAddressee(value) === ownerId;
}
