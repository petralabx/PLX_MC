// Single in-flight import of the db module.
//
// Several callers (identity lookups and the permissions decision log) load
// `@/lib/db` lazily so mode "off" stays connection-free. Two overlapping
// `import("@/lib/db")` calls deadlock: the second never settles, and the
// decision row or lookup behind it is dropped. Share one promise instead.

export type SqlQuery = (
  text: string,
  params?: unknown[]
) => Promise<Record<string, unknown>[]>;

let loader: Promise<SqlQuery> | undefined;

export function loadDbQuery(): Promise<SqlQuery> {
  if (!loader) {
    loader = import("@/lib/db")
      .then((mod) => mod.query as SqlQuery)
      .catch((err: unknown) => {
        loader = undefined;
        throw err;
      });
  }
  return loader;
}
