// Company-brain session-end hook — contract tests for scripts/compliance-closeout.mjs.
// Every repo is a throwaway git repo under os.tmpdir(); fetch is a recorder, so
// nothing touches tracked paths or the network.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/compliance-closeout.mjs"
);
const { closeout, parseHookPayload, payloadTokens, reportTelemetry, repoFromRemoteUrl, sumTranscriptUsage } =
  await import(pathToFileURLSafe(scriptPath));

function pathToFileURLSafe(filePath: string): string {
  const normalized = path.resolve(filePath);
  let pathname = normalized.replace(/\\/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/ /g, "%20");
  return `file://${pathname}`;
}

const BASE_AT = "2026-09-01T00:00:00Z";
const BRANCHED_AT = "2026-09-25T09:50:00Z";
const C1_AT = "2026-09-25T10:00:00Z";
const C2_AT = "2026-09-25T10:30:00Z";
const NOW = new Date("2026-09-25T11:00:00.000Z");
const PROD_ROUTE = "https://missioncontrol.tayloralton.com/api/vmc/knowledge/session-artifact";

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "closeout-test-"));
  tempDirs.push(dir);
  return dir;
}

function gitIn(dir: string) {
  return (args: string[], at?: string) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        ...(at ? { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : {}),
      },
    });
}

function writeIn(dir: string, rel: string, body: string) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), body);
}

/** main (already on origin) -> feat/widget with two session commits + one untracked file. */
function sessionRepo(): string {
  const dir = tempDir();
  const git = gitIn(dir);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "agent@example.com"]);
  git(["config", "user.name", "Agent"]);
  git(["remote", "add", "origin", "git@github.com:acme/widget.git"]);
  writeIn(dir, "README.md", "base\n");
  git(["add", "."]);
  git(["commit", "-qm", "chore: base"], BASE_AT);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["switch", "-q", "-c", "feat/widget"], BRANCHED_AT);
  writeIn(dir, "src/widget.ts", "export const w = 1;\n");
  git(["add", "."]);
  git(["commit", "-qm", "feat: add widget"], C1_AT);
  writeIn(dir, "src/widget.ts", "export const w = 2;\n");
  writeIn(dir, "docs/widget.md", "# widget\n");
  git(["add", "."]);
  git(["commit", "-qm", "fix: tighten widget"], C2_AT);
  // Unstaged edit: porcelain line " M src/widget.ts" starts with a space.
  writeIn(dir, "src/widget.ts", "export const w = 3;\n");
  writeIn(dir, "notes.txt", "wip\n");
  return dir;
}

function transcript(dir: string, firstAt: string): string {
  const file = path.join(dir, "transcript.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "summary", summary: "no timestamp on this line" }),
      JSON.stringify({ type: "user", message: { content: "hi" }, timestamp: firstAt }),
      JSON.stringify({ type: "assistant", timestamp: "2026-09-25T10:59:00.000Z" }),
    ].join("\n") + "\n"
  );
  return file;
}

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function recorder(ok = true) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
      ),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return { ok, status: ok ? 201 : 500 } as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const quiet = () => {};

describe("compliance-closeout artifact assembly", () => {
  it("uses the Claude Code payload id, transcript start, origin repo, and session commits", async () => {
    const dir = sessionRepo();
    const { fetch, calls } = recorder();
    const r = await closeout({
      env: { VMC_API_KEY: "k" },
      fetch,
      log: quiet,
      runtime: "claude-code",
      cwd: dir,
      now: NOW,
      payload: {
        session_id: "cc-session-1",
        transcript_path: transcript(dir, "2026-09-25T09:55:00.000Z"),
        cwd: dir,
        hook_event_name: "SessionEnd",
        reason: "other",
      },
    });
    expect(r.delivered).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(PROD_ROUTE);
    expect(calls[0].headers["x-agent-name"]).toBe("claude-code-session-hook");
    const a = calls[0].body;
    expect(a).toMatchObject({
      schema_version: 1,
      runtime: "claude-code",
      session_id: "cc-session-1",
      started_at: "2026-09-25T09:55:00.000Z",
      ended_at: "2026-09-25T11:00:00.000Z",
      repo: "widget",
      branch: "feat/widget",
    });
    expect(a.summary).not.toMatch(/skeletal/i);
    expect(a.summary).toContain("feat: add widget");
    expect(a.summary).toContain("fix: tighten widget");
    expect(a.title).toContain("fix: tighten widget");
    // Committed files survive the commit; the base commit is not this session's.
    expect(a.files_touched).toEqual(expect.arrayContaining(["src/widget.ts", "docs/widget.md", "notes.txt"]));
    expect(a.files_touched).not.toContain("README.md");
    for (const file of a.files_touched as string[]) expect(existsSync(path.join(dir, file)), file).toBe(true);
    expect(a.evidence).toHaveLength(2);
    expect(a.tags).not.toContain("session-id:generated");
  });

  it("scopes commits to the session window when the start is known", async () => {
    const dir = sessionRepo();
    const { fetch, calls } = recorder();
    await closeout({
      env: { VMC_API_KEY: "k" },
      fetch,
      log: quiet,
      runtime: "claude-code",
      cwd: dir,
      now: NOW,
      payload: { session_id: "cc-late", transcript_path: transcript(dir, "2026-09-25T10:15:00.000Z") },
    });
    const a = calls[0].body;
    expect(a.started_at).toBe("2026-09-25T10:15:00.000Z");
    expect(a.summary).toContain("fix: tighten widget");
    expect(a.summary).not.toContain("feat: add widget");
    expect(a.evidence).toHaveLength(1);
  });

  it("uses the Cursor conversation_id and duration_ms", async () => {
    const dir = sessionRepo();
    const { fetch, calls } = recorder();
    await closeout({
      env: { VMC_API_KEY: "k" },
      fetch,
      log: quiet,
      cwd: dir,
      now: NOW,
      payload: { conversation_id: "cursor-conv-9", hook_event_name: "sessionEnd", duration_ms: 3_600_000 },
    });
    expect(calls[0].headers["x-agent-name"]).toBe("cursor-session-hook");
    expect(calls[0].body).toMatchObject({
      runtime: "cursor",
      session_id: "cursor-conv-9",
      started_at: "2026-09-25T10:00:00.000Z",
    });
  });

  it("without a payload: generated id is flagged and started_at comes from git, not ended_at", async () => {
    const dir = sessionRepo();
    const { fetch, calls } = recorder();
    const r = await closeout({ env: {}, fetch, log: quiet, cwd: dir, now: NOW });
    expect(calls).toHaveLength(0);
    expect(r.delivered).toBe(false);
    expect(path.dirname(r.queued)).toBe(path.join(dir, "artifacts", "session-brain", "2026-09-25"));
    const a = JSON.parse(readFileSync(r.queued, "utf8"));
    expect(path.basename(r.queued)).toBe(`${a.session_id}.json`);
    expect(a.session_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.tags).toContain("session-id:generated");
    expect(a.summary).toMatch(/generated/);
    // Branch creation (reflog) predates the first session commit.
    expect(a.started_at).toBe(new Date(BRANCHED_AT).toISOString());
    expect(a.files_touched).toEqual(expect.arrayContaining(["src/widget.ts", "docs/widget.md"]));
  });

  it("marks started_at unknown only when nothing can date the session", async () => {
    const dir = tempDir();
    const git = gitIn(dir);
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "agent@example.com"]);
    git(["config", "user.name", "Agent"]);
    writeIn(dir, "README.md", "base\n");
    git(["add", "."]);
    git(["commit", "-qm", "chore: base"], BASE_AT);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const r = await closeout({ env: {}, log: quiet, cwd: dir, now: NOW, payload: { session_id: "s-1" } });
    const a = JSON.parse(readFileSync(r.queued, "utf8"));
    expect(a.started_at).toBe(a.ended_at);
    expect(a.tags).toContain("started-at:unknown");
    expect(a.repo).toBe("unknown");
    expect(a.evidence).toEqual([]);
  });
});

describe("compliance-closeout fail-open", () => {
  it("honours the SESSION_BRAIN_ENABLED kill switch", async () => {
    const dir = sessionRepo();
    const { fetch, calls } = recorder();
    const r = await closeout({ env: { SESSION_BRAIN_ENABLED: "0", VMC_API_KEY: "k" }, fetch, log: quiet, cwd: dir });
    expect(r).toEqual({ delivered: false, queued: null, skipped: true });
    expect(calls).toHaveLength(0);
    expect(existsSync(path.join(dir, "artifacts"))).toBe(false);
  });

  it("queues inside the queue dir when delivery fails, even for a hostile session id", async () => {
    const dir = sessionRepo();
    const fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;
    const r = await closeout({
      env: { VMC_API_KEY: "k", VMC_BASE_URL: "http://vmc.test/" },
      fetch,
      log: quiet,
      cwd: dir,
      now: NOW,
      payload: { session_id: "../../escape" },
    });
    expect(r.delivered).toBe(false);
    expect(path.dirname(r.queued)).toBe(path.join(dir, "artifacts", "session-brain", "2026-09-25"));
    expect(JSON.parse(readFileSync(r.queued, "utf8")).session_id).toBe("../../escape");
  });

  it("CLI reads the hook payload from stdin and always exits 0", () => {
    const dir = sessionRepo();
    mkdirSync(path.join(dir, "scripts"));
    const cli = path.join(dir, "scripts", "compliance-closeout.mjs");
    copyFileSync(scriptPath, cli);
    const env = { ...process.env, VMC_API_KEY: "", SESSION_BRAIN_ENABLED: "1" };
    const ok = spawnSync(process.execPath, [cli, "--runtime", "claude-code"], {
      cwd: dir,
      env,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "cli-session", cwd: dir, hook_event_name: "SessionEnd" }),
    });
    expect(ok.status).toBe(0);
    const queueRoot = path.join(dir, "artifacts", "session-brain");
    const [day] = readdirSync(queueRoot);
    const a = JSON.parse(readFileSync(path.join(queueRoot, day, "cli-session.json"), "utf8"));
    expect(a.runtime).toBe("claude-code");

    const garbage = spawnSync(process.execPath, [cli], { cwd: dir, env, encoding: "utf8", input: "not json{" });
    expect(garbage.status).toBe(0);
  });
});

// ---------------------------------------------------------------- session telemetry (TASK-4273)

const KEY = "mc-test-key-SHOULD-NEVER-PRINT";
const MC_ENV = { MC_BASE_URL: "http://mc.test/", MC_MCP_API_KEY: KEY, MC_OPERATOR_EMAIL: "Agent@Example.com" };

function assistant(id: string, usage: Record<string, unknown>, model = "claude-test-1") {
  return JSON.stringify({ type: "assistant", requestId: `req-${id}`, message: { id, model, usage } });
}

/** Two messages; m1's content blocks repeat its usage on two lines, as Claude Code writes them. */
function usageTranscript(dir: string): string {
  const file = path.join(dir, "usage.jsonl");
  const m1 = { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "user", message: { content: "hi", usage: { input_tokens: 999 } } }),
      assistant("m1", m1),
      assistant("m1", m1),
      assistant("m2", { input_tokens: 7, output_tokens: 20 }, "claude-other-2"),
      assistant("m3", { input_tokens: 0, output_tokens: 0 }, "<synthetic>"),
      assistant("m4", { input_tokens: 5, output_tokens: 5 }),
      '{"type":"assistant","message":{"usage":', // a truncated last line
    ].join("\n")
  );
  return file;
}

function logSink() {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

describe("compliance-closeout session telemetry", () => {
  it("sums each Claude Code message once and names the model it used most", async () => {
    const u = await sumTranscriptUsage(usageTranscript(tempDir()));
    expect(u).toEqual({ tokensIn: 3 + 100 + 1000 + 7 + 5, tokensOut: 50 + 20 + 5, model: "claude-test-1", messages: 4 });
  });

  it("reports no sum for a missing, oversized or usage-free transcript", async () => {
    const dir = tempDir();
    expect(await sumTranscriptUsage(path.join(dir, "missing.jsonl"))).toBeNull();
    expect(await sumTranscriptUsage(usageTranscript(dir), { maxBytes: 10 })).toBeNull();
    expect(await sumTranscriptUsage(transcript(dir, C1_AT))).toBeNull();
    expect(await sumTranscriptUsage("")).toBeNull();
  });

  it("reads token counts from a hook payload only when it has them", () => {
    expect(payloadTokens({ session_id: "s", reason: "completed", duration_ms: 5 })).toBeNull();
    expect(payloadTokens({ input_tokens: 12, output_tokens: 3, model: "m" })).toEqual({ tokensIn: 12, tokensOut: 3, model: "m" });
    expect(payloadTokens({ usage: { input_tokens: 4 } })).toEqual({ tokensIn: 4, tokensOut: 0, model: null });
    expect(payloadTokens(null)).toBeNull();
  });

  it("posts one Claude Code row with the repo, the runtime and the newest session commit's checkout", async () => {
    const dir = sessionRepo();
    const git = gitIn(dir);
    git(["add", "."]);
    git(["commit", "-qm", "feat: stamp\n\nAgent: claude-code/x\nMC-Checkout: dsp_old1\nMC-Checkout: dsp_new2"], C2_AT);
    const { fetch, calls } = recorder();
    const { log, lines } = logSink();
    const r = await reportTelemetry({
      env: MC_ENV,
      fetch,
      log,
      cwd: dir,
      runtime: "claude-code",
      payload: { session_id: "sess-1", transcript_path: usageTranscript(dir) },
    });
    expect(r.reported).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://mc.test/api/cursor/session-telemetry");
    expect(calls[0].headers).toMatchObject({
      "x-api-key": KEY,
      "x-mc-operator-email": "agent@example.com",
      "x-mc-runtime": "claude-code",
      "x-mc-repo": "acme/widget",
    });
    expect(calls[0].body).toEqual({
      sessionId: "sess-1",
      tokensIn: 1115,
      tokensOut: 75,
      model: "claude-test-1",
      checkoutId: "dsp_new2",
    });
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("prefers MC_CHECKOUT_ID and sends no checkout when none is known", async () => {
    const dir = sessionRepo();
    const payload = { session_id: "s", transcript_path: usageTranscript(dir) };
    const a = recorder();
    await reportTelemetry({ env: { ...MC_ENV, MC_CHECKOUT_ID: "dsp_env9" }, fetch: a.fetch, log: quiet, cwd: dir, runtime: "claude-code", payload });
    expect(a.calls[0].body.checkoutId).toBe("dsp_env9");
    const b = recorder();
    await reportTelemetry({ env: { ...MC_ENV, MC_CHECKOUT_ID: "pending" }, fetch: b.fetch, log: quiet, cwd: dir, runtime: "claude-code", payload });
    expect(b.calls[0].body).not.toHaveProperty("checkoutId");
  });

  it("reports a Cursor session only when its payload carries token counts", async () => {
    const dir = sessionRepo();
    const none = recorder();
    const { log, lines } = logSink();
    const r = await reportTelemetry({ env: MC_ENV, fetch: none.fetch, log, cwd: dir, payload: { conversation_id: "c-1", duration_ms: 9 } });
    expect(r).toEqual({ reported: false, reason: "the hook payload has no token counts" });
    expect(none.calls).toHaveLength(0);
    expect(lines).toEqual(["[session-telemetry] not reported: the hook payload has no token counts"]);
    const some = recorder();
    await reportTelemetry({ env: MC_ENV, fetch: some.fetch, log: quiet, cwd: dir, payload: { conversation_id: "c-2", input_tokens: 9, output_tokens: 4 } });
    expect(some.calls[0].headers["x-mc-runtime"]).toBe("cursor");
    expect(some.calls[0].body).toMatchObject({ sessionId: "c-2", tokensIn: 9, tokensOut: 4 });
  });

  it("fails open: kill switch, missing credentials, HTTP errors and network errors never throw or print the key", async () => {
    const dir = sessionRepo();
    const payload = { session_id: "s", transcript_path: usageTranscript(dir) };
    const cases: Array<[Record<string, string>, typeof globalThis.fetch, string]> = [
      [{ ...MC_ENV, SESSION_TELEMETRY_ENABLED: "0" }, recorder().fetch, "disabled (SESSION_TELEMETRY_ENABLED=0)"],
      [{ ...MC_ENV, MC_MCP_API_KEY: "${MC_MCP_API_KEY}" }, recorder().fetch, "MC_BASE_URL, MC_MCP_API_KEY or MC_OPERATOR_EMAIL is not set"],
      [{ MC_BASE_URL: "http://mc.test", MC_MCP_API_KEY: KEY }, recorder().fetch, "MC_BASE_URL, MC_MCP_API_KEY or MC_OPERATOR_EMAIL is not set"],
      [MC_ENV, recorder(false).fetch, "HTTP 500"],
      [MC_ENV, (async () => { throw new Error(`boom ${KEY}`); }) as unknown as typeof globalThis.fetch, "request failed"],
    ];
    for (const [env, fetch, reason] of cases) {
      const { log, lines } = logSink();
      const r = await reportTelemetry({ env, fetch, log, cwd: dir, runtime: "claude-code", payload });
      expect(r).toEqual({ reported: false, reason });
      expect(lines.join("\n")).not.toContain(KEY);
    }
    const noId = await reportTelemetry({ env: MC_ENV, fetch: recorder().fetch, log: quiet, cwd: dir, runtime: "claude-code", payload: {} });
    expect(noId.reason).toBe("the hook payload has no session id");
  });

  it("CLI sends the telemetry next to the artifact and exits 0 when Mission Control is unreachable", () => {
    const dir = sessionRepo();
    mkdirSync(path.join(dir, "scripts"));
    const cli = path.join(dir, "scripts", "compliance-closeout.mjs");
    copyFileSync(scriptPath, cli);
    const env = { ...process.env, VMC_API_KEY: "", ...MC_ENV, MC_BASE_URL: "http://127.0.0.1:9" };
    const run = spawnSync(process.execPath, [cli, "--runtime", "claude-code"], {
      cwd: dir,
      env,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "cli-tel", transcript_path: usageTranscript(dir) }),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("[session-telemetry] not reported: request failed");
    expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
  });
});

describe("compliance-closeout helpers", () => {
  it("derives owner/name from https, ssh, and scp-style remotes", () => {
    expect(repoFromRemoteUrl("https://github.com/petralabx/PLX_MC")).toEqual({
      slug: "petralabx/PLX_MC",
      name: "PLX_MC",
    });
    expect(repoFromRemoteUrl("https://github.com/petralabx/PLX_MC.git")?.name).toBe("PLX_MC");
    expect(repoFromRemoteUrl("git@github.com:acme/widget.git")?.slug).toBe("acme/widget");
    expect(repoFromRemoteUrl("ssh://git@github.com/acme/widget.git/")?.slug).toBe("acme/widget");
    expect(repoFromRemoteUrl("")).toBeNull();
    expect(repoFromRemoteUrl("not a remote")).toBeNull();
  });

  it("accepts only a JSON object as the hook payload", () => {
    expect(parseHookPayload("")).toBeNull();
    expect(parseHookPayload("not json{")).toBeNull();
    expect(parseHookPayload("[1]")).toBeNull();
    expect(parseHookPayload('{"session_id":"x"}')).toEqual({ session_id: "x" });
  });
});
