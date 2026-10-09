import { readdir } from "node:fs/promises";
import path from "node:path";

/** @param {string} [directory] */
export async function expectedMigrations(directory = path.join(process.cwd(), "db/migrations")) {
  const files = (await readdir(directory)).filter(f => f.endsWith(".sql")).sort();
  const prefixes = new Set();
  for (const file of files) {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(file) || prefixes.has(file.slice(0, 3))) {
      throw new Error("invalid migration manifest");
    }
    prefixes.add(file.slice(0, 3));
  }
  if (!files.length) throw new Error("empty migration manifest");
  return files;
}

// Build-time generator: bundle the exact migration set without runtime fs.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const files = await expectedMigrations(path.join(root, "db/migrations"));
  await writeFile(path.join(root, "src/lib/db/migration-manifest.json"), JSON.stringify(files, null, 2) + "\n");
}
