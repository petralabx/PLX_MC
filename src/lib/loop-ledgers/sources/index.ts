// Sub-barrel for loop-ledgers source adapters.
// Consumers should import through the root barrel (src/lib/loop-ledgers/index.ts).

export type {
  DiscoveredLedger,
  LedgerDetailResult,
  LedgerSource,
  LedgerSourceResult,
  SourceDegradedReason,
} from "./source";

export { GithubApiSource } from "./github-api";
export type { LocalFsOptions } from "./local-fs";
export { LocalFsSource } from "./local-fs";

// ─── Source factory ───────────────────────────────────────────────────────────

import type { LedgerSource } from "./source";
import { GithubApiSource as _GithubApiSource } from "./github-api";

/**
 * Returns the appropriate LedgerSource for the current environment.
 *
 * - production (NODE_ENV === 'production'): GithubApiSource
 * - development / test (default): GithubApiSource
 *
 * To use LocalFsSource in development, construct it directly with repoRoots
 * and pass it explicitly — the factory always returns the GitHub adapter so
 * that the real cross-repo read path is exercised during local dev by default.
 * Swap to LocalFsSource only for offline dev or hermetic test scenarios.
 */
export function createSource(): LedgerSource {
  return new _GithubApiSource();
}
