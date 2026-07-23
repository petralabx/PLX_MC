// DB TLS resolution (TASK-623) — certificate verification is ON by default.
// The AWS RDS global CA bundle is vendored as a JSON module (config/certs/)
// so it bundles like any other config JSON — no runtime fs, which keeps this
// file safe in the Edge Middleware graph (db/index → permissions/repository →
// auth pulls it in; edge builds reject Node APIs). Overrides cover non-RDS
// hosts, and the explicit PLX_MC_DB_TLS_INSECURE=1 escape hatch restores the
// legacy no-verify behavior (loudly) for break-glass only.

import rdsCaBundle from "../../../config/certs/aws-rds-global-bundle.json";

export interface DbSslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

export function resolveDbSsl(
  env: Record<string, string | undefined> = process.env
): DbSslConfig {
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
  return { rejectUnauthorized: true, ca: rdsCaBundle.pem };
}
