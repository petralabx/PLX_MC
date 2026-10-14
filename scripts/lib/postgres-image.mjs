import { spawnSync } from "node:child_process";

// AWS ECR public mirror of the Docker Hub official image (avoids Docker Hub pull rate limits).
export const POSTGRES_IMAGE = "public.ecr.aws/docker/library/postgres:16-alpine";

// The same official image on Docker Hub. Pulled only when ECR Public refuses the
// pull (anonymous quota: "toomanyrequests: Data limit exceeded"), then tagged as
// POSTGRES_IMAGE so `docker run POSTGRES_IMAGE` finds it locally (TASK-2934).
export const POSTGRES_IMAGE_FALLBACK = "docker.io/library/postgres:16-alpine";

// The Postgres suites run in parallel, so a refused pull (a Docker Hub 429) can
// race a parallel suite whose pull is still running: wait for that copy. 30 polls
// 2 s apart end inside the suites' 90 s beforeAll budget.
const PARALLEL_SUITE_POLLS = 30;
const PARALLEL_SUITE_POLL_MS = 2_000;

/**
 * @typedef {{ status: number | null, stdout?: string, stderr?: string, error?: Error }} DockerResult
 * @typedef {"local" | "ecr" | "docker-hub" | "docker-hub-cached" | "parallel-suite"} ImageSource
 * @typedef {{ ok: true, source: ImageSource } | { ok: false, error: string }} EnsureImageResult
 */

/** @param {string[]} args @returns {DockerResult} */
const runDocker = (args) => spawnSync("docker", args, { encoding: "utf8" });

/** Blocking sleep; callers are synchronous test setup and the harness CLI. @param {number} ms */
const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** @param {DockerResult} result */
const message = (result) => (result.stderr || result.stdout || result.error?.message || "").trim();

/**
 * Make POSTGRES_IMAGE available locally before `docker run`: use it if present,
 * else pull it from ECR, else tag the Docker Hub original (pulled only when no
 * copy is cached, since Docker Hub rate-limits anonymous pulls too). If that
 * pull is refused as well, wait for a parallel suite's copy before giving up.
 * @param {(args: string[]) => DockerResult} [docker]
 * @param {(ms: number) => void} [sleep]
 * @returns {EnsureImageResult}
 */
export function ensurePostgresImage(docker = runDocker, sleep = sleepSync) {
  /** @param {string} image */
  const present = (image) => docker(["image", "inspect", image]).status === 0;
  if (present(POSTGRES_IMAGE)) return { ok: true, source: "local" };
  const ecr = docker(["pull", POSTGRES_IMAGE]);
  if (ecr.status === 0) return { ok: true, source: "ecr" };
  /** @type {ImageSource} */
  let source = "docker-hub-cached";
  if (!present(POSTGRES_IMAGE_FALLBACK)) {
    source = "docker-hub";
    const hub = docker(["pull", POSTGRES_IMAGE_FALLBACK]);
    if (hub.status !== 0) {
      const copy = waitForParallelSuite(present, sleep);
      if (!copy) {
        return {
          ok: false,
          error: `pull ${POSTGRES_IMAGE} failed: ${message(ecr)}\npull ${POSTGRES_IMAGE_FALLBACK} failed: ${message(hub)}`,
        };
      }
      if (copy === POSTGRES_IMAGE) return { ok: true, source: "parallel-suite" };
      source = "parallel-suite";
    }
  }
  const tag = docker(["tag", POSTGRES_IMAGE_FALLBACK, POSTGRES_IMAGE]);
  if (tag.status !== 0) return { ok: false, error: `tag ${POSTGRES_IMAGE_FALLBACK} failed: ${message(tag)}` };
  return { ok: true, source };
}

/**
 * Poll for a copy a parallel suite is still pulling; returns the image found, or null.
 * @param {(image: string) => boolean} present
 * @param {(ms: number) => void} sleep
 */
function waitForParallelSuite(present, sleep) {
  for (let poll = 0; poll < PARALLEL_SUITE_POLLS; poll++) {
    sleep(PARALLEL_SUITE_POLL_MS);
    if (present(POSTGRES_IMAGE)) return POSTGRES_IMAGE;
    if (present(POSTGRES_IMAGE_FALLBACK)) return POSTGRES_IMAGE_FALLBACK;
  }
  return null;
}
