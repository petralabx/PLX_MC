// Review links at the compliance gate (TASK-3168). verifyPr reads the PR body
// only when the PR touches a mapped module, warns until 2026-11-01, then blocks,
// and records the reason code on the gate event. Same in-memory repo/sync mocks
// as tests/compliance-multitask.test.ts (no live DB, no GitHub).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/mc-data";

const gh = vi.hoisted(() => ({
  loadPrState: vi.fn(async () => ({ open: false, checkoutIds: [] as string[] })),
  loadPrReviewLinks: vi.fn(),
}));
vi.mock("@/lib/compliance/github-pr", () => gh);

const db = vi.hoisted(() => ({
  dispatches: new Map<string, { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string; revoked: boolean; expiresAt: string }>(),
  events: [] as { kind: string; taskId?: string | null; payload?: Record<string, unknown>; dedupKey?: string | null }[],
  tasks: new Map<string, Task>(),
  dedupKeys: new Set<string>(),
}));

vi.mock("@/lib/compliance/repo", () => ({
  async insertDispatch(d: { id: string; actorKind: "agent" | "operator"; runtime: string; taskId: string; accountableHuman: string; repo: string }) {
    db.dispatches.set(d.id, { ...d, revoked: false, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  },
  async getDispatch(id: string) {
    return db.dispatches.get(id) ?? null;
  },
  async appendEvent(e: { kind: string; taskId?: string | null; payload?: Record<string, unknown>; dedupKey?: string | null }) {
    if (e.dedupKey) {
      if (db.dedupKeys.has(e.dedupKey)) return;
      db.dedupKeys.add(e.dedupKey);
    }
    db.events.push(e);
  },
  async recordCheck() {},
  async eventTaskIdByDedupKey() {
    return null;
  },
}));

vi.mock("@/lib/sync/repo", () => ({
  async getEntity(type: string, id: string) {
    const t = db.tasks.get(id);
    return t ? { entity_type: type, id, data: t, sync_state: "synced", sp_item_id: null, dirty_fields: [] } : null;
  },
  async getBuckets() {
    return [];
  },
}));

import { REVIEW_LINKS_MISSING, REVIEW_LINKS_UNCHECKED } from "@/lib/compliance";
import { checkout, verifyPr } from "@/lib/compliance/service";

const task: Task = {
  id: "TASK-1",
  title: "t",
  bucket: "BKT-WMS",
  stage: "progress",
  priority: "medium",
  assignee: "vibes",
  coassignees: [],
  reporter: "vince",
  accountableOwner: "greg",
  reqs: [],
  repos: [],
  estimate: "M",
  labels: [],
  prs: [],
  due: "—",
  sync: { state: "pending", ts: "—", sp: "—" },
  subtasks: [],
  activity: [],
  evidence: { summary: "ok", items: [{ key: "a", label: "a", done: true }], rollback: "revert the PR" },
};

const REPO = "petralabx/PLX_MC";
const MAPPED = ["src/lib/sync/repo.ts"];

async function gate(prNumber: number, changedPaths: string[], event?: "merge_group") {
  const { checkoutId } = await checkout({ taskId: "TASK-1", runtime: "claude", accountableHuman: "vince", repo: REPO });
  return verifyPr({ repo: "PLX_MC", repoFullName: REPO, prNumber, headSha: `sha${prNumber}`, changedPaths, checkoutIds: [checkoutId], event });
}

const gateReasons = (kind: string) => db.events.filter((e) => e.kind === kind).map((e) => e.payload?.reasons as string[]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  db.dispatches.clear();
  db.events.length = 0;
  db.tasks.clear();
  db.dedupKeys.clear();
  db.tasks.set("TASK-1", task);
  gh.loadPrReviewLinks.mockReset();
  gh.loadPrReviewLinks.mockResolvedValue({ found: false, urls: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyPr — review links", () => {
  it("warns before 2026-11-01 and records the reason code on gate.passed", async () => {
    const r = await gate(1, MAPPED);
    expect(r.verdict).toBe("pass");
    expect(gh.loadPrReviewLinks).toHaveBeenCalledExactlyOnceWith(REPO, 1);
    const [reasons] = gateReasons("gate.passed");
    expect(reasons.some((line) => line.startsWith(`${REVIEW_LINKS_MISSING}:`) && line.endsWith("Warning only until 2026-11-01."))).toBe(true);
  });

  it("blocks from 2026-11-01 and records the reason code on gate.blocked", async () => {
    vi.setSystemTime(new Date("2026-11-01T04:00:00.000Z"));
    const r = await gate(2, MAPPED);
    expect(r.verdict).toBe("block");
    expect(r.reasons[0]).toMatch(new RegExp(`^TASK-1: ${REVIEW_LINKS_MISSING}: add a "## Review links" section`));
    const [reasons] = gateReasons("gate.blocked");
    expect(reasons[0]).toMatch(new RegExp(`^${REVIEW_LINKS_MISSING}:`));
  });

  it("passes after the block date when every touched module has a link", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    gh.loadPrReviewLinks.mockResolvedValue({ found: true, urls: ["https://plx-mc-preview.vercel.app/?screen=sync"] });
    const r = await gate(3, MAPPED);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.join(" ")).not.toContain("review_links");
  });

  it("never reads the body for unmapped paths", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    const r = await gate(4, ["src/lib/x.ts", "README.md"]);
    expect(r.verdict).toBe("pass");
    expect(gh.loadPrReviewLinks).not.toHaveBeenCalled();
    expect(r.reasons.join(" ")).not.toContain("review_links");
  });

  it("only notes an unreadable body, even after the block date", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    gh.loadPrReviewLinks.mockRejectedValue(new Error("GitHub returned HTTP 502."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await gate(5, MAPPED);
    expect(r.verdict).toBe("pass");
    expect(r.reasons.some((line) => line.includes(`${REVIEW_LINKS_UNCHECKED}:`))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not read GitHub in the merge queue", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    const r = await gate(6, MAPPED, "merge_group");
    expect(r.verdict).toBe("pass");
    expect(gh.loadPrReviewLinks).not.toHaveBeenCalled();
  });

  it("leaves operator PRs ungated", async () => {
    vi.setSystemTime(new Date("2026-11-02T00:00:00.000Z"));
    const r = await verifyPr({ repo: "PLX_MC", repoFullName: REPO, prNumber: 7, headSha: "sha7", changedPaths: MAPPED });
    expect(r.verdict).toBe("pass");
    expect(gh.loadPrReviewLinks).not.toHaveBeenCalled();
  });
});
