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
  const hubRefused = { status: 1, stderr: "toomanyrequests: pull rate limit" };
  type Result = { status: number; stderr?: string };

  // Records each docker invocation; anything not listed fails like a missing image.
  // A list answers successive calls in turn (the last answer repeats), like an
  // image that a parallel suite finishes pulling while this one waits.
  function fakeDocker(results: Record<string, Result | Result[]>) {
    const calls: string[] = [];
    const docker = (args: string[]) => {
      const key = args.join(" ");
      calls.push(key);
      const answer = results[key];
      if (!Array.isArray(answer)) return answer ?? { status: 1, stderr: `no result for: ${key}` };
      return answer.length > 1 ? answer.shift()! : answer[0];
    };
    return { docker, calls };
  }

  function recordedSleep() {
    const sleeps: number[] = [];
    return { sleep: (ms: number) => void sleeps.push(ms), sleeps };
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

  it("uses a parallel suite's ECR copy when its own Docker Hub pull is refused", () => {
    const { docker, calls } = fakeDocker({
      [inspect]: [{ status: 1 }, { status: 1 }, { status: 0 }],
      [pullEcr]: refused,
      [pullHub]: hubRefused,
    });
    const { sleep, sleeps } = recordedSleep();
    expect(ensurePostgresImage(docker, sleep)).toEqual({ ok: true, source: "parallel-suite" });
    expect(calls).not.toContain(tag);
    expect(sleeps.length).toBe(2);
  });

  it("tags a parallel suite's Docker Hub copy when its own pull is refused", () => {
    const { docker, calls } = fakeDocker({
      [pullEcr]: refused,
      [inspectHub]: [{ status: 1 }, { status: 1 }, { status: 0 }],
      [pullHub]: hubRefused,
      [tag]: { status: 0 },
    });
    const { sleep } = recordedSleep();
    expect(ensurePostgresImage(docker, sleep)).toEqual({ ok: true, source: "parallel-suite" });
    expect(calls.at(-1)).toBe(tag);
  });

  it("reports both registries' errors when neither pull works and no copy appears in time", () => {
    const { docker } = fakeDocker({ [pullEcr]: refused, [pullHub]: hubRefused });
    const { sleep, sleeps } = recordedSleep();
    expect(ensurePostgresImage(docker, sleep)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Data limit exceeded[\s\S]*pull rate limit/),
    });
    // The wait has to end well inside the suites' 90 s beforeAll budget.
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBeLessThanOrEqual(60_000);
  });

  it("fails when the Docker Hub image cannot be tagged", () => {
    const { docker } = fakeDocker({ [pullEcr]: refused, [pullHub]: { status: 0 }, [tag]: { status: 1, stderr: "tag refused" } });
    expect(ensurePostgresImage(docker)).toMatchObject({ ok: false, error: expect.stringMatching(/tag refused/) });
  });
});
