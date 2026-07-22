/**
 * Deterministic percentile helpers (nearest-rank, ascending sort).
 * Shared by measure.mjs and _verify.mjs — no I/O, no secrets.
 */

/** @param {number[]} values unsorted durations in ms */
export function percentileNearestRank(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("percentileNearestRank requires a non-empty array");
  }
  if (p < 0 || p > 100) {
    throw new Error("percentile must be between 0 and 100");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const idx = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[idx];
}

/** @param {number[]} values */
export function summarizeLatencies(values) {
  return {
    count: values.length,
    p50Ms: percentileNearestRank(values, 50),
    p95Ms: percentileNearestRank(values, 95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}
