// Draft Projects (TASK-4059) against real Postgres: every migration on a
// disposable PG16, then the drafts service through the real db pool. Covers the
// DRF-* id sequence, a submit freezing its version in the same transaction, the
// trigger that refuses any change to a frozen version, the table CHECKs, racing
// reviews all landing under the row lock, the draft.* events in mc_events, and
// the rollback file undoing 056 so the runner can apply it again.
// Disposable local PG16 only: no external URLs or credentials are consumed.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import { Client, type ClientConfig, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { main as migrate } from "../scripts/migrate.mjs";
import { POSTGRES_IMAGE, ensurePostgresImage } from "../scripts/lib/postgres-image.mjs";

const h = vi.hoisted(() => ({ mcUrl: "" }));
vi.mock("@/lib/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/secrets")>()),
  databaseUrl: () => h.mcUrl,
  databaseConfigured: () => true,
}));
vi.mock("@/lib/db/tls", () => ({ resolveDbSsl: () => false }));

import { HUMANS } from "@/lib/mc-data/data";
import type { Repo } from "@/lib/mc-data/types";
import { draftPlanSchema, draftResearchSchema } from "@/lib/drafts/schema";
import { createDraft, listVisibleDrafts, reviewDraft, submitDraft, type DraftActor, type DraftDeps } from "@/lib/drafts/service";
import { getDraft, getDraftVersion } from "@/lib/drafts/store";
import type { DraftPlan, DraftResearch } from "@/lib/drafts/types";
import { principalFromTokens } from "@/lib/permissions/project-acl";

class LocalClient extends Client {
  constructor(options: ClientConfig) {
    super({ ...options, ssl: false });
  }
}

const NAME = `plx-mc-drafts-pg-${randomBytes(4).toString("hex")}`;
let started = false;
let db: Client;

async function connect(url: string): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    const client = new LocalClient({ connectionString: url });
    try {
      await client.connect();
      return client;
    } catch {
      await client.end().catch(() => undefined);
      if (attempt >= 60) throw new Error("local PG16 unavailable");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

const runMigrations = () =>
  migrate({ env: { NODE_ENV: "test", PLX_MC_DATABASE_URL: h.mcUrl }, ClientClass: LocalClient, log: () => {} });

beforeAll(async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const password = randomBytes(12).toString("hex");
  expect(ensurePostgresImage()).toMatchObject({ ok: true });
  const run = spawnSync("docker", ["run", "-d", "--name", NAME, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, POSTGRES_IMAGE], { encoding: "utf8" });
  expect(run.status, run.stderr).toBe(0);
  started = true;
  const adminUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  const bootstrap = await connect(adminUrl);
  await bootstrap.query("CREATE DATABASE mc_drafts");
  await bootstrap.end();
  h.mcUrl = adminUrl.replace(/\/postgres$/, "/mc_drafts");
  expect(await runMigrations()).toBe(0);
  db = await connect(h.mcUrl);
}, 120_000);

afterAll(async () => {
  const pools = globalThis as typeof globalThis & { __plxMcPool?: Pool };
  await pools.__plxMcPool?.end();
  delete pools.__plxMcPool;
  await db?.end();
  if (started) expect(spawnSync("docker", ["rm", "-f", NAME]).status).toBe(0);
});

const actor: DraftActor = { kind: "agent", email: "vince@petrasoap.com", principalId: "sp_mcp_claude_code", acl: principalFromTokens("sp_mcp_claude_code") };
const deps: DraftDeps = {
  registry: async () => ({ "plx-mc": { id: "plx-mc", name: "PLX_MC" } as Repo }),
  projects: async () => [],
  buckets: async () => [],
  openTasks: async () => [],
  humans: () => Object.values(HUMANS),
};
const plan = draftPlanSchema.parse({
  project: { name: "Draft Projects", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Storage", owner: "vince" }],
  tasks: [{ key: "T1", bucket: "B1", title: "Drafts storage migration" }],
}) as DraftPlan;
const research = draftResearchSchema.parse({
  summary: "Reviewable plans.",
  recommendation: "Separate tables.",
  approaches: [
    { name: "Separate tables", chosen: true },
    { name: "Status on projects" },
  ],
}) as DraftResearch;

async function sqlError(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await db.query(sql, params);
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe("Draft Projects on Postgres", () => {
  it("allocates DRF-* ids, freezes a submit's version in its transaction, and records the events", async () => {
    const created = await createDraft(actor, { title: "Draft Projects", plan, research });
    expect(created.id).toMatch(/^DRF-\d+$/);
    const { draft } = await submitDraft(actor, created.id, deps);
    expect(draft).toMatchObject({ status: "in_review", version: 1 });
    const stored = await getDraft(created.id);
    expect(stored).toMatchObject({ status: "in_review", version: 1, digest: draft.digest, author: "vince@petrasoap.com" });
    expect(stored?.working.plan.tasks.map((t) => t.key)).toEqual(["T1"]);
    const version = await getDraftVersion(created.id, 1);
    expect(version).toMatchObject({ version: 1, digest: draft.digest, frozenBy: "vince@petrasoap.com" });
    expect(version?.content.title).toBe("Draft Projects");
    const events = await db.query("SELECT kind, payload->>'draftId' AS draft FROM mc_events WHERE kind LIKE 'draft.%' ORDER BY seq");
    expect(events.rows).toEqual([
      { kind: "draft.created", draft: created.id },
      { kind: "draft.submitted", draft: created.id },
    ]);
  });

  it("refuses any change to a frozen version", async () => {
    const created = await createDraft(actor, { title: "Frozen", plan, research });
    await submitDraft(actor, created.id, deps);
    expect(await sqlError("UPDATE draft_versions SET frozen_by = 'x' WHERE draft_id = $1", [created.id])).toBe("23514");
    expect(await sqlError("DELETE FROM draft_versions WHERE draft_id = $1", [created.id])).toBe("23514");
    expect(await sqlError("TRUNCATE draft_versions")).toBe("23514");
    expect(await sqlError("TRUNCATE drafts CASCADE")).toBe("23514");
    expect((await getDraftVersion(created.id, 1))?.frozenBy).toBe("vince@petrasoap.com");
  });

  it("keeps the table honest: a digest only with a version, review only after one, closed status words", async () => {
    const insert = (status: string, version: number, digest: string | null) =>
      sqlError(
        "INSERT INTO drafts (id, status, author, created_by, version, digest, working) VALUES ($1, $2, 'vince@petrasoap.com', 'sp_x', $3, $4, '{}'::jsonb)",
        [`DRF-9${randomBytes(2).readUInt16BE()}`, status, version, digest]
      );
    expect(await insert("drafting", 1, null)).toBe("23514");
    expect(await insert("drafting", 0, `sha256:${"a".repeat(64)}`)).toBe("23514");
    expect(await insert("in_review", 0, null)).toBe("23514");
    expect(await insert("approved", 0, null)).toBe("23514");
    expect(await insert("drafting", 1, "sha256:short")).toBe("23514");
    expect(await sqlError("INSERT INTO drafts (id, author, created_by, working) VALUES ('PRJ-1', 'a', 'b', '{}'::jsonb)")).toBe("23514");
  });

  it("lands every review when reviewers race", async () => {
    const created = await createDraft(actor, { title: "Raced", plan, research });
    await submitDraft(actor, created.id, deps);
    const reviewers = ["ricardo", "stephen", "rishi", "greg", "ross"].map((id): DraftActor => ({
      kind: "human",
      email: HUMANS[id].email!,
      principalId: `oid-${id}`,
      acl: principalFromTokens(HUMANS[id].email!),
    }));
    await Promise.all(reviewers.map((r, i) => reviewDraft(r, created.id, { kind: i % 2 ? "comment" : "approve", version: 1, body: `Review ${i}` })));
    const stored = await getDraft(created.id);
    expect(stored?.reviews.map((r) => r.body).sort()).toEqual(["Review 0", "Review 1", "Review 2", "Review 3", "Review 4"]);
  });

  it("lists in SQL: restricted drafts only for members and the author, mine, needs-my-review and a literal search", async () => {
    const vince = (principal: string): DraftActor => ({ kind: "agent", email: "vince@petrasoap.com", principalId: principal, acl: principalFromTokens(principal, "vince@petrasoap.com") });
    const ricardo: DraftActor = { kind: "human", email: "ricardo@petrasoap.com", principalId: "oid-ricardo", acl: principalFromTokens("ricardo@petrasoap.com", "ricardo") };
    const secret = await createDraft(vince("sp_mcp_claude_code"), { title: "Secret 100% plan_x", plan, research, visibility: "restricted", members: ["stephen@petrasoap.com"] });
    const shared = await createDraft(vince("sp_mcp_claude_code"), { title: "Shared plan", plan, research, reviewers: ["ricardo"] });
    await submitDraft(vince("sp_mcp_claude_code"), shared.id, deps);
    const ids = async (actor: DraftActor, filter: Parameters<typeof listVisibleDrafts>[1] = {}) => (await listVisibleDrafts(actor, filter)).map((d) => d.id);
    expect(await ids(ricardo, { status: "all" })).not.toContain(secret.id);
    expect(await ids(vince("sp_mcp_codex"), { status: "all" })).toContain(secret.id);
    const stephen: DraftActor = { kind: "human", email: "stephen@petrasoap.com", principalId: "oid-stephen", acl: principalFromTokens("stephen@petrasoap.com") };
    expect(await ids(stephen, { status: "all" })).toContain(secret.id);
    expect(await ids(ricardo, { needsMyReview: true })).toEqual([shared.id]);
    await reviewDraft(ricardo, shared.id, { kind: "comment", version: 1, body: "A comment is not a review." });
    expect(await ids(ricardo, { needsMyReview: true })).toEqual([shared.id]);
    await reviewDraft(ricardo, shared.id, { kind: "approve", version: 1, body: "Yes." });
    expect(await ids(ricardo, { needsMyReview: true })).toEqual([]);
    expect(await ids(vince("sp_mcp_codex"), { status: "all", q: "100%" })).toEqual([secret.id]);
    expect(await ids(vince("sp_mcp_codex"), { status: "all", q: "n_x" })).toEqual([secret.id]);
    expect(await ids(vince("sp_mcp_codex"), { status: "all", q: "1_0" })).toEqual([]);
    expect(await ids(ricardo, { status: "all", mine: true })).toEqual([]);
    const summary = (await listVisibleDrafts(ricardo, { q: "Shared plan" }))[0];
    expect(summary).toMatchObject({ id: shared.id, title: "Shared plan", buckets: 1, tasks: 1, openFindings: 0, openBlockingFindings: 0, version: 1 });
    expect(summary).not.toHaveProperty("working");
  });

  it("rolls 056 back cleanly, and the runner applies it again", async () => {
    const rollback = await readFile("db/rollback/056_drafts_rollback.sql", "utf8");
    await db.query(rollback);
    const gone = await db.query("SELECT to_regclass('drafts') AS d, to_regclass('draft_versions') AS v, to_regclass('mc_draft_id_seq') AS s");
    expect(gone.rows[0]).toEqual({ d: null, v: null, s: null });
    expect(await runMigrations()).toBe(0);
    const back = await db.query("SELECT to_regclass('drafts')::text AS d, to_regclass('draft_versions')::text AS v");
    expect(back.rows[0]).toEqual({ d: "drafts", v: "draft_versions" });
    const ledger = await db.query("SELECT 1 FROM schema_migrations WHERE filename = '056_drafts.sql'");
    expect(ledger.rowCount).toBe(1);
  });
});
