import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildPlan, commitSha, computePending, pendingHash, preflightApply, parseExpectedIdentity, parseSchemaObjects, readLiveDb, readLiveSharepoint, redactedTarget, runCommand } from "../scripts/db-migrate-live.mjs";

const sha = "a".repeat(40);
const schema = {
  site: { hostname: "example.sharepoint.com", paths: { staging: "/sites/dev", production: "/sites/prod" } },
  lists: [{ displayName: "ToDos", columns: [{ name: "Title", displayName: "Title" }, { name: "CompletedAt", displayName: "Completed at" }] }],
};
const localFiles = ["002_fixture.sql", "001_fixture.sql"];
const full = { "/sites/dev": { ToDos: ["Title", "CompletedAt"] }, "/sites/prod": { ToDos: ["Title", "CompletedAt"] } };
const env = {
  NODE_ENV: "test" as const,
  MC_LIVE_DATABASE_URL: "postgres://sensitiveuser:sensitivepassword@production.example.invalid:5432/plx_mc?sslmode=require",
  MC_LIVE_EXPECTED_IDENTITY: "plx_mc@production.example.invalid",
  MICROSOFT_GRAPH_TENANT_ID: "mock-tenant", MICROSOFT_GRAPH_CLIENT_ID: "mock-client", MICROSOFT_GRAPH_CLIENT_SECRET: "mock-secret",
};
function pending(ledgerFiles: string[] | null = localFiles, liveColumnsBySite: Record<string, Record<string, string[]>> = full) {
  return computePending({ localFiles, ledgerFiles, schema, liveColumnsBySite });
}
function db({ ledger = true, applied = localFiles, live = "plx_mc", fail = "", sysid = "12345", present = true } = {}) {
  const queries: string[] = [];
  let connects = 0;
  let ends = 0;
  let config: Record<string, unknown> = {};
  class ClientClass {
    constructor(options: Record<string, unknown>) { config = options; }
    async connect() { connects++; if (fail === "connect") throw new Error("secret connection details"); }
    async end() { ends++; }
    async query(sql: string, params?: unknown[]) {
      queries.push(sql);
      if (fail === sql) throw new Error("secret SQL details");
      if (sql.startsWith("SELECT current_database")) return { rows: [{ db: live }] };
      if (sql.includes("pg_control_system")) return { rows: [{ sysid }] };
      if (sql.startsWith("SELECT 1 FROM information_schema.columns")) return { rows: present ? [{}] : [] };
      if (params && sql.startsWith("SELECT to_regclass")) return { rows: [{ object: present ? "object" : null }] };
      if (sql.startsWith("SELECT to_regclass")) return { rows: [{ ledger: ledger ? "schema_migrations" : null }] };
      if (sql === "SELECT filename FROM schema_migrations") return { rows: applied.map(filename => ({ filename })) };
      return { rows: [] };
    }
  }
  return { ClientClass, queries, get connects() { return connects; }, get ends() { return ends; }, get config() { return config; } };
}
function graph({ columns = ["Title", "CompletedAt"], status = 200, missingList = false, pagination = false, evilLink = false } = {}) {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl: typeof fetch = async (input, options) => {
    const url = String(input);
    const method = options?.method ?? "GET";
    calls.push({ url, method });
    let data: Record<string, unknown> = {};
    if (url.startsWith("https://login.microsoftonline.com")) data = { access_token: "never-print-token" };
    else if (url.includes("/columns")) data = { value: columns.map(name => ({ name, displayName: name })) };
    else if (url.includes("/lists")) data = { value: missingList ? [] : [{ id: "list-id", displayName: "ToDos" }] };
    else data = { id: "site-id" };
    if (pagination && url.includes("/columns?") && !url.includes("skiptoken")) data = { value: [], "@odata.nextLink": evilLink ? "https://evil.invalid/v1.0/token" : `${url}&skiptoken=page2` };
    return new Response(JSON.stringify(data), { status });
  };
  return { fetchImpl, calls };
}
function options(extra = {}) { return { env, schema, localFiles, ClientClass: db().ClientClass, fetchImpl: graph().fetchImpl, gitHead: () => sha, readMigration: () => "SELECT 1;", ...extra }; }

describe("computePending", () => {
  it("equal DB and files produce no pending work", () => { expect(pending()).toEqual({ migrations: [], ledgerOrphans: [], sharepoint: {} }); });
  it("DB behind produces exactly sorted pending files", () => { expect(pending([]).migrations).toEqual([...localFiles].sort()); });
  it("extra ledger entry is an orphan and never pending", () => { expect(pending([...localFiles, "999_orphan.sql"])).toMatchObject({ migrations: [], ledgerOrphans: ["999_orphan.sql"] }); });
  it("missing ledger table makes every file pending", () => { expect(pending(null).migrations).toEqual([...localFiles].sort()); });
  it("column missing on one site only retains schema order", () => {
    expect(pending(localFiles, { ...full, "/sites/dev": { ToDos: [] } }).sharepoint).toEqual({ "/sites/dev": { ToDos: ["Title", "CompletedAt"] } });
  });
  it("missing list includes all configured columns and is identified in output", async () => {
    expect(pending(localFiles, { ...full, "/sites/dev": {} }).sharepoint).toEqual({ "/sites/dev": { ToDos: ["Title", "CompletedAt"] } });
    const plan = await buildPlan(options({ fetchImpl: graph({ missingList: true }).fetchImpl }));
    expect(plan.output).toContain("ToDos (list missing): Title, CompletedAt");
  });
  it("recognizes column display names like provisioning", () => { expect(pending(localFiles, { ...full, "/sites/dev": { ToDos: ["Title", "Completed at"] } }).sharepoint).toEqual({}); });
});

describe("pending hash", () => {
  it("is stable for input, key and pending item ordering", () => {
    const a = { migrations: localFiles, ledgerOrphans: ["z", "a"], sharepoint: { z: { B: ["z", "a"], A: ["y", "x"] }, a: {} } };
    const b = { migrations: [...localFiles].reverse(), ledgerOrphans: ["a", "z"], sharepoint: { a: {}, z: { A: ["x", "y"], B: ["a", "z"] } } };
    expect(pendingHash(a)).toBe(pendingHash(b));
  });
  it.each(["migrations", "ledgerOrphans", "sharepoint"])("changes when %s changes", key => {
    const p = pending();
    const changed = { ...p, [key]: key === "sharepoint" ? { "/sites/dev": { ToDos: ["CompletedAt"] } } : ["new.sql"] };
    expect(pendingHash(p)).not.toBe(pendingHash(changed));
  });
  it("unavailable never equals none missing for either source", () => {
    expect(pendingHash(pending(), { db: "unavailable" })).not.toBe(pendingHash(pending()));
    expect(pendingHash(pending(), { sharepoint: "unavailable" })).not.toBe(pendingHash(pending()));
  });
  it("missing list state changes hash even with identical missing columns", () => { expect(pendingHash(pending(), { missingLists: { "/sites/dev": ["ToDos"] } })).not.toBe(pendingHash(pending())); });
});

describe("live DB read (mock only)", () => {
  it("issues only allowed statements in READ ONLY and ends with ROLLBACK", async () => {
    const h = db();
    await readLiveDb({ env, ClientClass: h.ClientClass });
    expect(h.queries).toEqual(["BEGIN READ ONLY", "SET LOCAL statement_timeout = '5s'", "SELECT current_database() AS db", "SAVEPOINT sysid", "SELECT system_identifier::text AS sysid FROM pg_control_system()", "SELECT to_regclass('schema_migrations') AS ledger", "SELECT filename FROM schema_migrations", "ROLLBACK"]);
    expect(h.queries.join(" ")).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/);
    expect(h.config).toMatchObject({ host: "production.example.invalid", database: "plx_mc", ssl: { rejectUnauthorized: true } });
    expect(h.ends).toBe(1);
  });
  it("missing ledger does not query filenames or create a table", async () => {
    const h = db({ ledger: false });
    expect(await readLiveDb({ env, ClientClass: h.ClientClass })).toMatchObject({ ledgerFiles: null, identity: { verdict: "MATCH" } });
    expect(h.queries.at(-1)).toBe("ROLLBACK");
    expect(h.queries).not.toContain("SELECT filename FROM schema_migrations");
    const p = await buildPlan(options({ ClientClass: h.ClientClass }));
    expect(p.output).toContain("table missing; every local migration is pending");
  });
  it("query error rolls back and closes", async () => {
    const h = db({ fail: "SELECT filename FROM schema_migrations" });
    await expect(readLiveDb({ env, ClientClass: h.ClientClass })).rejects.toThrow();
    expect(h.queries.at(-1)).toBe("ROLLBACK"); expect(h.ends).toBe(1);
  });
  it("current_database mismatch rolls back and refuses", async () => {
    const h = db({ live: "wrong" });
    expect(await readLiveDb({ env, ClientClass: h.ClientClass })).toMatchObject({ identity: { verdict: "MISMATCH", reason: expect.stringContaining("current_database") } });
    expect(h.queries.at(-1)).toBe("ROLLBACK"); expect(h.queries).not.toContain("SELECT filename FROM schema_migrations");
  });
});

describe("Graph read (mock only)", () => {
  it("uses GET only on Graph and token POST only on login host, including pagination", async () => {
    const g = graph({ pagination: true });
    expect(await readLiveSharepoint({ env, schema, fetchImpl: g.fetchImpl })).toEqual(full);
    expect(g.calls[0]).toMatchObject({ method: "POST" });
    expect(new URL(g.calls[0].url).hostname).toBe("login.microsoftonline.com");
    for (const call of g.calls.slice(1)) { expect(call.method).toBe("GET"); expect(new URL(call.url).hostname).toBe("graph.microsoft.com"); }
    expect(g.calls.some(c => c.url.includes("example.sharepoint.com:/sites/dev"))).toBe(true);
  });
  it("refuses foreign pagination before sending a token", async () => {
    const g = graph({ pagination: true, evilLink: true });
    await expect(readLiveSharepoint({ env, schema, fetchImpl: g.fetchImpl })).rejects.toThrow(/unexpected host/);
    expect(g.calls.some(c => c.url.includes("evil.invalid"))).toBe(false);
  });
  it("errors print only method path and status, never token or response body", async () => {
    const p = await buildPlan(options({ fetchImpl: graph({ status: 403 }).fetchImpl }));
    expect(p.exitCode).toBe(1); expect(p.ready).toBe(false);
    expect(p.output).toContain("POST /mock-tenant/oauth2/v2.0/token status=403");
    expect(p.output).not.toMatch(/never-print-token|mock-secret|access_token/);
  });
});

describe("SHA-pinned preflight apply", () => {
  it("passes only when all inputs, identities and freshly read hash match", async () => {
    const p = await buildPlan(options());
    await expect(preflightApply(options({ env: { ...env, PLAN_SHA: sha, PENDING_HASH: p.hash } }))).resolves.toMatchObject({ ready: true, hash: p.hash });
  });
  it.each([
    ["SHA mismatch", { PLAN_SHA: "b".repeat(40) }, /plan_sha mismatch/],
    ["malformed SHA", { PLAN_SHA: "abc" }, /plan_sha malformed/],
    ["hash mismatch", { PENDING_HASH: `sha256:${"b".repeat(64)}` }, /pending_hash mismatch/],
    ["malformed hash", { PENDING_HASH: "oops" }, /pending_hash malformed/],
    ["Graph secrets unset", { MICROSOFT_GRAPH_CLIENT_SECRET: "" }, /SharePoint: NOT READ/],
    ["DB secret unset", { MC_LIVE_DATABASE_URL: "" }, /DB: NOT READ/],
    ["DB variable unset", { MC_LIVE_EXPECTED_IDENTITY: "" }, /identity UNSET/],
    ["identity mismatch", { MC_LIVE_EXPECTED_IDENTITY: "other@other.invalid" }, /identity MISMATCH/],
    ["URL identity mismatch", { MC_LIVE_DATABASE_URL: "postgres://u:p@other.invalid/plx_mc" }, /identity MISMATCH/],
  ])("refuses %s", async (_name, overrides, error) => {
    const p = await buildPlan(options());
    await expect(preflightApply(options({ env: { ...env, PLAN_SHA: sha, PENDING_HASH: p.hash, ...overrides } }))).rejects.toThrow(error);
  });
  it("refuses connected identity mismatch and configured source read errors", async () => {
    const p = await buildPlan(options());
    const inputs = { ...env, PLAN_SHA: sha, PENDING_HASH: p.hash };
    await expect(preflightApply(options({ env: inputs, ClientClass: db({ live: "other" }).ClientClass }))).rejects.toThrow(/current_database/);
    await expect(preflightApply(options({ env: inputs, ClientClass: db({ fail: "SELECT filename FROM schema_migrations" }).ClientClass }))).rejects.toThrow(/DatabaseReadError/);
    await expect(preflightApply(options({ env: inputs, fetchImpl: graph({ status: 403 }).fetchImpl }))).rejects.toThrow(/GraphReadError/);
  });
  it("cross-checks GITHUB_SHA with HEAD before reads", () => {
    expect(() => commitSha({ env: { NODE_ENV: "test", GITHUB_SHA: "b".repeat(40) }, gitHead: () => sha })).toThrow(/commit SHA mismatch/);
  });
  it("SHA refusal occurs before either source is read", async () => {
    const h = db(); const g = graph();
    await expect(preflightApply(options({ ClientClass: h.ClientClass, fetchImpl: g.fetchImpl, env: { ...env, PLAN_SHA: "b".repeat(40), PENDING_HASH: `sha256:${"0".repeat(64)}` } }))).rejects.toThrow(/mismatch/);
    expect(h.connects).toBe(0); expect(g.calls).toHaveLength(0);
  });
});

describe("plan and post-apply safety", () => {
  it("missing credentials exits zero with apply_ready=no and no applied items", async () => {
    const logs: string[] = [];
    expect(await runCommand(options({ env: {}, log: (s: string) => logs.push(s) }))).toBe(0);
    expect(logs[0]).toContain("apply_ready=no"); expect(logs[0]).toContain("DB: NOT READ"); expect(logs[0]).toContain("SharePoint: NOT READ");
    expect(logs[0]).not.toContain("001_fixture.sql");
  });
  it("prints only pending work and no userinfo password port or query", async () => {
    const p = await buildPlan(options({ ClientClass: db({ applied: ["001_fixture.sql"] }).ClientClass }));
    expect(p.output).toContain("- 002_fixture.sql"); expect(p.output).toContain("newest ledgered: 001_fixture.sql");
    expect(p.output).toContain("target: host=production.example.invalid database=plx_mc");
    expect(p.output).not.toMatch(/sensitiveuser|sensitivepassword|5432|sslmode|postgres:\/\//);
    expect(redactedTarget("not a URL sensitivepassword")).not.toContain("sensitivepassword");
  });
  it("invalid identity format exits zero, reads actual identity only and hides raw input", async () => {
    const h = db(); const p = await buildPlan(options({ ClientClass: h.ClientClass, env: { ...env, MC_LIVE_EXPECTED_IDENTITY: "secret malformed spec" } }));
    expect(p.exitCode).toBe(0); expect(p.ready).toBe(false); expect(h.connects).toBe(1); expect(h.queries).not.toContain("SELECT filename FROM schema_migrations"); expect(p.output).toContain("IDENTITY: INVALID FORMAT"); expect(p.output).not.toContain("secret malformed spec");
  });
  it("connected identity refusal exits zero and keeps apply_ready=no", async () => {
    const p = await buildPlan(options({ ClientClass: db({ live: "other" }).ClientClass }));
    expect(p.exitCode).toBe(0); expect(p.ready).toBe(false); expect(p.output).toContain("current_database()");
  });
  it("stdout and step summary contain the same pending-only plan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mc-live-summary-"));
    try {
      const logs: string[] = [];
      const summary = join(dir, "summary.md");
      expect(await runCommand(options({ env: { ...env, GITHUB_STEP_SUMMARY: summary }, log: (s: string) => logs.push(s) }))).toBe(0);
      expect(readFileSync(summary, "utf8")).toBe(`${logs[0]}\n`);
      expect(logs[0]).toContain("======== IDENTITY: MATCH ========");
      expect(logs[0].split("\n").slice(0, 3)).toEqual([`plan_commit_sha=${sha}`, expect.stringMatching(/^pending_hash=sha256:[a-f0-9]{64}$/), "apply_ready=yes"]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("configured DB read failure exits one with sanitized error class and keeps SharePoint output", async () => {
    const p = await buildPlan(options({ ClientClass: db({ fail: "connect" }).ClientClass, fetchImpl: graph({ columns: ["Title"] }).fetchImpl }));
    expect(p.exitCode).toBe(1); expect(p.output).toContain("DatabaseReadError"); expect(p.output).not.toContain("secret connection details"); expect(p.output).toContain("ToDos: CompletedAt");
  });
  it("post-apply passes empty pending and refuses remaining or unreadable items", async () => {
    expect(await runCommand(options({ command: "post-apply", log: () => {} }))).toBe(0);
    expect(await runCommand(options({ command: "post-apply", ClientClass: db({ applied: [...localFiles, "999_orphan.sql"] }).ClientClass, log: () => {} }))).toBe(0);
    expect(await runCommand(options({ command: "post-apply", ClientClass: db({ applied: [] }).ClientClass, log: () => {} }))).toBe(1);
    expect(await runCommand(options({ command: "post-apply", fetchImpl: graph({ columns: [] }).fetchImpl, log: () => {} }))).toBe(1);
    expect(await runCommand(options({ command: "post-apply", env: {}, log: () => {} }))).toBe(1);
  });
});

describe("live release workflow default safety", () => {
  const parsed = spawnSync("python3", ["-c", "import yaml,json; d=yaml.safe_load(open('.github/workflows/db-migrate-live.yml')); d['on']=d.pop(True); print(json.dumps(d))"], { encoding: "utf8" });
  const wf = JSON.parse(parsed.stdout || "{}");
  it("default dispatch is plan with SHA and hash string inputs, read permissions and concurrency", () => {
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.on.workflow_dispatch.inputs.mode).toMatchObject({ default: "plan", type: "choice", options: ["plan", "apply"] });
    for (const key of ["confirm", "plan_sha", "pending_hash"]) expect(wf.on.workflow_dispatch.inputs[key]).toMatchObject({ type: "string", default: "" });
    expect(wf.permissions).toEqual({ contents: "read" }); expect(wf.concurrency.group).toBe("db-migrate-plx-mc");
  });
  it("plan has no environment or writes and reads both sources on any ref", () => {
    expect(wf.jobs.plan).not.toHaveProperty("environment"); expect(wf.jobs.plan.if).not.toContain("refs/heads/main");
    expect(wf.jobs.plan.if).toContain("!(inputs.mode == 'apply' && inputs.confirm == 'MIGRATE_LIVE')");
    const runs = wf.jobs.plan.steps.map((s: { run?: string }) => s.run ?? "").join("\n");
    expect(runs).toContain("npm ci"); expect(runs).toContain("db-migrate-live.mjs plan"); expect(runs).not.toMatch(/npm run migrate|--apply|preflight-apply/);
    expect(JSON.stringify(wf.jobs.plan)).toContain("MICROSOFT_GRAPH_CLIENT_SECRET");
  });
  it("apply is gated, exact-SHA checked out, inputs in env and ordered before writes", () => {
    const job = wf.jobs.apply;
    expect(job.environment).toBe("mc-live-release"); expect(job.if).toBe("inputs.mode == 'apply' && inputs.confirm == 'MIGRATE_LIVE'");
    expect(job.steps[0].with.ref).toBe("${{ github.sha }}");
    const runs = job.steps.map((s: { run?: string }) => s.run ?? "");
    const idx = (s: string) => runs.findIndex((r: string) => r.includes(s));
    expect(idx("preflight-apply")).toBeGreaterThan(-1);
    expect(idx("preflight-apply")).toBeLessThan(idx("npm run migrate"));
    expect(idx("npm run migrate")).toBeLessThan(idx("--env staging --apply"));
    expect(idx("--env staging --apply")).toBeLessThan(idx("--env production --apply"));
    expect(idx("--env production --apply")).toBeLessThan(idx("post-apply"));
    expect(job.steps[idx("preflight-apply")].env).toMatchObject({ PLAN_SHA: "${{ inputs.plan_sha }}", PENDING_HASH: "${{ inputs.pending_hash }}" });
    const liveSteps = [...wf.jobs.plan.steps, ...job.steps].filter((s: { env?: Record<string, string> }) => s.env?.MC_LIVE_DATABASE_URL);
    expect(liveSteps).toHaveLength(3);
    for (const step of liveSteps) expect(step.env.MC_LIVE_EXPECTED_IDENTITY).toBe("${{ vars.MC_LIVE_EXPECTED_IDENTITY }}");
    expect(JSON.stringify(wf)).not.toContain("MC_LIVE_APPROVED_DB");
    expect(runs.join("\n")).not.toContain("${{ inputs.");
    expect(readFileSync(".github/workflows/db-migrate.yml", "utf8")).not.toContain("MC_LIVE_");
  });
});

describe("production expected identity", () => {
  it.each(["plx_mc@production.example.invalid", "plx_mc@production.example.invalid#sysid=12345"])("MATCH for %s without requiring the old variable", async value => {
    const p = await buildPlan(options({ env: { ...env, MC_LIVE_EXPECTED_IDENTITY: value } }));
    expect(p.ready).toBe(true); expect(p.identity.verdict).toBe("MATCH");
    expect(p.output).toContain(`expected: ${value}   actual: plx_mc@production.example.invalid sysid=12345`);
  });
  it.each([
    ["URL host", { MC_LIVE_EXPECTED_IDENTITY: "plx_mc@other.invalid" }, {}, "URL host/database", false],
    ["URL database", { MC_LIVE_EXPECTED_IDENTITY: "other@production.example.invalid" }, {}, "URL host/database", false],
    ["current_database", {}, { live: "other" }, "current_database()", true],
    ["sysid", { MC_LIVE_EXPECTED_IDENTITY: "plx_mc@production.example.invalid#sysid=999" }, {}, "sysid differs", true],
    ["sysid expected but unavailable", { MC_LIVE_EXPECTED_IDENTITY: "plx_mc@production.example.invalid#sysid=12345" }, { fail: "SELECT system_identifier::text AS sysid FROM pg_control_system()" }, "sysid expected but unavailable", true],
  ] as const)("MISMATCH on %s refuses reads and cannot collide with MATCH hash", async (_name, overrides, fixture, reason, connects) => {
    const h = db(fixture); const p = await buildPlan(options({ env: { ...env, ...overrides }, ClientClass: h.ClientClass }));
    expect(p.identity.verdict).toBe("MISMATCH"); expect(p.ready).toBe(false); expect(p.exitCode).toBe(0);
    expect(p.output).toContain(reason); expect(p.output).toContain("skipped (identity not MATCH)");
    expect(h.connects).toBe(Number(connects)); expect(h.queries).not.toContain("SELECT filename FROM schema_migrations");
    expect(h.queries.some(q => q.includes("to_regclass") || q.includes("information_schema"))).toBe(false);
    if ("fail" in fixture) expect(h.queries).toContain("ROLLBACK TO SAVEPOINT sysid");
    const match = await buildPlan(options()); expect(p.hash).not.toBe(match.hash);
    await expect(preflightApply(options({ env: { ...env, ...overrides, PLAN_SHA: sha, PENDING_HASH: match.hash }, ClientClass: h.ClientClass }))).rejects.toThrow("preflight-apply refused: identity MISMATCH");
    expect(h.queries.every(q => /^(BEGIN READ ONLY|SET LOCAL|SELECT|SAVEPOINT sysid|ROLLBACK)/.test(q))).toBe(true);
  });
  it("UNSET plan exits zero, prints actual and suggested identity, never queries ledger and refuses pinned preflight", async () => {
    const h = db(); const unset = { ...env, MC_LIVE_EXPECTED_IDENTITY: "" };
    const p = await buildPlan(options({ env: unset, ClientClass: h.ClientClass }));
    expect(p.exitCode).toBe(0); expect(p.ready).toBe(false); expect(p.output).toContain("IDENTITY: UNSET");
    expect(p.output).toContain("actual: plx_mc@production.example.invalid sysid=12345");
    expect(p.output).toContain("suggested MC_LIVE_EXPECTED_IDENTITY=plx_mc@production.example.invalid#sysid=12345 (a human must confirm");
    expect(h.queries).not.toContain("SELECT filename FROM schema_migrations");
    expect(h.queries.some(q => q.includes("to_regclass"))).toBe(false);
    await expect(preflightApply(options({ env: { ...unset, PLAN_SHA: sha, PENDING_HASH: p.hash }, ClientClass: h.ClientClass }))).rejects.toThrow("preflight-apply refused: identity UNSET");
    expect(h.queries.join(" ")).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/);
  });
  it.each(["x", "db@HOST.invalid", "db@host#sysid=", "db@host#sysid=abc", "db@host#sysid=123456789012345678901", "db@host#sysid=1#sysid=2", " db@host "])("INVALID FORMAT strictly rejects %s without echo", async raw => {
    expect(() => parseExpectedIdentity(raw)).toThrow();
    const p = await buildPlan(options({ env: { ...env, MC_LIVE_EXPECTED_IDENTITY: raw } }));
    expect(p.identity.verdict).toBe("INVALID FORMAT"); expect(p.exitCode).toBe(0); expect(p.ready).toBe(false);
    expect(p.output).toContain(`invalid (length=${raw.length})`);
    expect(p.identity.expected).toBeUndefined();
  });
  it("fingerprint permission error without expected sysid rolls back savepoint and still matches", async () => {
    const h = db({ fail: "SELECT system_identifier::text AS sysid FROM pg_control_system()" });
    const p = await buildPlan(options({ ClientClass: h.ClientClass }));
    expect(p.exitCode).toBe(0); expect(p.ready).toBe(true); expect(p.output).toContain("sysid=unavailable");
    expect(h.queries).toContain("ROLLBACK TO SAVEPOINT sysid"); expect(h.queries).toContain("SELECT filename FROM schema_migrations");
  });
  it("old MC_LIVE_APPROVED_DB value is ignored with exactly one note", async () => {
    const p = await buildPlan(options({ env: { ...env, MC_LIVE_APPROVED_DB: "wrong@wrong.invalid" } }));
    expect(p.ready).toBe(true);
    expect(p.output.split("\n").filter(l => l.startsWith("note: MC_LIVE_APPROVED_DB"))).toEqual(["note: MC_LIVE_APPROVED_DB is no longer read by the live release (replaced by MC_LIVE_EXPECTED_IDENTITY); an admin may delete it"]);
    const unset = await buildPlan(options({ env: { ...env, MC_LIVE_EXPECTED_IDENTITY: "", MC_LIVE_APPROVED_DB: env.MC_LIVE_EXPECTED_IDENTITY } }));
    expect(unset.identity.verdict).toBe("UNSET"); expect(unset.ready).toBe(false);
  });
  it.each(["postgres://u:p@production.example.invalid/plx_mc?host=evil", "not a URL password"])("malformed/override URL refuses sanitized before connection: %s", async url => {
    const h = db(); const p = await buildPlan(options({ env: { ...env, MC_LIVE_DATABASE_URL: url }, ClientClass: h.ClientClass }));
    expect(h.connects).toBe(0); expect(p.ready).toBe(false); expect(p.exitCode).toBe(0); expect(p.output).toContain("invalid URL or target overrides refused"); expect(p.output).not.toContain(url);
  });
  it.each(["verify", "post-apply"])("%s requires MATCH and prints refusal verdict", async command => {
    const logs: string[] = [];
    expect(await runCommand(options({ command, ClientClass: db({ live: "wrong" }).ClientClass, log: (s: string) => logs.push(s) }))).toBe(1);
    expect(logs.join("\n")).toContain("IDENTITY: MISMATCH");
    expect(await runCommand(options({ command, env: { ...env, MC_LIVE_EXPECTED_IDENTITY: "" }, log: () => {} }))).toBe(1);
    expect(await runCommand(options({ command, log: () => {} }))).toBe(0);
  });
});

describe("read-only schema sanity", () => {
  const sql = `-- CREATE TABLE ghost (id int);
    /* ALTER TABLE ghost ADD COLUMN phantom int; */
    CREATE TABLE IF NOT EXISTS "Some Schema"."My Table" (id int);
    ALTER TABLE IF EXISTS ONLY "Some Schema"."My Table" ADD COLUMN IF NOT EXISTS "First" int, ADD COLUMN second text;
    CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Some Schema"."My Index" ON "Some Schema"."My Table" (id);
    CREATE OR REPLACE VIEW public.my_view AS SELECT 1;
    CREATE OR REPLACE FUNCTION public.my_function() RETURNS int AS 'SELECT 1' LANGUAGE sql;`;
  it("parses tables, multiple ADD COLUMN, indexes, views/functions, quotes and schemas; strips comments", () => {
    const objects = parseSchemaObjects(sql);
    expect(objects.map((o: { kind: string; label: string }) => `${o.kind} ${o.label}`)).toEqual([
      "table Some Schema.My Table", "index Some Schema.My Index", "view public.my_view", "function public.my_function", "column Some Schema.My Table.First", "column Some Schema.My Table.second",
    ]);
    expect(objects[0].regname).toBe('"Some Schema"."My Table"');
    expect(parseSchemaObjects('CREATE TABLE plain (id int); ALTER TABLE plain ADD COLUMN x int, ADD COLUMN y int; CREATE INDEX idx ON plain(x);')).toHaveLength(4);
  });
  it("caps checkable objects at 50", () => { expect(parseSchemaObjects(Array.from({ length: 60 }, (_, i) => `CREATE TABLE t${i} (id int);`).join("\n"))).toHaveLength(50); });
  it.each([true, false])("reports OK or prominent WARNING when objects present=%s without changing readiness/hash", async present => {
    const h = db({ present, applied: [...localFiles, "999_orphan.sql"] });
    const params: unknown[][] = [];
    class Client extends h.ClientClass {
      async query(q: string, values?: unknown[]) { if (values) params.push(values); return super.query(q, values); }
    }
    const p = await buildPlan(options({ ClientClass: Client, readMigration: () => sql }));
    expect(p.output).toContain("### Schema sanity (newest ledgered: 002_fixture.sql)");
    expect(p.output).toContain("note: newer ledger entry 999_orphan.sql has no local file");
    expect(p.output).toContain(`- ${present ? "OK" : "MISSING"} table Some Schema.My Table`);
    expect(p.output).toContain(`- ${present ? "OK" : "MISSING"} column Some Schema.My Table.First`);
    expect(p.output).toContain("skipped function public.my_function");
    if (!present) expect(p.output).toContain("WARNING: ledger says 002_fixture.sql is applied but 5 key object(s) are missing; ledger and schema disagree");
    else expect(p.output).not.toContain("WARNING:");
    expect(p.ready).toBe(true);
    const baseline = await buildPlan(options({ ClientClass: db({ applied: [...localFiles, "999_orphan.sql"] }).ClientClass }));
    expect(p.hash).toBe(baseline.hash);
    expect(params).toContainEqual(["My Table", "First", "Some Schema"]);
    expect(params).toContainEqual(['"Some Schema"."My Table"']);
    expect(h.queries.every(q => /^(BEGIN READ ONLY|SET LOCAL statement_timeout|SELECT |SAVEPOINT sysid|ROLLBACK)/.test(q))).toBe(true);
    expect(h.queries.join(" ")).not.toMatch(/INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
  });
  it("unqualified columns use current_schemas and parameterized table/column", async () => {
    const h = db();
    const p = await buildPlan(options({ ClientClass: h.ClientClass, readMigration: () => "ALTER TABLE foo ADD COLUMN bar int;" }));
    expect(p.output).toContain("- OK column foo.bar");
    expect(h.queries).toContain("SELECT 1 FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = $1 AND column_name = $2");
  });
  it("reports no checkable objects for a data-only migration", async () => {
    const p = await buildPlan(options());
    expect(p.output).toContain("no checkable objects found in 002_fixture.sql");
  });
});
