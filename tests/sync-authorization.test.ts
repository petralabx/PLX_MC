// P4: sync.mutate (session) + sync.service.write (cron) authorization.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/route";
import { authorize, SYNC_INBOUND_SERVICE_PRINCIPAL_ID } from "@/lib/permissions";

const authState = vi.hoisted(() => ({
  session: null as { user?: { oid?: string | null; email?: string | null } } | null,
  user: null as { entraOid: string; accessRole: "owner" | "admin" | "member"; status: "active" | "revoked" } | null,
  service: null as { id: string; name: string; status: "active" | "revoked" } | null,
  serviceLookups: 0,
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => authState.session,
}));

vi.mock("@/lib/permissions/repository", () => ({
  findMcUserByEntraOid: async (oid: string) =>
    authState.user && authState.user.entraOid === oid
      ? {
          id: "u1",
          entraOid: authState.user.entraOid,
          email: "vince@petrasoap.com",
          displayName: "Vince",
          accessRole: authState.user.accessRole,
          status: authState.user.status,
        }
      : null,
  findServicePrincipalById: async (id: string) => {
    authState.serviceLookups += 1;
    return authState.service?.id === id ? authState.service : null;
  },
}));

vi.mock("@/lib/permissions/decision-log", () => ({
  recordPermissionDecision: vi.fn(async () => true),
}));

import { requireSyncMutateActor, requireSyncServiceWrite } from "@/lib/sync/engine";

beforeEach(() => {
  authState.session = null;
  authState.user = null;
  authState.service = null;
  authState.serviceLookups = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function enableEnforcement() {
  vi.stubEnv("PLX_MC_PERMISSIONS_ENFORCEMENT_ENABLED", "1");
}

describe("requireSyncMutateActor (session)", () => {
  it("allows admin session oid and ignores any caller-supplied actor concept", async () => {
    authState.session = { user: { oid: "entra-admin-1", email: "admin@petrasoap.com" } };
    const { oid, actor } = await requireSyncMutateActor();
    expect(oid).toBe("entra-admin-1");
    expect(actor.kind).toBe("human");
    expect(authorize({ actor, capability: "sync.mutate", resource: { type: "sync" } }).allowed).toBe(
      true
    );
  });

  it("denies when session has no oid", async () => {
    authState.session = { user: { email: "x@petrasoap.com" } };
    await expect(requireSyncMutateActor()).rejects.toBeInstanceOf(ApiError);
    try {
      await requireSyncMutateActor();
    } catch (err) {
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).code).toBe("forbidden");
    }
  });

  it("denies member role when enforcement hydrates a member (no sync.mutate)", async () => {
    enableEnforcement();
    authState.session = { user: { oid: "entra-member-1" } };
    authState.user = { entraOid: "entra-member-1", accessRole: "member", status: "active" };
    await expect(requireSyncMutateActor()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("allows owner/admin when enforcement hydrates grants", async () => {
    enableEnforcement();
    authState.session = { user: { oid: "entra-owner-1" } };
    authState.user = { entraOid: "entra-owner-1", accessRole: "owner", status: "active" };
    const { oid } = await requireSyncMutateActor();
    expect(oid).toBe("entra-owner-1");
  });
});

describe("requireSyncServiceWrite (cron / inbound)", () => {
  it("allows active durable sp_sync_inbound when enforcement is enabled", async () => {
    enableEnforcement();
    authState.service = {
      id: SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
      name: "SharePoint inbound sync",
      status: "active",
    };
    const actor = await requireSyncServiceWrite({ operatorContext: "ignored@example.com" });
    expect(actor).toEqual({
      kind: "service",
      id: SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
      status: "active",
    });
    expect(
      authorize({ actor, capability: "sync.service.write", resource: { type: "sync" } }).allowed
    ).toBe(true);
  });

  it("denies missing or revoked persisted service principal when enforcement is enabled", async () => {
    enableEnforcement();
    await expect(requireSyncServiceWrite()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });

    authState.service = {
      id: SYNC_INBOUND_SERVICE_PRINCIPAL_ID,
      name: "SharePoint inbound sync",
      status: "revoked",
    };
    await expect(requireSyncServiceWrite()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  it("flag-off remains DB-free and operator context cannot affect grants", async () => {
    const actor = await requireSyncServiceWrite({
      operatorContext: "owner@petrasoap.com",
    });
    expect(actor.id).toBe(SYNC_INBOUND_SERVICE_PRINCIPAL_ID);
    expect(authState.serviceLookups).toBe(0);
  });

  it("service principal cannot use sync.mutate", async () => {
    const actor = await requireSyncServiceWrite();
    expect(authorize({ actor, capability: "sync.mutate", resource: { type: "sync" } }).allowed).toBe(
      false
    );
  });

  it("unknown service principal is denied", () => {
    expect(
      authorize({
        actor: { kind: "service", id: "sp_unknown", status: "active" },
        capability: "sync.service.write",
        resource: { type: "sync" },
      }).allowed
    ).toBe(false);
  });
});
