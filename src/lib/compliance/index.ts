// Barrel for the EN-007 compliance gate. Import through here, not internal files.
// Pure domain core (P1a): risk-tier classification + the PR compliance verifier.
// The persistence layer and /api/compliance routes land in P1b
// (docs/product/SYSTEM_OF_RECORD.md).
export * from "./types";
export * from "./risk";
export * from "./verify";
