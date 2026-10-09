import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Client as PgClient } from "pg";
import { main } from "../scripts/migrate.mjs";
import { buildPlan, redactedTarget, verify } from "../scripts/db-migrate-live.mjs";
import { assertApprovedNonProdDb, checkUrlAgainstApproved, parseApprovedSpec } from "../scripts/lib/db-identity.mjs";

const scratch: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "mc-migrate-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const approved = { database: "mc_test", host: "uat.example.invalid" };
const url = "postgres://test:offline@uat.example.invalid/mc_test";
const testEnv = { NODE_ENV: "test" as const };

function harness({ ledger = true, applied = [] as string[], live = "mc_test", failSql = "" } = {}) {
  const queries: string[] = [];
  const inserts: string[] = [];
  let connects = 0;
  let ends = 0;
  let config: Record<string, unknown> = {};
  class Client {
    constructor(options: Record<string, unknown>) { config = options; }
    async connect() { connects++; }
    async end() { ends++; }
    async query(sql: string, params?: string[]) {
      queries.push(sql);
      if (sql.startsWith("SELECT current_database")) return { rows: [{ db: live, addr: "192.0.2.1" }] };
      if (sql.startsWith("SELECT to_regclass")) return { rows: [{ ledger: ledger ? "schema_migrations" : null }] };
      if (sql === "SELECT filename FROM schema_migrations") return { rows: applied.map(filename => ({ filename })) };
      if (sql.startsWith("INSERT INTO")) inserts.push(params![0]);
      if (failSql && sql === failSql) throw new Error("offline SQL failure");
      return { rows: [] };
    }
  }
  return { Client, queries, inserts, get connects() { return connects; }, get ends() { return ends; }, get config() { return config; } };
}

function migrationFiles(numbers = [31, 32, 33, 34, 35]) {
  const dir = temp();
  const names = numbers.map(n => `${String(n).padStart(3, "0")}_fixture.sql`);
  for (const name of names) writeFileSync(join(dir, name), `SELECT '${name}';`);
  return { dir, names };
}
async function run(h: ReturnType<typeof harness>, dir: string, mode = "deploy", extra = {}) {
  const logs: string[] = [];
  const code = await main({
    argv: ["--non-prod", "--approved-db", "mc_test@uat.example.invalid", "--mode", mode],
    env: { ...testEnv, PLX_MC_DATABASE_URL: url }, ClientClass: h.Client as unknown as typeof PgClient, migrationsDir: dir,
    log: (line: string) => logs.push(line), ...extra,
  });
  return { code, logs };
}

describe("approved non-production identity", () => {
  it.each(["uat", "staging"])("accepts explicitly approved %s identity and live database", async target => {
    const spec = parseApprovedSpec(`mc_test@${target}.example.invalid`);
    const client = new (harness().Client)({});
    await expect(assertApprovedNonProdDb(client, url.replace("uat.", `${target}.`), spec, testEnv)).resolves.toMatchObject(spec);
  });
  it("refuses the documented runtime identity even when approved before connecting", async () => {
    const h = harness();
    await expect(run(h, temp(), "deploy", {
      argv: ["--non-prod", "--approved-db", "plx_mc@plx-postgres-staging.example.invalid"],
      env: { PLX_MC_DATABASE_URL: "postgres://test:offline@plx-postgres-staging.example.invalid/plx_mc" },
    })).rejects.toThrow(/runtime database/);
    expect(h.connects).toBe(0);
    expect(h.queries).toEqual([]);
  });
  it("CLI exits 1 on explicit runtime refusal without a database connection", () => {
    const proc = spawnSync(process.execPath, ["scripts/migrate.mjs", "--non-prod", "--approved-db", "plx_mc@plx-postgres-staging.example.invalid"], {
      encoding: "utf8", env: { ...testEnv, PLX_MC_DATABASE_URL: "postgres://test:offline@plx-postgres-staging.example.invalid/plx_mc" },
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toContain("runtime database");
  });
  it.each(["host", "hostaddr", "port", "dbname", "database", "service", "options"])("refuses URL %s overrides", param => {
    expect(() => checkUrlAgainstApproved(`${url}?${param}=redirect`, approved, testEnv)).toThrow(/override/);
  });
  it.each(["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGSERVICE", "PGSERVICEFILE"])("refuses environment %s overrides", key => {
    expect(() => checkUrlAgainstApproved(url, approved, { ...testEnv, [key]: "redirect" })).toThrow(/override/);
  });
  it("refuses unapproved host/database and missing identity", () => {
    expect(() => checkUrlAgainstApproved(url, { ...approved, host: "other.invalid" }, testEnv)).toThrow(/not the approved/);
    expect(() => checkUrlAgainstApproved(url, { ...approved, database: "other" }, testEnv)).toThrow(/not the approved/);
    expect(() => parseApprovedSpec("")).toThrow(/required/);
  });
  it.each(["other", "plx_mc", ""])("refuses live mismatch %s before writes", async live => {
    const h = harness({ live });
    await expect(run(h, temp())).rejects.toThrow();
    expect(h.queries).toHaveLength(1);
    expect(h.ends).toBe(1);
  });
});

describe("numbered runner (offline pg client)", () => {
  it("applies 031–035 in order, with one transaction each and guard before DDL", async () => {
    const { dir, names } = migrationFiles([35, 31, 34, 33, 32]);
    const h = harness();
    const { code, logs } = await run(h, dir);
    expect(code).toBe(0);
    expect(h.inserts).toEqual([...names].sort());
    expect(h.queries[0]).toContain("current_database()");
    expect(h.config).toMatchObject({ host: approved.host, database: approved.database });
    expect(h.config).not.toHaveProperty("connectionString");
    expect(h.queries.filter(q => q === "BEGIN")).toHaveLength(5);
    expect(h.queries.filter(q => q === "COMMIT")).toHaveLength(5);
    expect(logs.filter(l => l.startsWith("apply "))).toHaveLength(5);
    expect(h.ends).toBe(1);
  });
  it("tolerates gaps as schema PRs land and skips applied files", async () => {
    const { dir } = migrationFiles([35, 31, 33]);
    const h = harness({ applied: ["031_fixture.sql"] });
    expect((await run(h, dir)).code).toBe(0);
    expect(h.inserts).toEqual(["033_fixture.sql", "035_fixture.sql"]);
  });
  it.each([true, false])("status-only reports every 031–035 without writes (ledger=%s)", async ledger => {
    const { dir, names } = migrationFiles();
    const h = harness({ ledger });
    const { code, logs } = await run(h, dir, "status-only");
    expect(code).toBe(0);
    expect(logs.filter(l => l.startsWith("pending "))).toEqual(names.map(n => `pending ${n}`));
    expect(h.queries.every(q => q.startsWith("SELECT "))).toBe(true);
    expect(h.inserts).toEqual([]);
  });
  it("rolls back failed SQL, returns exit 1 and stops before later files", async () => {
    const { dir } = migrationFiles([31, 33, 35]);
    const h = harness({ failSql: "SELECT '033_fixture.sql';" });
    const result = await run(h, dir);
    expect(result.code).toBe(1);
    expect(result.logs.filter(l => l.startsWith("pending "))).toEqual(["pending 033_fixture.sql", "pending 035_fixture.sql"]);
    expect(h.inserts).toEqual(["031_fixture.sql"]);
    expect(h.queries.at(-1)).toBe("ROLLBACK");
    expect(h.ends).toBe(1);
  });
  it("rejects duplicate prefixes and invalid modes without connecting", async () => {
    const { dir } = migrationFiles([31]);
    writeFileSync(join(dir, "031_duplicate.sql"), "SELECT 1;");
    const h = harness();
    expect((await run(h, dir)).code).toBe(1);
    await expect(run(h, dir, "unknown")).rejects.toThrow(/mode/);
    expect(h.connects).toBe(0);
  });
});

describe("Action contract and foreground shell orchestration", () => {
  it("parses workflow triggers, 031–035 filter, concurrency, modes and main-only dispatch", () => {
    const parsed = spawnSync("python3", ["-c", "import yaml,json; d=yaml.safe_load(open('.github/workflows/db-migrate.yml')); d['on']=d.pop(True); print(json.dumps(d))"], { encoding: "utf8" });
    expect(parsed.status, parsed.stderr).toBe(0);
    const workflow = JSON.parse(parsed.stdout);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toEqual(["db/migrations/**"]);
    // GitHub's directory glob includes all reserved files, even while absent.
    for (let n = 31; n <= 35; n++) {
      const name = `db/migrations/0${n}_fixture.sql`;
      expect(name.startsWith(workflow.on.push.paths[0].replace("**", ""))).toBe(true);
    }
    expect(workflow.on.workflow_dispatch.inputs.mode.options).toEqual(["deploy", "status-only"]);
    expect(workflow.concurrency).toEqual({ group: "db-migrate-plx-mc", "cancel-in-progress": false });
    expect(workflow.jobs.migrate.if).toBe("github.ref == 'refs/heads/main'");
    const step = workflow.jobs.migrate.steps.find((s: { run?: string }) => s.run?.includes("dual-db-migrate.sh"));
    expect(step.env.MC_UAT_DATABASE_URL).toBe("${{ secrets.MC_UAT_DATABASE_URL }}");
    expect(step.env.MC_STAGING_DATABASE_URL).toBe("${{ secrets.MC_STAGING_DATABASE_URL }}");
    expect(Object.keys(step.env).filter(k => k.endsWith("APPROVED_DB"))).toEqual(["MC_UAT_APPROVED_DB", "MC_STAGING_APPROVED_DB"]);
  });
  it.each([
    ["deploy", "", 0], ["status-only", "", 0], ["deploy", "uat", 1],
    ["deploy", "staging", 1], ["status-only", "uat", 1], ["status-only", "staging", 1],
    ["deploy", "missing-uat", 1], ["deploy", "missing-staging", 1],
  ])("%s mode with %s failure returns %s and attempts targets in order", (mode, failure, expected) => {
    const dir = temp();
    const npm = join(dir, "npm");
    // Replaces npm ONLY in this subprocess. No real pg connection is possible.
    writeFileSync(npm, `#!/usr/bin/env bash
set -eu
printf '%s %s\\n' "$PLX_MC_DATABASE_URL" "$*" >> "$RUNNER_TEMP/calls"
if [ "$PLX_MC_DATABASE_URL" = "$FAIL_TARGET" ]; then exit 1; fi
if [ "$MODE" = status-only ]; then printf 'pending 033_fixture.sql\\n'; else printf 'apply  033_fixture.sql\\n'; fi
`);
    chmodSync(npm, 0o700);
    const proc = spawnSync("bash", [resolve("scripts/dual-db-migrate.sh")], {
      encoding: "utf8", env: {
        ...testEnv, PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, MODE: mode,
        MC_UAT_DATABASE_URL: failure === "missing-uat" ? "" : "uat",
        MC_STAGING_DATABASE_URL: failure === "missing-staging" ? "" : "staging",
        MC_UAT_APPROVED_DB: "mc_test@uat.example.invalid",
        MC_STAGING_APPROVED_DB: "mc_test@staging.example.invalid", FAIL_TARGET: failure,
      },
    });
    expect(proc.status, proc.stderr).toBe(expected);
    const calls = readFileSync(join(dir, "calls"), "utf8");
    const order = calls.trim().split("\n").map(l => l.split(" ")[0]);
    expect(order).toEqual(failure === "missing-uat" ? ["staging"] : failure === "missing-staging" ? ["uat"] : ["uat", "staging"]);
    expect(calls).toContain(`run migrate -- --non-prod --approved-db mc_test@`);
    expect(calls).toContain(`--mode ${mode}`);
    const summary = readFileSync(join(dir, "db-migrate-summary.md"), "utf8");
    expect(summary.indexOf("### UAT")).toBeLessThan(summary.indexOf("### STAGING"));
    if (failure === "staging" && mode === "deploy") {
      expect(summary).toContain("### UAT: deploy succeeded");
      expect(summary).toContain("apply  033_fixture.sql");
      expect(summary).toContain("### STAGING: failed");
    }
    if (mode === "status-only" && !failure) expect(summary).toContain("pending 033_fixture.sql");
  });
});

const SKIP_LINE = "STAGING: skipped (MC_STAGING_DATABASE_URL and MC_STAGING_APPROVED_DB unset; UAT only; live plx_mc is not migrated here)";
function runShell(stagingUrl: string, stagingApproved: string, mode = "deploy") {
  const dir = temp();
  const npm = join(dir, "npm");
  // Fake npm mirrors the real guard's refusal of the live identity; no pg connection exists.
  writeFileSync(npm, `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$PLX_MC_DATABASE_URL" >> "$RUNNER_TEMP/calls"
case "$*" in *plx_mc@plx-postgres-staging*) echo 'Refusing: runtime database' >&2; exit 1;; esac
printf 'apply  033_fixture.sql\\n'
`);
  chmodSync(npm, 0o700);
  const proc = spawnSync("bash", [resolve("scripts/dual-db-migrate.sh")], {
    encoding: "utf8", env: {
      ...testEnv, PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, MODE: mode,
      MC_UAT_DATABASE_URL: "uat", MC_UAT_APPROVED_DB: "mc_test@uat.example.invalid",
      MC_STAGING_DATABASE_URL: stagingUrl, MC_STAGING_APPROVED_DB: stagingApproved,
    },
  });
  const calls = readFileSync(join(dir, "calls"), "utf8").trim().split("\n");
  return { proc, calls, summary: readFileSync(join(dir, "db-migrate-summary.md"), "utf8") };
}

describe("UAT-only when staging is unset", () => {
  it("both staging values unset: exit 0, skip line logged, staging not invoked, UAT ran", () => {
    const { proc, calls, summary } = runShell("", "");
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout).toContain(SKIP_LINE);
    expect(calls).toEqual(["uat"]);
    expect(summary).toContain("### UAT: deploy succeeded");
    expect(summary).toContain("### STAGING: skipped");
    expect(summary).not.toContain("STAGING: failed");
  });
  it.each([["staging", ""], ["", "mc_test@staging.example.invalid"]])("exactly one staging value set (%j, %j) fails and is not a skip", (u, a) => {
    const { proc, summary } = runShell(u, a);
    expect(proc.status).toBe(1);
    expect(proc.stdout).not.toContain("STAGING: skipped");
    expect(summary).toContain("### STAGING: failed");
    expect(summary).toContain("### UAT: deploy succeeded");
  });
  it("a configured staging target that is the live plx_mc identity fails the job, not a skip", () => {
    const { proc, calls, summary } = runShell("postgres://u:p@plx-postgres-staging.example.invalid/plx_mc", "plx_mc@plx-postgres-staging.example.invalid");
    expect(proc.status).toBe(1);
    expect(proc.stdout).not.toContain("STAGING: skipped");
    expect(calls).toHaveLength(2);
    expect(summary).toContain("### STAGING: failed");
    expect(summary).toContain("### UAT: deploy succeeded");
  });
  it("automatic workflow is renamed, never uses the live environment or live secrets", () => {
    const text = readFileSync(".github/workflows/db-migrate.yml", "utf8");
    expect(text).toContain("name: DB Migrate (UAT, staging when configured)");
    expect(text).not.toMatch(/mc-live-release|MC_LIVE_|environment:/);
  });
});

describe("live release workflow (separate, gated)", () => {
  const parsed = spawnSync("python3", ["-c", "import yaml,json; d=yaml.safe_load(open('.github/workflows/db-migrate-live.yml')); d['on']=d.pop(True); print(json.dumps(d))"], { encoding: "utf8" });
  const wf = JSON.parse(parsed.stdout || "{}");
  const raw = readFileSync(".github/workflows/db-migrate-live.yml", "utf8");
  it("is workflow_dispatch only with plan as the default mode and a string confirm", () => {
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(wf.name).toBe("DB Migrate (live release)");
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.on.workflow_dispatch.inputs.mode).toMatchObject({ type: "choice", default: "plan", options: ["plan", "apply"] });
    expect(wf.on.workflow_dispatch.inputs.confirm).toMatchObject({ type: "string", default: "" });
    expect(raw).not.toContain("MC_STAGING_");
  });
  it("plan job has no environment and no write steps; apply is gated and in mc-live-release", () => {
    expect(wf.jobs.plan).not.toHaveProperty("environment");
    expect(wf.jobs.plan.if).toContain("refs/heads/main");
    expect(wf.jobs.plan.if).toContain("!(inputs.mode == 'apply' && inputs.confirm == 'MIGRATE_LIVE')");
    const planText = JSON.stringify(wf.jobs.plan);
    expect(planText).not.toMatch(/npm run migrate|--apply|verify|PLX_MC_DATABASE_URL|MICROSOFT_GRAPH/);
    expect(wf.jobs.apply.environment).toBe("mc-live-release");
    expect(wf.jobs.apply.if).toContain("inputs.mode == 'apply'");
    expect(wf.jobs.apply.if).toContain("inputs.confirm == 'MIGRATE_LIVE'");
    const steps = wf.jobs.apply.steps.map((s: { run?: string }) => s.run ?? "");
    const idx = (needle: string) => steps.findIndex((r: string) => r.includes(needle));
    expect(idx("db-migrate-live.mjs verify")).toBeLessThan(idx("npm run migrate"));
    expect(idx("npm run migrate")).toBeLessThan(idx("--env staging --apply"));
    expect(idx("--env staging --apply")).toBe(idx("--env production --apply"));
    expect(steps[idx("--env staging --apply")].indexOf("--env staging")).toBeLessThan(steps[idx("--env staging --apply")].indexOf("--env production"));
  });
  it("plan prints pending files, redacted host/database and SharePoint columns; no credentials", () => {
    const { dir, names } = migrationFiles();
    const secret = "postgres://livesecretuser:hunter2pw@db.example.invalid:5432/plx_mc?sslmode=require&x=1";
    const plan = buildPlan({ env: { ...testEnv, MC_LIVE_DATABASE_URL: secret }, migrationsDir: dir });
    for (const n of names) expect(plan).toContain(n);
    expect(plan).toContain("host=db.example.invalid database=plx_mc");
    for (const leak of ["livesecretuser", "hunter2pw", "sslmode", "postgres://", ":5432"]) expect(plan).not.toContain(leak);
    expect(plan).toContain("ProjectID");
    expect(plan.indexOf("/sites/plx-mission-control-dev")).toBeLessThan(plan.indexOf("/sites/plx-mission-control\n"));
    expect(buildPlan({ env: { ...testEnv }, migrationsDir: dir })).toContain("secret unset");
    expect(redactedTarget("not a url hunter2")).not.toContain("hunter2");
  });
  it("apply verification refuses a different database and any non-live identity", async () => {
    const live = "postgres://u:p@plx-postgres-staging.example.invalid/plx_mc";
    const ok = harness({ live: "plx_mc" });
    await expect(verify({ env: { ...testEnv, MC_LIVE_DATABASE_URL: live, MC_LIVE_APPROVED_DB: "plx_mc@plx-postgres-staging.example.invalid" }, ClientClass: ok.Client })).resolves.toMatchObject({ database: "plx_mc" });
    const wrongLive = harness({ live: "other" });
    await expect(verify({ env: { ...testEnv, MC_LIVE_DATABASE_URL: live, MC_LIVE_APPROVED_DB: "plx_mc@plx-postgres-staging.example.invalid" }, ClientClass: wrongLive.Client })).rejects.toThrow(/Refusing/);
    const none = harness();
    await expect(verify({ env: { ...testEnv, MC_LIVE_DATABASE_URL: url, MC_LIVE_APPROVED_DB: "mc_test@uat.example.invalid" }, ClientClass: none.Client })).rejects.toThrow(/not the documented live/);
    await expect(verify({ env: { ...testEnv, MC_LIVE_DATABASE_URL: "postgres://u:p@other.invalid/plx_mc", MC_LIVE_APPROVED_DB: "plx_mc@plx-postgres-staging.example.invalid" }, ClientClass: none.Client })).rejects.toThrow(/does not match/);
    expect(none.connects).toBe(0);
  });
});
