import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MCP_AGENT_SERVICE_PRINCIPAL_IDS,
  PORTAL_MCP_SERVICE_PRINCIPAL_ID,
  authorize,
  capabilitiesForServicePrincipal,
} from "@/lib/permissions";

const httpMcpSource = readFileSync(
  join(process.cwd(), "src/lib/mcp/create-http-server.ts"),
  "utf8"
);
const stdioMcpSource = readFileSync(
  join(process.cwd(), "tools/plx-mc-mcp/index.ts"),
  "utf8"
);

describe("MCP project and bucket creation capability", () => {
  it("registers project and bucket creation in both MCP transports", () => {
    for (const tool of ["mc_create_project", "mc_create_bucket", "mc_update_bucket", "mc_list_buckets"]) {
      expect(httpMcpSource).toContain(`"${tool}"`);
      expect(stdioMcpSource).toContain(`"${tool}"`);
    }
  });

  it("registers project status tools in both MCP transports", () => {
    const projectActionsSource = readFileSync(
      join(process.cwd(), "src/lib/mcp/project-actions.ts"),
      "utf8"
    );
    for (const tool of ["mc_update_project", "mc_list_projects"]) {
      expect(projectActionsSource).toContain(`"${tool}"`);
      expect(stdioMcpSource).toContain(`"${tool}"`);
    }
  });

  it("provides authenticated cursor API routes for the stdio transport", () => {
    expect(
      existsSync(join(process.cwd(), "src/app/api/cursor/projects/route.ts"))
    ).toBe(true);
    expect(
      existsSync(join(process.cwd(), "src/app/api/cursor/buckets/route.ts"))
    ).toBe(true);
  });

  it("grants project and bucket creation to every full-bundle MCP agent principal", () => {
    // sp_mcp_portal holds a least-privilege grant (decision CG-07b).
    for (const principalId of MCP_AGENT_SERVICE_PRINCIPAL_IDS.filter(
      (id) => id !== PORTAL_MCP_SERVICE_PRINCIPAL_ID
    )) {
      const capabilities = capabilitiesForServicePrincipal(principalId);
      expect(capabilities).toEqual(
        expect.arrayContaining(["project.create", "bucket.create", "bucket.update"])
      );
      expect(
        authorize({
          actor: { kind: "service", id: principalId, status: "active" },
          capability: "project.create",
        }).allowed
      ).toBe(true);
      expect(
        authorize({
          actor: { kind: "service", id: principalId, status: "active" },
          capability: "bucket.create",
        }).allowed
      ).toBe(true);
      expect(
        authorize({
          actor: { kind: "service", id: principalId, status: "active" },
          capability: "bucket.update",
        }).allowed
      ).toBe(true);
    }
  });

  it("registers dedicated Cursor, Claude, Grok, and Hermes principals", () => {
    expect(MCP_AGENT_SERVICE_PRINCIPAL_IDS).toEqual(
      expect.arrayContaining([
        "sp_mcp_cursor",
        "sp_mcp_claude_code",
        "sp_mcp_grok",
        "sp_mcp_hermes",
      ])
    );
  });

  it("denies project and bucket actions to sp_mcp_portal", () => {
    for (const capability of ["project.create", "bucket.create", "bucket.update"]) {
      expect(
        authorize({
          actor: { kind: "service", id: PORTAL_MCP_SERVICE_PRINCIPAL_ID, status: "active" },
          capability,
        }).allowed
      ).toBe(false);
    }
  });

  it("keeps the reviewed principal registry in parity with durable migrations", () => {
    const migrationDir = join(process.cwd(), "db/migrations");
    const migrationSql = readdirSync(migrationDir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(migrationDir, name), "utf8"))
      .join("\n");

    for (const principalId of MCP_AGENT_SERVICE_PRINCIPAL_IDS) {
      expect(migrationSql).toContain(`'${principalId}'`);
    }
  });
});
