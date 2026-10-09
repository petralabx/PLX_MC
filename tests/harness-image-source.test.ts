// Harness images must come from the AWS ECR public mirror, not Docker Hub
// (unauthenticated pulls hit `toomanyrequests`).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");
const shared = read("scripts", "lib", "postgres-image.mjs");
const consumers = {
  harness: read("scripts", "test-routing-postgres.mjs"),
  schemaPostgres: read("tests", "schema-postgres.test.ts"),
};

describe("test harness image source", () => {
  it("defines the postgres image once, on the ECR public mirror", () => {
    expect(shared).toContain('"public.ecr.aws/docker/library/postgres:16-alpine"');
  });

  it.each(Object.entries(consumers))("%s uses the shared image with no bare or docker.io reference", (_name, source) => {
    expect(source).toContain("POSTGRES_IMAGE");
    expect(source).toContain("postgres-image.mjs");
    expect(source).not.toMatch(/(^|[^/\w.-])postgres:\d/m);
    expect(source).not.toMatch(/docker\.io/);
  });
});
