import { spawnSync } from "node:child_process";

// AWS ECR public mirror of the Docker Hub official image (avoids Docker Hub pull rate limits).
export const POSTGRES_IMAGE = "public.ecr.aws/docker/library/postgres:16-alpine";

// The same official image on Docker Hub. Pulled only when ECR Public refuses the
// pull (anonymous quota: "toomanyrequests: Data limit exceeded"), then tagged as
// POSTGRES_IMAGE so `docker run POSTGRES_IMAGE` finds it locally (TASK-2934).
export const POSTGRES_IMAGE_FALLBACK = "docker.io/library/postgres:16-alpine";

/**
 * @typedef {{ status: number | null, stdout?: string, stderr?: string, error?: Error }} DockerResult
 * @typedef {{ ok: true, source: "local" | "ecr" | "docker-hub" | "docker-hub-cached" } | { ok: false, error: string }} EnsureImageResult
 */

/** @param {string[]} args @returns {DockerResult} */
const runDocker = (args) => spawnSync("docker", args, { encoding: "utf8" });

/** @param {DockerResult} result */
const message = (result) => (result.stderr || result.stdout || result.error?.message || "").trim();

/**
 * Make POSTGRES_IMAGE available locally before `docker run`: use it if present,
 * else pull it from ECR, else tag the Docker Hub original (pulled only when no
 * copy is cached, since Docker Hub rate-limits anonymous pulls too).
 * @param {(args: string[]) => DockerResult} [docker]
 * @returns {EnsureImageResult}
 */
export function ensurePostgresImage(docker = runDocker) {
  if (docker(["image", "inspect", POSTGRES_IMAGE]).status === 0) return { ok: true, source: "local" };
  const ecr = docker(["pull", POSTGRES_IMAGE]);
  if (ecr.status === 0) return { ok: true, source: "ecr" };
  const cached = docker(["image", "inspect", POSTGRES_IMAGE_FALLBACK]).status === 0;
  if (!cached) {
    const hub = docker(["pull", POSTGRES_IMAGE_FALLBACK]);
    if (hub.status !== 0) {
      return {
        ok: false,
        error: `pull ${POSTGRES_IMAGE} failed: ${message(ecr)}\npull ${POSTGRES_IMAGE_FALLBACK} failed: ${message(hub)}`,
      };
    }
  }
  const tag = docker(["tag", POSTGRES_IMAGE_FALLBACK, POSTGRES_IMAGE]);
  if (tag.status !== 0) return { ok: false, error: `tag ${POSTGRES_IMAGE_FALLBACK} failed: ${message(tag)}` };
  return { ok: true, source: cached ? "docker-hub-cached" : "docker-hub" };
}
