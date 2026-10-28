// The New draft form's upload (TASK-4131): POST /api/drafts/{id}/artifacts and
// what GET /api/drafts/{id} tells the form (viewer.canUpload). The signed-in
// author uploads with the edit base the form read; MC stores the file through the
// mc_upload_draft_artifact core (TASK-4130) and returns the new base. The real
// requireSessionActor, capabilities and drafts service run; the session, the user
// row, the decision log, the live-state reads and SharePoint (Graph) are seams,
// and the drafts store runs on its process-local fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
}));
const h = vi.hoisted(() => ({ uploads: [] as string[] }));

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
vi.mock("@/lib/sync/graph", async () => {
  const { GraphError } = await vi.importActual<typeof import("@/lib/sync/graph")>("@/lib/sync/graph");
  return {
    GraphError,
    siteIdByPath: vi.fn(async (path: string) => `site:${path}`),
    driveIdByName: vi.fn(async () => "drive-mc"),
    uploadSmallDriveFile: vi.fn(async (_driveId: string, path: string, bytes: Uint8Array) => {
      h.uploads.push(path);
      return { id: `item-${h.uploads.length}`, webUrl: `https://petrasoap.sharepoint.com/sites/PLXSite/Mission%20Control/${path}`, size: bytes.length };
    }),
  };
});

import { POST as uploadRoute } from "@/app/api/drafts/[id]/artifacts/route";
import { GET as getRoute } from "@/app/api/drafts/[id]/route";
import { POST as createRoute } from "@/app/api/drafts/route";
import { __resetDraftsMemoryForTests } from "@/lib/drafts/store";
import { __clearEvidenceDriveCacheForTests } from "@/lib/mcp/evidence-actions";

const VINCE = "vince@petrasoap.com";
const RICARDO = "ricardo@petrasoap.com";

const signIn = (email: string) => {
  authState.session = { user: { oid: `oid-${email}`, email } };
};

// Parsed JSON is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Envelope = { data?: Record<string, any>; error?: { code: string; message: string } };

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
const viewerOf = async (id: string) => (await call(getRoute, `/api/drafts/${id}`, { id })).data!.viewer as Record<string, unknown> & { editBase: string };
const upload = (id: string, body: unknown) => call(uploadRoute, `/api/drafts/${id}/artifacts`, { method: "POST", body, id });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]).toString("base64");
const file = { kind: "screenshot", fileName: "form.png", contentType: "image/png", contentBase64: PNG };

beforeEach(() => {
  vi.stubEnv("PLX_MC_DATABASE_URL", "");
  vi.stubEnv("PLX_MC_DRAFTS_ENABLED", "");
  vi.stubEnv("PLX_MC_EVIDENCE_STORE_ENABLED", "1");
  __resetDraftsMemoryForTests();
  __clearEvidenceDriveCacheForTests();
  h.uploads = [];
  signIn(VINCE);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("what GET tells the form", () => {
  it("offers uploads to the author of an open, shared draft while the store is on", async () => {
    await create({ title: "Uploads" });
    expect(await viewerOf("DRF-1")).toMatchObject({ canUpload: true });

    vi.stubEnv("PLX_MC_EVIDENCE_STORE_ENABLED", "");
    expect(await viewerOf("DRF-1")).toMatchObject({ canUpload: false });
    vi.stubEnv("PLX_MC_EVIDENCE_STORE_ENABLED", "1");

    signIn(RICARDO);
    expect(await viewerOf("DRF-1")).toMatchObject({ canUpload: false });
  });

  it("keeps a restricted draft to links: the library is shared", async () => {
    await create({ title: "Private plan", visibility: "restricted", members: [VINCE] });
    expect(await viewerOf("DRF-1")).toMatchObject({ canUpload: false });
  });
});

describe("POST /api/drafts/{id}/artifacts", () => {
  it("stores the file from the base the form read, links it, and returns the new base", async () => {
    await create({ title: "Uploads" });
    const { editBase } = await viewerOf("DRF-1");
    const res = await upload("DRF-1", { base: editBase, ...file });
    expect(res.status).toBe(200);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0]).toMatch(/^Drafts\/DRF-1\/\d{8}T\d{6}Z-[0-9a-f]{8}-form\.png$/);
    expect(res.data).toMatchObject({ duplicate: false, artifact: { kind: "screenshot", name: "form.png", inline: null } });
    expect(res.data!.editBase).not.toBe(editBase);
    expect(res.data!.editBase).toBe((await viewerOf("DRF-1")).editBase);
  });

  it("refuses a base the draft has moved from, before anything is stored", async () => {
    await create({ title: "Uploads" });
    const { editBase } = await viewerOf("DRF-1");
    expect((await upload("DRF-1", { base: editBase, ...file })).status).toBe(200);
    const stale = await upload("DRF-1", { base: editBase, ...file, fileName: "other.png" });
    expect(stale).toMatchObject({ status: 409, error: { code: "draft_changed" } });
    expect(h.uploads).toHaveLength(1);
  });

  it("is the author's alone, and needs a base", async () => {
    await create({ title: "Uploads" });
    const { editBase } = await viewerOf("DRF-1");
    expect(await upload("DRF-1", file)).toMatchObject({ status: 400 });
    signIn(RICARDO);
    expect(await upload("DRF-1", { base: editBase, ...file })).toMatchObject({ status: 403, error: { code: "not_draft_writer" } });
    expect(h.uploads).toHaveLength(0);
  });
});
