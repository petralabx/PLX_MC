// The New draft form's session routes (TASK-4109): POST /api/drafts (create),
// PATCH /api/drafts/{id} (save), POST /api/drafts/{id}/submit and
// /withdraw, and what GET /api/drafts/{id} tells the form. The signed-in member
// is the author; only the author writes; a save or submit names the edit base it
// was read with and refuses once the draft has moved, while a review does not
// move it. The real requireSessionActor, capabilities and drafts service run;
// the session, the user row, the decision log and the live-state reads are
// seams, and the drafts store runs on its process-local fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => authState.session,
  oidcEnabled: () => true,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) => ({
    id: `u-${oid}`,
    entraOid: oid,
    email: authState.session?.user?.email ?? null,
    accessRole: "member",
    status: "active",
  }),
  findServicePrincipalById: async () => null,
}));

vi.mock("@/lib/permissions/decision-log", () => ({ recordPermissionDecision: vi.fn(async () => true) }));
vi.mock("@/lib/compliance/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compliance/repo")>()),
  appendEvent: vi.fn(async () => "1"),
}));
vi.mock("@/lib/sync/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sync/repo")>()),
  getRepos: vi.fn(async () => [{ id: "plx-mc", name: "PLX_MC" }]),
  getProjects: vi.fn(async () => []),
  getBuckets: vi.fn(async () => []),
  getEntities: vi.fn(async () => []),
}));

import { GET as getRoute, PATCH as saveRoute } from "@/app/api/drafts/[id]/route";
import { POST as reviewRoute } from "@/app/api/drafts/[id]/review/route";
import { POST as submitRoute } from "@/app/api/drafts/[id]/submit/route";
import { POST as withdrawRoute } from "@/app/api/drafts/[id]/withdraw/route";
import { POST as createRoute } from "@/app/api/drafts/route";
import { __resetDraftsMemoryForTests } from "@/lib/drafts/store";

const VINCE = "vince@petrasoap.com";
const RICARDO = "ricardo@petrasoap.com";

const signIn = (email: string) => {
  authState.session = { user: { oid: `oid-${email}`, email } };
};

type Envelope = { data?: Record<string, unknown> & { draft?: Record<string, unknown> }; error?: { code: string; message: string } };

async function call(handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, init: { method?: string; body?: unknown; id?: string } = {}) {
  const req = new Request(`http://mc.test${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const res = await handler(req, { params: Promise.resolve<Record<string, string>>(init.id ? { id: init.id } : {}) });
  return { status: res.status, ...((await res.json()) as Envelope) };
}

const create = (body: unknown) => call(createRoute, "/api/drafts", { method: "POST", body });
const read = (id: string) => call(getRoute, `/api/drafts/${id}`, { id });
const save = (id: string, body: unknown) => call(saveRoute, `/api/drafts/${id}`, { method: "PATCH", body, id });
const submit = (id: string, base: unknown) => call(submitRoute, `/api/drafts/${id}/submit`, { method: "POST", body: { base }, id });
const withdraw = (id: string, reason: string) => call(withdrawRoute, `/api/drafts/${id}/withdraw`, { method: "POST", body: { reason }, id });
const viewerOf = async (id: string) => (await read(id)).data!.viewer as Record<string, unknown> & { editBase: string };

const plan = {
  project: { name: "Draft Projects form", owner: "vince", repos: ["plx-mc"] },
  buckets: [{ key: "B1", name: "Form", owner: "vince" }],
  tasks: [{ key: "T1", bucket: "B1", title: "New draft form" }],
};
const research = {
  summary: "People write drafts on the screen.",
  recommendation: "A full-page form.",
  approaches: [{ name: "Full page", chosen: true }, { name: "Modal" }],
};

beforeEach(() => {
  vi.stubEnv("PLX_MC_DATABASE_URL", "");
  vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "");
  __resetDraftsMemoryForTests();
  signIn(VINCE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("create", () => {
  it("starts a draft whose author is the signed-in member, and tells the form what it may do", async () => {
    const made = await create({ title: "Draft Projects form", plan, research });
    expect(made.status).toBe(200);
    expect(made.data!.draft).toMatchObject({ id: "DRF-1", author: VINCE, status: "drafting" });
    const detail = await read("DRF-1");
    expect(detail.data).toMatchObject({ completeness: [], preflight: [] });
    expect(detail.data!.viewer).toMatchObject({ isAuthor: true, canEdit: true, canSubmit: true, canWithdraw: true, editBase: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
  });

  it("needs a title, and refuses a field it does not know", async () => {
    expect(await create({ plan })).toMatchObject({ status: 400, error: { code: "invalid_request" } });
    expect(await create({ title: "x", author: RICARDO })).toMatchObject({ status: 400, error: { code: "invalid_request" } });
  });

  it("lists what a draft still needs before it can be submitted", async () => {
    await create({ title: "Just a title" });
    const detail = await read("DRF-1");
    expect((detail.data!.completeness as { code: string }[]).map((i) => i.code)).toEqual(
      expect.arrayContaining(["summary_required", "recommendation_required", "approaches_required", "tasks_required"])
    );
    const refused = await submit("DRF-1", (await viewerOf("DRF-1")).editBase);
    expect(refused).toMatchObject({ status: 422, error: { code: "draft_not_ready" } });
  });

  it("is off with the kill switch", async () => {
    vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "0");
    expect(await create({ title: "x" })).toMatchObject({ status: 404, error: { code: "drafts_disabled" } });
  });
});

describe("save", () => {
  it("replaces the sections it sends, from the base it read", async () => {
    await create({ title: "Draft Projects form", plan, research });
    const { editBase } = await viewerOf("DRF-1");
    const saved = await save("DRF-1", { base: editBase, title: "Draft Projects: New draft form", visibility: "restricted", members: [RICARDO] });
    expect(saved).toMatchObject({ status: 200, data: { changed: true } });
    expect(saved.data!.editBase).not.toBe(editBase);
    const after = (await read("DRF-1")).data!;
    expect(after.draft).toMatchObject({ visibility: "restricted", members: [RICARDO], working: { title: "Draft Projects: New draft form" } });
    expect((after.viewer as { editBase: string }).editBase).toBe(saved.data!.editBase);
  });

  it("refuses a base the draft has moved from, and keeps the other edit", async () => {
    await create({ title: "Draft Projects form", plan, research });
    const { editBase } = await viewerOf("DRF-1");
    expect((await save("DRF-1", { base: editBase, title: "Saved in another tab" })).status).toBe(200);
    const stale = await save("DRF-1", { base: editBase, title: "Saved from a stale copy" });
    expect(stale).toMatchObject({ status: 409, error: { code: "draft_changed" } });
    expect((await read("DRF-1")).data!.draft).toMatchObject({ working: { title: "Saved in another tab" } });
  });

  it("needs a base and at least one section", async () => {
    await create({ title: "x" });
    const { editBase } = await viewerOf("DRF-1");
    expect(await save("DRF-1", { title: "y" })).toMatchObject({ status: 400 });
    expect(await save("DRF-1", { base: editBase })).toMatchObject({ status: 400 });
  });

  it("is the author's alone", async () => {
    await create({ title: "Draft Projects form", plan, research });
    const { editBase } = await viewerOf("DRF-1");
    signIn(RICARDO);
    expect(await viewerOf("DRF-1")).toMatchObject({ isAuthor: false, canEdit: false, canSubmit: false, canWithdraw: false });
    expect(await save("DRF-1", { base: editBase, title: "Not mine" })).toMatchObject({ status: 403, error: { code: "not_draft_writer" } });
    expect(await submit("DRF-1", editBase)).toMatchObject({ status: 403 });
    expect(await withdraw("DRF-1", "Not my draft to withdraw.")).toMatchObject({ status: 403 });
  });
});

describe("submit", () => {
  it("freezes the version the author read; a review after it does not move the base", async () => {
    await create({ title: "Draft Projects form", plan, research });
    const { editBase } = await viewerOf("DRF-1");
    const submitted = await submit("DRF-1", editBase);
    expect(submitted).toMatchObject({ status: 200, data: { frozen: true, draft: { status: "in_review", version: 1 } } });
    expect(await viewerOf("DRF-1")).toMatchObject({ canSubmit: false, canEdit: true, editBase });

    signIn(RICARDO);
    const comment = await call(reviewRoute, "/api/drafts/DRF-1/review", { method: "POST", body: { kind: "comment", version: 1, body: "Looks right." }, id: "DRF-1" });
    expect(comment.status).toBe(200);

    signIn(VINCE);
    const edited = await save("DRF-1", { base: editBase, title: "Draft Projects: New draft form" });
    expect(edited).toMatchObject({ status: 200, data: { draft: { status: "drafting" } } });
  });

  it("refuses content the author did not see", async () => {
    await create({ title: "Draft Projects form", plan, research });
    const { editBase } = await viewerOf("DRF-1");
    await save("DRF-1", { base: editBase, title: "Changed by their agent meanwhile" });
    expect(await submit("DRF-1", editBase)).toMatchObject({ status: 409, error: { code: "draft_changed" } });
    expect(await submit("DRF-1", (await viewerOf("DRF-1")).editBase)).toMatchObject({ status: 200, data: { frozen: true } });
  });
});

describe("withdraw", () => {
  it("needs a reason of 10 characters or more, and closes the draft", async () => {
    await create({ title: "Draft Projects form", plan, research });
    expect(await withdraw("DRF-1", "too short")).toMatchObject({ status: 400 });
    expect(await withdraw("DRF-1", "Folded into another plan.")).toMatchObject({ status: 200, data: { draft: { status: "withdrawn" } } });
    expect(await viewerOf("DRF-1")).toMatchObject({ canEdit: false, canSubmit: false, canWithdraw: false });
    const { editBase } = await viewerOf("DRF-1");
    expect(await save("DRF-1", { base: editBase, title: "After withdraw" })).toMatchObject({ status: 409, error: { code: "draft_closed" } });
  });
});
