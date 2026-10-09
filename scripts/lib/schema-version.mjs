// Shared read-only schema contract for deploy and runtime. Filenames, not just
// MAX(version), are authoritative: a newer ledger entry cannot hide a gap.
/** @param {string[]} expected @param {string[]} applied */
export function compareMigrations(expected, applied) {
  const missing = expected.filter(f => !applied.includes(f)).sort();
  const version = (/** @type {string[]} */ files) => files.filter(f => /^\d{3}_/.test(f)).sort().at(-1)?.slice(0, 3) ?? "000";
  const expectedVersion = version(expected);
  const appliedVersion = version(applied);
  return { ok: missing.length === 0, expectedVersion, appliedVersion, missing,
    message: missing.length ? `schema behind: expected ${expectedVersion}, db at ${appliedVersion}; missing ${missing.join(", ")}` : "schema ready" };
}

export class SchemaMismatchError extends Error {
  /** @param {ReturnType<typeof compareMigrations>} schema */
  constructor(schema) {
    super(schema.message);
    this.schema = schema;
    this.code = "schema_behind";
    this.status = 503;
  }
}

/** @param {(sql: string) => Promise<{rows: {filename?: string, ledger?: unknown}[]}>} query @param {string[]} expected */
export async function readSchemaVersion(query, expected) {
  const exists = (await query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0]?.ledger;
  const applied = exists ? (await query("SELECT filename FROM public.schema_migrations")).rows.map(r => String(r.filename)) : [];
  return compareMigrations(expected, applied);
}
