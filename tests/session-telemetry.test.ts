// Session-end token telemetry (TASK-4273) — contract tests for scripts/session-telemetry.mjs.
// Repos are throwaway git repos under os.tmpdir(); fetch is a recorder, so nothing
// touches tracked paths or the network.
import { afterAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts");
const { payloadTokens, reportTelemetry, sumTranscriptUsage } = await import(
  pathToFileURL(path.join(scriptsDir, "session-telemetry.mjs")).href
);

const KEY = "mc-test-key-SHOULD-NEVER-PRINT";
const MC_ENV = { MC_BASE_URL: "http://mc.test/", MC_MCP_API_KEY: KEY, MC_OPERATOR_EMAIL: "Agent@Example.com" };
const SESSION_START = "2026-09-25T10:00:00.000Z";
const quiet = () => {};

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "telemetry-test-"));
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

/**
 * main on origin, then feat/widget. Before the session: a commit stamped dsp_before.
 * In the session: one commit stamped dsp_old1 + dsp_mid2, then a newer one stamped dsp_new3,
 * then one with no trailer.
 */
function stampedRepo(withBase = true): string {
  const dir = tempDir();
  const git = gitIn(dir);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "agent@example.com"]);
  git(["config", "user.name", "Agent"]);
  git(["remote", "add", "origin", "git@github.com:acme/widget.git"]);
  writeFileSync(path.join(dir, "README.md"), "base\n");
  git(["add", "."]);
  git(["commit", "-qm", "chore: base"], "2026-09-01T00:00:00Z");
  if (withBase) git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(["switch", "-q", "-c", "feat/widget"]);
  const commit = (n: number, msg: string, at: string) => {
    writeFileSync(path.join(dir, `f${n}.txt`), `${n}\n`);
    git(["add", "."]);
    git(["commit", "-qm", msg], at);
  };
  commit(1, "feat: earlier session\n\nMC-Checkout: dsp_before", "2026-09-24T09:00:00Z");
  commit(2, "feat: one\n\nAgent: claude-code/x\nMC-Checkout: dsp_old1\nMC-Checkout: dsp_mid2", "2026-09-25T10:10:00Z");
  commit(3, "feat: two\n\nMC-Checkout: dsp_new3", "2026-09-25T10:20:00Z");
  commit(4, "docs: no trailer", "2026-09-25T10:30:00Z");
  return dir;
}

function assistant(id: string, usage: Record<string, unknown>, model = "claude-test-1") {
  return JSON.stringify({ type: "assistant", requestId: `req-${id}`, message: { id, model, usage } });
}

const M1 = { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 };

/** m1's usage repeats on two lines that are not adjacent, as a message's content blocks do. */
function usageTranscript(dir: string, name = "sess.jsonl"): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "user", timestamp: SESSION_START, message: { content: "hi", usage: { input_tokens: 999 } } }),
      assistant("m1", M1),
      assistant("m2", { input_tokens: 7, output_tokens: 20 }, "claude-other-2"),
      assistant("m1", M1),
      assistant("m3", { input_tokens: 0, output_tokens: 0 }, "<synthetic>"),
      assistant("m4", { input_tokens: 5, output_tokens: 5 }),
      '{"type":"assistant","message":{"usage":', // a truncated last line
    ].join("\n")
  );
  return file;
}

/** Subagent transcripts sit in <dir>/<session>/subagents/*.jsonl; a1 repeats m4 from the main file. */
function addSubagents(transcriptPath: string): void {
  const dir = path.join(path.dirname(transcriptPath), path.basename(transcriptPath, ".jsonl"), "subagents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "agent-a1.jsonl"),
    [assistant("s1", { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 30 }), assistant("m4", { input_tokens: 5, output_tokens: 5 })].join("\n")
  );
  writeFileSync(path.join(dir, "notes.txt"), assistant("ignored", { input_tokens: 1000, output_tokens: 1000 }));
}

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown>; redirect?: string };

function recorder(answer: { ok?: boolean; status?: number; json?: unknown } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
      ),
      body: JSON.parse(String(init?.body ?? "{}")),
      redirect: init?.redirect,
    });
    const json = "json" in answer ? answer.json : { data: { recorded: true, sessionId: "x" } };
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 201,
      json: async () => {
        if (json instanceof Error) throw json;
        return json;
      },
    } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function logSink() {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

describe("sumTranscriptUsage", () => {
  it("counts each message once across lines, names the most-used model and the session start", async () => {
    const u = await sumTranscriptUsage(usageTranscript(tempDir()));
    expect(u).toEqual({
      tokensIn: 3 + 100 + 1000 + 7 + 5,
      tokensOut: 50 + 20 + 5,
      model: "claude-test-1",
      messages: 4,
      startedAt: SESSION_START,
    });
  });

  it("adds subagent transcripts and counts a message seen in both files once", async () => {
    const file = usageTranscript(tempDir());
    addSubagents(file);
    const u = await sumTranscriptUsage(file);
    expect(u).toMatchObject({ tokensIn: 1115 + 100, tokensOut: 75 + 30, messages: 5 });
  });

  it("reports no sum for a missing, oversized, usage-free or too slow transcript", async () => {
    const dir = tempDir();
    const file = usageTranscript(dir);
    expect(await sumTranscriptUsage(path.join(dir, "missing.jsonl"))).toBeNull();
    expect(await sumTranscriptUsage(dir)).toBeNull();
    expect(await sumTranscriptUsage(file, { maxBytes: 10 })).toBeNull();
    expect(await sumTranscriptUsage(file, { deadlineMs: -1 })).toBeNull();
    const plain = path.join(dir, "plain.jsonl");
    writeFileSync(plain, JSON.stringify({ type: "user", message: { content: "hi" } }));
    expect(await sumTranscriptUsage(plain)).toBeNull();
    expect(await sumTranscriptUsage("")).toBeNull();
  });
});

describe("payloadTokens", () => {
  it("reads token counts only when the payload has them", () => {
    expect(payloadTokens({ session_id: "s", reason: "completed", duration_ms: 5 })).toBeNull();
    expect(payloadTokens({ input_tokens: 12, output_tokens: 3, cache_read_tokens: 99, model: "m" })).toEqual({
      tokensIn: 12,
      tokensOut: 3,
      model: "m",
    });
    expect(payloadTokens({ usage: { input_tokens: 4, cache_read_input_tokens: 6 } })).toEqual({
      tokensIn: 10,
      tokensOut: 0,
      model: null,
    });
    expect(payloadTokens(null)).toBeNull();
  });
});

describe("reportTelemetry", () => {
  it("posts one Claude Code row with the repo, the runtime and this session's newest checkout", async () => {
    const dir = stampedRepo();
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
    expect(calls[0].redirect).toBe("error");
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
      checkoutId: "dsp_new3",
    });
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("takes MC_CHECKOUT_ID and MC_REPO first, and sends no checkout it cannot tie to the session", async () => {
    const dir = stampedRepo();
    const payload = { session_id: "s", transcript_path: usageTranscript(dir) };
    const a = recorder();
    await reportTelemetry({
      env: { ...MC_ENV, MC_CHECKOUT_ID: "dsp_env9", MC_REPO: "petralabx/PLX_MC" },
      fetch: a.fetch,
      log: quiet,
      cwd: dir,
      runtime: "claude-code",
      payload,
    });
    expect(a.calls[0].body.checkoutId).toBe("dsp_env9");
    expect(a.calls[0].headers["x-mc-repo"]).toBe("petralabx/PLX_MC");

    // No base ref and no session start: every commit could be another session's.
    const bare = stampedRepo(false);
    const noStart = path.join(bare, "nostart.jsonl");
    writeFileSync(noStart, assistant("m9", { input_tokens: 1, output_tokens: 1 }));
    const b = recorder();
    await reportTelemetry({
      env: { ...MC_ENV, MC_CHECKOUT_ID: "pending" },
      fetch: b.fetch,
      log: quiet,
      cwd: bare,
      runtime: "claude-code",
      payload: { session_id: "s2", transcript_path: noStart },
    });
    expect(b.calls[0].body).not.toHaveProperty("checkoutId");
  });

  it("reports a Cursor session only when its payload carries token counts", async () => {
    const dir = stampedRepo();
    const none = recorder();
    const { log, lines } = logSink();
    const r = await reportTelemetry({
      env: MC_ENV,
      fetch: none.fetch,
      log,
      cwd: dir,
      payload: { conversation_id: "c-1", duration_ms: 9 },
    });
    expect(r).toEqual({ reported: false, reason: "the hook payload has no token counts" });
    expect(none.calls).toHaveLength(0);
    expect(lines).toEqual(["[session-telemetry] not reported: the hook payload has no token counts"]);
    const some = recorder();
    await reportTelemetry({
      env: MC_ENV,
      fetch: some.fetch,
      log: quiet,
      cwd: dir,
      payload: { conversation_id: "c-2", input_tokens: 9, output_tokens: 4 },
    });
    expect(some.calls[0].headers["x-mc-runtime"]).toBe("cursor");
    expect(some.calls[0].body).toMatchObject({ sessionId: "c-2", tokensIn: 9, tokensOut: 4 });
  });

  it("fails open and never prints the key", async () => {
    const dir = stampedRepo();
    const payload = { session_id: "s", transcript_path: usageTranscript(dir) };
    const throwing = (async () => {
      throw new TypeError(`fetch failed: redirect mode is set to error ${KEY}`);
    }) as unknown as typeof globalThis.fetch;
    const cases: Array<[Record<string, string>, typeof globalThis.fetch, string]> = [
      [{ ...MC_ENV, SESSION_TELEMETRY_ENABLED: "0" }, recorder().fetch, "disabled (SESSION_TELEMETRY_ENABLED=0)"],
      [{ ...MC_ENV, MC_MCP_API_KEY: "${MC_MCP_API_KEY}" }, recorder().fetch, "MC_BASE_URL, MC_MCP_API_KEY or MC_OPERATOR_EMAIL is not set"],
      [{ MC_BASE_URL: "http://mc.test", MC_MCP_API_KEY: KEY }, recorder().fetch, "MC_BASE_URL, MC_MCP_API_KEY or MC_OPERATOR_EMAIL is not set"],
      [MC_ENV, recorder({ ok: false, status: 500 }).fetch, "HTTP 500"],
      [MC_ENV, throwing, "request failed"],
      // A login page or proxy answering 200 is not a recorded row.
      [MC_ENV, recorder({ json: new SyntaxError("Unexpected token <") }).fetch, "Mission Control did not confirm the row"],
      [MC_ENV, recorder({ json: { data: { recorded: false } } }).fetch, "Mission Control did not confirm the row"],
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

  it("aborts a hung request inside its time budget", async () => {
    const dir = stampedRepo();
    const hung = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof globalThis.fetch;
    const started = Date.now();
    const r = await reportTelemetry({
      env: MC_ENV,
      fetch: hung,
      log: quiet,
      cwd: dir,
      runtime: "claude-code",
      budgetMs: 1500,
      payload: { session_id: "s", transcript_path: usageTranscript(dir) },
    });
    expect(r).toEqual({ reported: false, reason: "timed out" });
    expect(Date.now() - started).toBeLessThan(2500);
    const late = await reportTelemetry({
      env: MC_ENV,
      fetch: hung,
      log: quiet,
      cwd: dir,
      runtime: "cursor",
      budgetMs: 100,
      payload: { conversation_id: "c", input_tokens: 1 },
    });
    expect(late).toEqual({ reported: false, reason: "out of time" });
  });

  it("runs from the closeout CLI and exits 0 when Mission Control is unreachable", () => {
    const dir = stampedRepo();
    mkdirSync(path.join(dir, "scripts"));
    for (const f of ["compliance-closeout.mjs", "session-telemetry.mjs"]) {
      copyFileSync(path.join(scriptsDir, f), path.join(dir, "scripts", f));
    }
    const run = spawnSync(process.execPath, [path.join(dir, "scripts", "compliance-closeout.mjs"), "--runtime", "claude-code"], {
      cwd: dir,
      env: { ...process.env, VMC_API_KEY: "", ...MC_ENV, MC_BASE_URL: "http://127.0.0.1:9" },
      encoding: "utf8",
      input: JSON.stringify({ session_id: "cli-tel", transcript_path: usageTranscript(dir) }),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("[session-telemetry] not reported: request failed");
    expect(`${run.stdout}${run.stderr}`).not.toContain(KEY);
  });
});
