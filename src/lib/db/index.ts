// Postgres access for the sync engine — one pool per server process.
// Schema is owned by db/migrations/ (numbered runner); this module only
// queries. All SQL goes through parameterized placeholders.

import { Pool } from "pg";
import { databaseUrl } from "@/lib/secrets";

// Survive Next.js dev-mode module reloads without leaking pools.
const globalForDb = globalThis as unknown as { __plxMcPool?: Pool };

function pool(): Pool {
  if (!globalForDb.__plxMcPool) {
    globalForDb.__plxMcPool = new Pool({
      // Strip sslmode — it would override the ssl option, and this box has
      // no RDS CA bundle for verify-full (same approach as scripts/migrate.mjs).
      connectionString: databaseUrl()
        .replace(/([?&])sslmode=[^&]+&?/, "$1")
        .replace(/[?&]$/, ""),
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return globalForDb.__plxMcPool;
}

export async function query<R extends object = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<R[]> {
  const result = await pool().query(text, params);
  return result.rows as R[];
}
