// Harness images must come from the AWS ECR public mirror, not Docker Hub
// (unauthenticated pulls hit `toomanyrequests`).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = readFileSync(path.join(root, "scripts", "test-routing-postgres.mjs"), "utf8");

describe("test harness image source", () => {
  it("pulls postgres from the ECR public mirror", () => {
    expect(harness).toContain('"public.ecr.aws/docker/library/postgres:16-alpine"');
  });

  it("has no bare or docker.io postgres image reference", () => {
    expect(harness).not.toMatch(/(^|[^/\w.-])postgres:\d/m);
    expect(harness).not.toMatch(/docker\.io/);
  });
});
