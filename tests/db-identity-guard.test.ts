// TASK-2528: the backfill must verify a named non-production DB identity
// before ANY read or write. Offline: a mocked client records every query.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DbIdentityError,
  assertApprovedNonProdDb,
  parseApprovedSpec,
} from "../scripts/lib/db-identity.mjs";
import { main } from "../scripts/backfill-task-completed-at.mjs";

const RUNTIME_HOST = "plx-postgres-staging.abc123.us-east-1.rds.amazonaws.com";
const UAT_HOST = "plx-postgres-uat.abc123.us-east-1.rds.amazonaws.com";
const urlOf = (db: string, host: string) => `postgres://plx_mc_app:s3cret@${host}:5432/${db}`;

function mockClient(liveDb: string | null | Error) {
  const queries: string[] = [];
  return {
    queries,
    ended: false,
    async connect() {},
    async end() {
      this.ended = true;
    },
    async query(sql: string) {
      queries.push(sql);
      if (/current_database\(\)/.test(sql)) {
        if (liveDb instanceof Error) throw liveDb;
        return { rows: liveDb === null ? [] : [{ db: liveDb, addr: "10.0.0.5" }], rowCount: 1 };
      }
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM entities WHERE entity_type = 'task'/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM mc_events/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

async function runMain(
  argv: string[],
  url: string,
  client: ReturnType<typeof mockClient>,
  env: Record<string, string> = {},
  created: unknown[] = []
) {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const code = await main(argv, {
    env: { PLX_MC_DATABASE_URL: url, ...env },
    createClient: (target: unknown) => {
      created.push(target);
      return client;
    },
  });
  return { code, stderr: err.mock.calls.flat().join("\n"), stdout: log.mock.calls.flat().join("\n") };
}

afterEach(() => vi.restoreAllMocks());

describe("parseApprovedSpec", () => {
  it("accepts <database>@<host>", () => {
    expect(parseApprovedSpec("plx_mc_uat@Host.Example.com")).toEqual({ database: "plx_mc_uat", host: "host.example.com" });
  });
  it.each([undefined, "", "plx_mc_uat", "@host", "db@", "db@host@x", "db @host", "d/b@host"])("rejects %j", (raw) => {
    expect(() => parseApprovedSpec(raw as string)).toThrow(DbIdentityError);
  });
});

describe("backfill identity guard", () => {
  it("refuses the TOOLS.md runtime DB (plx_mc on plx-postgres-staging) with --env staging --apply, touching nothing", async () => {
    const client = mockClient("plx_mc");
    const r = await runMain(
      ["--env", "staging", "--apply", "--approved-db", `plx_mc@${RUNTIME_HOST}`],
      urlOf("plx_mc", RUNTIME_HOST),
      client
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/runtime database/);
    expect(client.queries).toEqual([]);
  });

  it("refuses the runtime DB even when the URL has no 'prod' and approval is for a different spec", async () => {
    const client = mockClient("plx_mc");
    const r = await runMain(
      ["--env", "staging", "--apply", "--approved-db", `plx_mc_uat@${UAT_HOST}`],
      urlOf("plx_mc", RUNTIME_HOST),
      client
    );
    expect(r.code).toBe(1);
    expect(client.queries).toEqual([]);
  });

  it.each([
    ["missing", []],
    ["malformed", ["--approved-db", "plx_mc_uat"]],
    ["valueless", ["--approved-db"]],
  ])("refuses a %s --approved-db (dry run too)", async (_n, extra) => {
    const client = mockClient("plx_mc_uat");
    const r = await runMain(["--env", "uat", ...extra], urlOf("plx_mc_uat", UAT_HOST), client);
    expect(r.code).toBe(1);
    expect(client.queries).toEqual([]);
  });

  it("refuses a mismatched approved database or host", async () => {
    for (const spec of [`other_db@${UAT_HOST}`, "plx_mc_uat@elsewhere.example.com"]) {
      const client = mockClient("plx_mc_uat");
      const r = await runMain(["--env", "uat", "--approved-db", spec], urlOf("plx_mc_uat", UAT_HOST), client);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/not the approved/);
      expect(client.queries).toEqual([]);
    }
  });

  it("refuses when the URL matches but current_database() differs; no read or write follows", async () => {
    const client = mockClient("some_other_db");
    const r = await runMain(
      ["--env", "uat", "--apply", "--approved-db", `plx_mc_uat@${UAT_HOST}`],
      urlOf("plx_mc_uat", UAT_HOST),
      client
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/connected database is "some_other_db"/);
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toMatch(/current_database/);
    expect(client.ended).toBe(true);
  });

  it("refuses when the live identity cannot be established", async () => {
    for (const live of [null, new Error("permission denied")]) {
      const client = mockClient(live);
      const r = await runMain(
        ["--env", "uat", "--approved-db", `plx_mc_uat@${UAT_HOST}`],
        urlOf("plx_mc_uat", UAT_HOST),
        client
      );
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/Cannot establish DB identity/);
    }
  });

  it("refuses an unparseable URL", async () => {
    const client = mockClient("x");
    const r = await runMain(["--env", "uat", "--approved-db", "x@y"], "not a url", client);
    expect(r.code).toBe(1);
    expect(client.queries).toEqual([]);
  });

  it("dry run against an approved UAT identity verifies first, then reads, never writes", async () => {
    const client = mockClient("plx_mc_uat");
    const r = await runMain(["--env", "uat", "--approved-db", `plx_mc_uat@${UAT_HOST}`], urlOf("plx_mc_uat", UAT_HOST), client);
    expect(r.code).toBe(0);
    expect(client.queries[0]).toMatch(/current_database/);
    expect(client.queries.some((q) => /UPDATE|BEGIN/.test(q))).toBe(false);
    expect(r.stdout).toMatch(/DRY RUN/);
  });

  it("--apply against an approved staging identity (non-runtime db on the staging RDS) proceeds", async () => {
    const client = mockClient("plx_mc_uat");
    const r = await runMain(
      ["--env", "staging", "--apply", "--approved-db", `plx_mc_uat@${RUNTIME_HOST}`],
      urlOf("plx_mc_uat", RUNTIME_HOST),
      client
    );
    expect(r.code).toBe(0);
    expect(client.queries[0]).toMatch(/current_database/);
    expect(client.queries).toContain("BEGIN");
    expect(r.stdout).toMatch(/APPLY/);
  });

  it("the --env label alone never authorizes", async () => {
    const client = mockClient("plx_mc_uat");
    const r = await runMain(["--env", "uat", "--apply"], urlOf("plx_mc_uat", UAT_HOST), client);
    expect(r.code).toBe(1);
    expect(client.queries).toEqual([]);
  });
});

describe("effective connection target (host-override hole)", () => {
  const approvedArgs = ["--env", "uat", "--apply", "--approved-db", "plx_mc@uat"];

  it("refuses the Astra URL: approved plx_mc@uat but ?host= points at the runtime RDS", async () => {
    const client = mockClient("plx_mc");
    const created: unknown[] = [];
    const url = `postgres://user:pass@uat/plx_mc?host=${RUNTIME_HOST}`;
    const r = await runMain(approvedArgs, url, client, {}, created);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/"host" can override/);
    expect(client.queries).toEqual([]);
    expect(created).toEqual([]);
  });

  it.each(["host", "hostaddr", "port", "dbname", "database", "service", "options", "sslrootcert", "user", "passfile"])(
    "refuses the %s query override",
    async (param) => {
      const client = mockClient("plx_mc_uat");
      const created: unknown[] = [];
      const r = await runMain(
        ["--env", "uat", "--approved-db", `plx_mc_uat@${UAT_HOST}`],
        `${urlOf("plx_mc_uat", UAT_HOST)}?${param}=x`,
        client,
        {},
        created
      );
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(new RegExp(`"${param}" can override`));
      expect(created).toEqual([]);
      expect(client.queries).toEqual([]);
    }
  );

  it.each(["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGSERVICE", "PGSERVICEFILE"])(
    "refuses when %s is set in the environment",
    async (name) => {
      const client = mockClient("plx_mc_uat");
      const created: unknown[] = [];
      const r = await runMain(
        ["--env", "uat", "--approved-db", `plx_mc_uat@${UAT_HOST}`],
        urlOf("plx_mc_uat", UAT_HOST),
        client,
        { [name]: "x" },
        created
      );
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(new RegExp(name));
      expect(created).toEqual([]);
      expect(client.queries).toEqual([]);
    }
  );

  it.each([
    ["multiple hosts", `postgres://u:p@${UAT_HOST},${RUNTIME_HOST}/plx_mc_uat`],
    ["unix socket via encoded host", "postgres://u:p@%2Fvar%2Frun%2Fpostgresql/plx_mc_uat"],
    ["missing user", `postgres://${UAT_HOST}/plx_mc_uat`],
    ["non-postgres scheme", `http://u:p@${UAT_HOST}/plx_mc_uat`],
  ])("refuses %s", async (_n, url) => {
    const client = mockClient("plx_mc_uat");
    const created: unknown[] = [];
    const r = await runMain(["--env", "uat", "--approved-db", `plx_mc_uat@${UAT_HOST}`], url, client, {}, created);
    expect(r.code).toBe(1);
    expect(created).toEqual([]);
    expect(client.queries).toEqual([]);
  });

  it("a clean approved URL (sslmode allowed) passes dry run and apply, and the client is built from the validated target", async () => {
    for (const flags of [[], ["--apply"]]) {
      const client = mockClient("plx_mc_uat");
      const created: unknown[] = [];
      const r = await runMain(
        ["--env", "uat", ...flags, "--approved-db", `plx_mc_uat@${UAT_HOST}`],
        `${urlOf("plx_mc_uat", UAT_HOST)}?sslmode=require`,
        client,
        {},
        created
      );
      expect(r.code).toBe(0);
      expect(created).toEqual([
        { host: UAT_HOST, port: 5432, database: "plx_mc_uat", user: "plx_mc_app", password: "s3cret" },
      ]);
    }
  });
});

describe("assertApprovedNonProdDb", () => {
  it("returns the verified identity", async () => {
    const id = await assertApprovedNonProdDb(
      mockClient("plx_mc_uat"),
      urlOf("plx_mc_uat", UAT_HOST),
      { database: "plx_mc_uat", host: UAT_HOST }
    );
    expect(id).toEqual({ database: "plx_mc_uat", host: UAT_HOST, serverAddr: "10.0.0.5" });
  });
});
