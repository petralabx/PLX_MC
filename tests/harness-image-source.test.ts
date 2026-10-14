// Harness images come from the AWS ECR public mirror, not Docker Hub
// (unauthenticated pulls hit `toomanyrequests`). Only the shared module may fall
// back to the Docker Hub original, when ECR Public refuses the pull too
// (`toomanyrequests: Data limit exceeded`, TASK-2934).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  POSTGRES_IMAGE,
  POSTGRES_IMAGE_FALLBACK,
  ensurePostgresImage,
} from "../scripts/lib/postgres-image.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");
const shared = read("scripts", "lib", "postgres-image.mjs");
const consumers = {
  harness: read("scripts", "test-routing-postgres.mjs"),
  schemaPostgres: read("tests", "schema-postgres.test.ts"),
  reportingGoalsPostgres: read("tests", "reporting-goals-postgres.test.ts"),
};

describe("test harness image source", () => {
  it("defines the postgres image once, on the ECR public mirror", () => {
    expect(shared).toContain('"public.ecr.aws/docker/library/postgres:16-alpine"');
  });

  it.each(Object.entries(consumers))("%s uses the shared image with no bare or Docker Hub reference", (_name, source) => {
    expect(source).toContain("POSTGRES_IMAGE");
    expect(source).toContain("postgres-image.mjs");
    expect(source).not.toMatch(/(^|[^/\w.-])postgres:\d/m);
    expect(source).not.toMatch(/docker\.io/);
  });

  it.each(Object.entries(consumers))("%s makes the image available before docker run", (_name, source) => {
    expect(source).toContain("ensurePostgresImage()");
    expect(source.indexOf("ensurePostgresImage()")).toBeLessThan(source.indexOf('"run"'));
  });
});

describe("ensurePostgresImage", () => {
  const inspect = `image inspect ${POSTGRES_IMAGE}`;
  const pullEcr = `pull ${POSTGRES_IMAGE}`;
  const inspectHub = `image inspect ${POSTGRES_IMAGE_FALLBACK}`;
  const pullHub = `pull ${POSTGRES_IMAGE_FALLBACK}`;
  const tag = `tag ${POSTGRES_IMAGE_FALLBACK} ${POSTGRES_IMAGE}`;
  const refused = { status: 1, stderr: "toomanyrequests: Data limit exceeded" };

  // Records each docker invocation; anything not listed fails like a missing image.
  function fakeDocker(results: Record<string, { status: number; stderr?: string }>) {
    const calls: string[] = [];
    const docker = (args: string[]) => {
      const key = args.join(" ");
      calls.push(key);
      return results[key] ?? { status: 1, stderr: `no result for: ${key}` };
    };
    return { docker, calls };
  }

  it("falls back to the same official image on Docker Hub", () => {
    expect(POSTGRES_IMAGE_FALLBACK).toBe("docker.io/library/postgres:16-alpine");
  });

  it("uses an image that is already present without pulling", () => {
    const { docker, calls } = fakeDocker({ [inspect]: { status: 0 } });
    expect(ensurePostgresImage(docker)).toEqual({ ok: true, source: "local" });
    expect(calls).toEqual([inspect]);
  });

  it("pulls from the ECR mirror first", () => {
    const { docker, calls } = fakeDocker({ [pullEcr]: { status: 0 } });
    expect(ensurePostgresImage(docker)).toEqual({ ok: true, source: "ecr" });
    expect(calls).toEqual([inspect, pullEcr]);
  });

  it("pulls the Docker Hub original and tags it when ECR refuses the pull", () => {
    const { docker, calls } = fakeDocker({ [pullEcr]: refused, [pullHub]: { status: 0 }, [tag]: { status: 0 } });
    expect(ensurePostgresImage(docker)).toEqual({ ok: true, source: "docker-hub" });
    expect(calls).toEqual([inspect, pullEcr, inspectHub, pullHub, tag]);
  });

  it("tags a cached Docker Hub copy without pulling it again when ECR refuses the pull", () => {
    const { docker, calls } = fakeDocker({ [pullEcr]: refused, [inspectHub]: { status: 0 }, [tag]: { status: 0 } });
    expect(ensurePostgresImage(docker)).toEqual({ ok: true, source: "docker-hub-cached" });
    expect(calls).toEqual([inspect, pullEcr, inspectHub, tag]);
  });

  it("reports both registries' errors when neither pull works", () => {
    const { docker } = fakeDocker({ [pullEcr]: refused, [pullHub]: { status: 1, stderr: "toomanyrequests: pull rate limit" } });
    expect(ensurePostgresImage(docker)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Data limit exceeded[\s\S]*pull rate limit/),
    });
  });

  it("fails when the Docker Hub image cannot be tagged", () => {
    const { docker } = fakeDocker({ [pullEcr]: refused, [pullHub]: { status: 0 }, [tag]: { status: 1, stderr: "tag refused" } });
    expect(ensurePostgresImage(docker)).toMatchObject({ ok: false, error: expect.stringMatching(/tag refused/) });
  });
});
