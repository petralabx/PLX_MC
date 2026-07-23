// Shared DB TLS resolution for ops scripts (TASK-623) — mirror of
// src/lib/db/tls.ts. Verification is ON by default against the vendored RDS
// CA bundle; PLX_MC_DB_TLS_INSECURE=1 is the explicit break-glass escape.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const RDS_CA_BUNDLE_PATH = join(
  repoRoot,
  "config",
  "certs",
  "aws-rds-global-bundle.json"
);

export function resolveDbSsl(env = process.env) {
  if ((env.PLX_MC_DB_TLS_INSECURE ?? "").trim() === "1") {
    console.warn(
      "[db] TLS certificate verification DISABLED (PLX_MC_DB_TLS_INSECURE=1) — break-glass only."
    );
    return { rejectUnauthorized: false };
  }
  const inlineCa = env.PLX_MC_DB_CA_CERT?.trim();
  if (inlineCa) {
    return { rejectUnauthorized: true, ca: inlineCa };
  }
  try {
    return { rejectUnauthorized: true, ca: JSON.parse(readFileSync(RDS_CA_BUNDLE_PATH, "utf8")).pem };
  } catch (err) {
    console.error(
      `[db] CA bundle unreadable at ${RDS_CA_BUNDLE_PATH} (${err instanceof Error ? err.message : String(err)}) — verifying against system trust store.`
    );
    return { rejectUnauthorized: true };
  }
}
