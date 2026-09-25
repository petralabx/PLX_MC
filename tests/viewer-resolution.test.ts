// Wave 2 — UI trust: GET /api/viewer names the signed-in human from the Entra
// session. A directory member resolves to their record; an unlisted email gets
// a viewer built from the session (never another person); no session → null;
// dormant (no-OIDC) mode → the operator, explicitly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  oidc: true,
  session: null as { user?: { email?: string | null; name?: string | null } } | null,
  fail: false,
  calls: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("undecodable session");
    return state.session;
  },
  oidcEnabled: () => state.oidc,
}));

import { GET } from "@/app/api/viewer/route";
import { DORMANT_OPERATOR_ID, resolveViewer } from "@/lib/api/session-actor";
import { HUMANS } from "@/lib/mc-data";

beforeEach(() => {
  state.oidc = true;
  state.session = null;
  state.fail = false;
  state.calls = 0;
});

describe("resolveViewer", () => {
  it("OIDC: a directory member resolves to their directory record", async () => {
    state.session = { user: { email: "Greg.M@PetraSoap.com", name: "Greg Mitchell" } };
    expect(await resolveViewer()).toEqual(HUMANS.greg);
  });

  it("OIDC: an unlisted email gets a session-built viewer, never another person", async () => {
    state.session = { user: { email: " Jane.Doe@petrasoap.com ", name: "Jane Doe" } };
    const viewer = await resolveViewer();
    expect(viewer).toEqual({
      id: "jane.doe@petrasoap.com",
      kind: "human",
      name: "Jane Doe",
      init: "JD",
      role: "Contributor",
      online: true,
      email: "jane.doe@petrasoap.com",
    });
    expect(Object.keys(HUMANS)).not.toContain(viewer!.id);
  });

  it("OIDC: an unlisted session without a name falls back to the email", async () => {
    state.session = { user: { email: "ops-bot@petralabx.com", name: null } };
    const viewer = await resolveViewer();
    expect(viewer?.id).toBe("ops-bot@petralabx.com");
    expect(viewer?.name).toBe("ops-bot");
    expect(viewer?.init).toBe("OP");
  });

  it("OIDC: no session (or no email on it) resolves to nobody", async () => {
    expect(await resolveViewer()).toBeNull();
    state.session = { user: { email: null, name: "Nameless" } };
    expect(await resolveViewer()).toBeNull();
  });

  it("OIDC: an unreadable session resolves to nobody", async () => {
    state.fail = true;
    expect(await resolveViewer()).toBeNull();
  });

  it("dormant mode: the operator stands in, and no session is read", async () => {
    state.oidc = false;
    state.session = { user: { email: "greg.m@petrasoap.com" } };
    const viewer = await resolveViewer();
    expect(DORMANT_OPERATOR_ID).toBe("vince");
    expect(viewer).toEqual(HUMANS[DORMANT_OPERATOR_ID]);
    expect(state.calls).toBe(0);
  });
});

describe("GET /api/viewer", () => {
  it("returns the resolved viewer in the standard envelope", async () => {
    state.session = { user: { email: "ross@petrasoap.com" } };
    const res = await GET(new Request("http://localhost/api/viewer"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { viewer: HUMANS.ross } });
  });

  it("returns viewer: null (not a fallback person) without a session", async () => {
    const res = await GET(new Request("http://localhost/api/viewer"), { params: Promise.resolve({}) });
    expect(await res.json()).toEqual({ data: { viewer: null } });
  });
});
