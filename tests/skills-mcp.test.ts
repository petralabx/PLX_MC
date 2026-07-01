import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(async () => undefined),
  eventsAfter: vi.fn(async () => [{ seq: "evt-1" }]),
}));

vi.mock("@/lib/compliance/repo", () => ({
  appendEvent: mocks.appendEvent,
  eventsAfter: mocks.eventsAfter,
}));

vi.mock("@/lib/github-app", () => ({
  resolveGithubToken: vi.fn(async () => "test-token"),
}));

vi.stubEnv("PLX_MC_MCP_ENABLED", "1");
vi.stubEnv("PLX_MC_MCP_API_KEY", "test-mcp-key");
vi.stubEnv("PLX_MC_ALLOWED_USERS", "vince@petrasoap.com");
vi.stubEnv("PLX_MC_PUBLIC_URL", "https://mc.plxcustomer.io");
vi.stubEnv("PLX_MC_DATABASE_URL", "");

import { POST as installSkills } from "@/app/api/cursor/skills/install/route";
import { GET as listSkills } from "@/app/api/cursor/skills/list/route";
import { POST as submitSkill } from "@/app/api/cursor/skills/submit/route";
import { POST as syncSkills } from "@/app/api/cursor/skills/sync/route";

const manifestText = readFileSync(
  join(process.cwd(), "tests/fixtures/skills-directory/manifest.json"),
  "utf8"
);
const httpMcpSource = readFileSync(
  join(process.cwd(), "src/lib/mcp/create-http-server.ts"),
  "utf8"
);
const stdioMcpSource = readFileSync(
  join(process.cwd(), "tools/plx-mc-mcp/index.ts"),
  "utf8"
);
const ctx = { params: Promise.resolve({} as Record<string, string>) };

function headers(): HeadersInit {
  return {
    "x-api-key": "test-mcp-key",
    "x-mc-operator-email": "vince@petrasoap.com",
    "x-mc-repo": "taylorvalton/PLX_MC",
    "x-mc-runtime": "cursor",
    "x-mc-worker-id": "skills-test",
  };
}

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
}

describe("cursor skills MCP proxies", () => {
  beforeEach(() => {
    mocks.appendEvent.mockClear();
    mocks.eventsAfter.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(manifestText, { status: 200 }))
    );
  });

  it("wraps GET catalog in an MCP envelope", async () => {
    const resp = await listSkills(
      new Request("http://localhost/api/cursor/skills/list", { headers: headers() }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.meta.state).toBe("ready");
    expect(body.data.skills.map((s: { id: string }) => s.id)).toEqual([
      "create-skill",
      "wterm-preflight",
    ]);
    expect(body.data.meta.catalogVersion).toBe("1.0.0-test");
    expect(body.meta.audit.kinds).toContain("mc_skills_list");
  });

  it("filters MCP catalog lists by query, tag, and status", async () => {
    const resp = await listSkills(
      new Request("http://localhost/api/cursor/skills/list?q=preflight&tag=ci&status=published", {
        headers: headers(),
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.skills.map((s: { id: string }) => s.id)).toEqual(["wterm-preflight"]);
    expect(body.data.meta.catalogVersion).toBe("1.0.0-test");
  });

  it("returns generated install scripts through the MCP install proxy", async () => {
    const resp = await installSkills(
      post("http://localhost/api/cursor/skills/install", { mode: "install" }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.installSkillIds).toEqual(["create-skill", "wterm-preflight"]);
    expect(body.data.scripts.bash).toContain("plx-cursor-skills");
    expect(body.data.scripts.powershell).toContain("$InstallIds");
    expect(body.meta.audit.kinds).toContain("mc_skills_install");
  });

  it("honors MCP install ids, runtimes, and projectRoot", async () => {
    const resp = await installSkills(
      post("http://localhost/api/cursor/skills/install", {
        ids: ["create-skill"],
        runtimes: ["cursor"],
        projectRoot: "C:/work/project",
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.installSkillIds).toEqual(["create-skill"]);
    expect(body.data.runtimes).toEqual(["cursor"]);
    expect(body.data.projectRoot).toBe("C:/work/project");
    expect(body.data.scripts.powershell).toContain("$Runtimes = @('cursor')");
  });

  it("reports missing skills through the MCP sync proxy", async () => {
    const resp = await syncSkills(
      post("http://localhost/api/cursor/skills/sync", {
        localRegistry: {
          schemaVersion: "agentic-skills-registry.v1",
          catalogVersion: "1.0.0-test",
          gitRef: "v1.0.0-test",
          packageId: "plx-engineering-core",
          syncedAt: "2026-06-30T12:00:00.000Z",
          skills: [{ id: "create-skill", contentSha: "x" }],
        },
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.missingSkillIds).toEqual(["wterm-preflight"]);
    expect(body.data.installSkillIds).toEqual(["wterm-preflight"]);
    expect(body.data.runtimes).toEqual(["cursor", "claude"]);
  });

  it("creates skill submissions through the MCP submit proxy", async () => {
    const resp = await submitSkill(
      post("http://localhost/api/cursor/skills/submit", {
        skillId: "create-skill",
        title: "Add example",
        description: "Example request",
        submitterEmail: "vince@petrasoap.com",
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.id).toMatch(/^skill-sub-/);
    expect(body.data.status).toBe("pending");
    expect(body.meta.audit.kinds).toContain("mc_skills_submit");
  });

  it("accepts direct MCP skill submission payloads", async () => {
    const resp = await submitSkill(
      post("http://localhost/api/cursor/skills/submit", {
        id: "new-skill",
        name: "New Skill",
        description: "New skill request",
        skillMd: "# New Skill\n\nUse this skill when testing.",
        tags: ["testing"],
        owner: "platform-team",
      }),
      ctx
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.data.skillId).toBe("new-skill");
    expect(body.data.title).toBe("New Skill");
    expect(body.data.submitterEmail).toBe("vince@petrasoap.com");
    expect(body.data.notes).toContain("Owner: platform-team");
    expect(body.data.notes).toContain("# New Skill");
  });

  it("registers skills tools in both MCP transports", () => {
    for (const tool of ["mc_list_skills", "mc_install_skills", "mc_sync_skills", "mc_submit_skill"]) {
      expect(httpMcpSource).toContain(`"${tool}"`);
      expect(stdioMcpSource).toContain(`"${tool}"`);
    }
  });
});
