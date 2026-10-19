import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// GitHub CODEOWNERS semantics: gitignore-style patterns, the LAST matching rule wins.
function toRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith("/") || pattern.replace(/\/$/, "").includes("/");
  const body = pattern.replace(/^\//, "").replace(/\/$/, "")
    .split(/(\*\*\/|\/\*\*|\*\*|\*|\?)/)
    .map(part => ({ "**/": "(?:.*/)?", "/**": "/.*", "**": ".*", "*": "[^/]*", "?": "[^/]" })[part] ?? part.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
    .join("");
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}${pattern.endsWith("/") ? "/.*" : "(?:/.*)?"}$`);
}
function rules(text: string) {
  return text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => { const [pattern, ...owners] = l.split(/\s+/); return { re: toRegExp(pattern), owners }; });
}
function ownersOf(text: string, file: string): string[] {
  return rules(text).filter(r => r.re.test(file)).at(-1)?.owners ?? [];
}

const codeowners = readFileSync(".github/CODEOWNERS", "utf8");
const migrationOwners = ownersOf(codeowners, "db/migrations/001_example.sql");
// Everything that decides what the migration and SharePoint provisioning paths execute.
const privileged = [
  ".github/CODEOWNERS",
  ".github/workflows/db-migrate.yml",
  ".github/workflows/db-migrate-live.yml",
  "scripts/db-migrate-live.mjs",
  "scripts/dual-db-migrate.sh",
  "scripts/migrate.mjs",
  "scripts/provision-sharepoint.py",
  "scripts/lib/db-identity.mjs",
  "scripts/lib/db-ssl.mjs",
  "config/certs/aws-rds-global-bundle.json",
  "config/sharepoint-schema.json",
  "package.json",
];

describe("CODEOWNERS matcher", () => {
  it("follows gitignore-style globs and last-match-wins", () => {
    const text = "/db/ @a\n/.github/workflows/db-migrate*.yml @b\n*.md @c\n/db/x.sql @d";
    expect(ownersOf(text, "db/migrations/1.sql")).toEqual(["@a"]);
    expect(ownersOf(text, "db/x.sql")).toEqual(["@d"]);
    expect(ownersOf(text, "db/README.md")).toEqual(["@c"]);
    expect(ownersOf(text, ".github/workflows/db-migrate-live.yml")).toEqual(["@b"]);
    expect(ownersOf(text, ".github/workflows/ci.yml")).toEqual([]);
    expect(ownersOf(text, "src/db/x.sql")).toEqual([]);
  });
});

describe("migration path CODEOWNERS coverage", () => {
  it("has a migration owner", () => { expect(migrationOwners.length).toBeGreaterThan(0); });
  it.each(privileged)("%s exists and is owned by the migration owner", file => {
    expect(existsSync(file), `${file} moved: update CODEOWNERS and this list`).toBe(true);
    expect(ownersOf(codeowners, file)).toEqual(migrationOwners);
  });
});
