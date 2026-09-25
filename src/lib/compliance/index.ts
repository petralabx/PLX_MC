// Barrel for the EN-007 compliance gate. Import through here, not internal files.
// Pure domain core (P1a): risk-tier classification + the PR compliance verifier,
// plus the fleet repo registry accessor (tracked-repos.ts).
// The persistence layer and /api/compliance routes land in P1b
// (docs/product/SYSTEM_OF_RECORD.md).
export * from "./types";
export * from "./risk";
export * from "./verify";
export * from "./tracked-repos";
// Type-only (erased at build) so client screens can type the Activity payload
// without pulling the server loaders into the bundle.
export type {
  ActivityFreshness,
  OpenPrItem,
  RepoActivityReport,
  RepoActivityRow,
} from "./activity";
export type { UnattributedPr } from "./backfill";
