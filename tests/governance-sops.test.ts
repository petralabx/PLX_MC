// Domain tests for governance-sops (MC-SOP-Guide): registry parse, the
// dependency-free markdown parser, loader state derivation, and a seed
// integration check that the committed registry + Collaborator SOP load.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSopSource,
  extractToc,
  getSopDetail,
  inlineToText,
  listSopSummaries,
  parseInline,
  parseMarkdown,
  parseSopRegistryJson,
} from "@/lib/governance-sops";
import type {
  MdNode,
  SopRegistryEntry,
  SopSourceReader,
  SopSourceResult,
} from "@/lib/governance-sops";

function fakeSource(map: Record<string, SopSourceResult>): SopSourceReader {
  return {
    async read(p: string) {
      return map[p] ?? { ok: false, reason: "source_missing", note: `missing ${p}` };
    },
  };
}

const VALID_REGISTRY = JSON.stringify({
  schema_version: "plx-governance-sops-registry/v1",
  sops: [
    {
      slug: "a-ready",
      title: "Alpha",
      description: "d",
      audience: "ops",
      owner: "Vince",
      effective_date: "2026-06-01",
      status: "active",
      tags: ["X"],
      source: { repo_path: "docs/a.md" },
    },
    {
      slug: "z-planned",
      title: "Zeta",
      description: "d",
      audience: "ops",
      owner: "Vince",
      effective_date: "2026-06-01",
      status: "planned",
      tags: [],
    },
  ],
});

describe("governance-sops registry", () => {
  it("parses a valid registry", () => {
    const r = parseSopRegistryJson(VALID_REGISTRY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.sops).toHaveLength(2);
  });

  it("rejects a wrong schema_version", () => {
    const r = parseSopRegistryJson(JSON.stringify({ schema_version: "nope/v9", sops: [] }));
    expect(r.ok).toBe(false);
  });

  it("rejects duplicate slugs", () => {
    const dup = JSON.parse(VALID_REGISTRY);
    dup.sops[1].slug = "a-ready";
    const r = parseSopRegistryJson(JSON.stringify(dup));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate slug/);
  });

  it("never throws on garbage JSON", () => {
    expect(() => parseSopRegistryJson("{not json")).not.toThrow();
    expect(parseSopRegistryJson("{not json").ok).toBe(false);
  });
});

describe("markdown parser", () => {
  it("parses headings with stable, unique ids and a TOC", () => {
    const nodes = parseMarkdown("# Title\n\n## Part one\n\n## Part one\n");
    const headings = nodes.filter((n): n is Extract<MdNode, { type: "heading" }> => n.type === "heading");
    expect(headings.map((h) => h.id)).toEqual(["title", "part-one", "part-one-1"]);
    const toc = extractToc(nodes);
    expect(toc.map((t) => t.text)).toEqual(["Part one", "Part one"]);
  });

  it("parses a GFM table with alignment", () => {
    const md = "| Repo | Mode |\n|---|:---:|\n| PLX_MC | hard |\n| swarm | soft |\n";
    const table = parseMarkdown(md).find((n) => n.type === "table");
    expect(table).toBeDefined();
    if (table && table.type === "table") {
      expect(table.headers).toHaveLength(2);
      expect(table.align[1]).toBe("center");
      expect(table.rows).toHaveLength(2);
      expect(inlineToText(table.rows[0][0])).toBe("PLX_MC");
    }
  });

  it("parses task-list checkboxes", () => {
    const list = parseMarkdown("- [x] done\n- [ ] todo\n").find((n) => n.type === "list");
    expect(list && list.type === "list").toBe(true);
    if (list && list.type === "list") {
      expect(list.items[0].checked).toBe(true);
      expect(list.items[1].checked).toBe(false);
    }
  });

  it("parses fenced code with a language", () => {
    const code = parseMarkdown("```bash\nnpm run dev\n```\n").find((n) => n.type === "code");
    expect(code).toBeDefined();
    if (code && code.type === "code") {
      expect(code.lang).toBe("bash");
      expect(code.value).toBe("npm run dev");
    }
  });

  it("parses a blockquote callout", () => {
    const bq = parseMarkdown("> **TL;DR** be loud\n").find((n) => n.type === "blockquote");
    expect(bq && bq.type === "blockquote").toBe(true);
  });

  it("parses inline strong/em/code/link and does not emit raw HTML", () => {
    const inline = parseInline("a **b** _c_ `d` [e](https://x.io) <script>");
    const types = inline.map((n) => n.type);
    expect(types).toContain("strong");
    expect(types).toContain("em");
    expect(types).toContain("code");
    expect(types).toContain("link");
    // The literal <script> stays a plain text value — never an HTML node.
    expect(inlineToText(inline)).toContain("<script>");
    expect(inline.every((n) => ["text", "strong", "em", "code", "link"].includes(n.type))).toBe(true);
  });

  it("captures a nested code block under a list item", () => {
    const md = "1. do this\n\n   ```bash\n   ls\n   ```\n";
    const list = parseMarkdown(md).find((n) => n.type === "list");
    if (list && list.type === "list") {
      const child = list.items[0].children.find((c) => c.type === "code");
      expect(child).toBeDefined();
    }
  });
});

describe("loader state derivation", () => {
  const config = parseSopRegistryJson(VALID_REGISTRY);
  const cfg = config.ok ? config.config : (() => { throw new Error("bad fixture"); })();

  it("derives ready / planned / degraded and orders degraded-first, planned-last", async () => {
    const src = fakeSource({ "docs/a.md": { ok: true, content: "# A\n" } });
    const rows = await listSopSummaries(cfg, src);
    const byState = Object.fromEntries(rows.map((r) => [r.meta.slug, r.state]));
    expect(byState["a-ready"]).toBe("ready");
    expect(byState["z-planned"]).toBe("planned");
    // planned sorts last
    expect(rows[rows.length - 1].meta.slug).toBe("z-planned");
  });

  it("marks a configured-but-missing source as degraded (loud), not hidden", async () => {
    const src = fakeSource({}); // a.md missing
    const rows = await listSopSummaries(cfg, src);
    const a = rows.find((r) => r.meta.slug === "a-ready");
    expect(a?.state).toBe("degraded");
    expect(a?.reason).toBe("source_missing");
    // degraded sorts first
    expect(rows[0].meta.slug).toBe("a-ready");
  });

  it("detail: ready returns nodes+toc; planned + missing return loud ok:false", async () => {
    const ready = cfg.sops.find((s) => s.slug === "a-ready") as SopRegistryEntry;
    const planned = cfg.sops.find((s) => s.slug === "z-planned") as SopRegistryEntry;
    const okSrc = fakeSource({ "docs/a.md": { ok: true, content: "# A\n\n## S\n\ntext\n" } });

    const d1 = await getSopDetail(ready, okSrc);
    expect(d1.ok).toBe(true);
    if (d1.ok) {
      expect(d1.nodes.length).toBeGreaterThan(0);
      expect(d1.toc.length).toBe(1);
      expect(d1.bytes).toBeGreaterThan(0);
    }

    const d2 = await getSopDetail(planned, okSrc);
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.reason).toBe("planned");

    const d3 = await getSopDetail(ready, fakeSource({}));
    expect(d3.ok).toBe(false);
    if (!d3.ok) expect(d3.reason).toBe("source_missing");
  });
});

describe("seed registry + Collaborator SOP (integration)", () => {
  it("the committed registry parses and seeds the Collaborator SOP as active", () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const collab = r.config.sops.find((s) => s.slug === "mc-sop-collaborator");
      expect(collab?.status).toBe("active");
      expect(collab?.source?.repo_path).toBe("docs/COLLABORATOR-SOP.md");
    }
  });

  it("loads + renders the real Collaborator SOP to a non-trivial node tree with a table", async () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    if (!r.ok) throw new Error("seed registry invalid");
    const collab = r.config.sops.find((s) => s.slug === "mc-sop-collaborator")!;
    const detail = await getSopDetail(collab, createSopSource());
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.nodes.length).toBeGreaterThan(5);
      expect(detail.toc.length).toBeGreaterThan(0);
      expect(detail.nodes.some((n) => n.type === "table")).toBe(true);
    }
  });

  it("loads + renders the real Skills SOP", async () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    if (!r.ok) throw new Error("seed registry invalid");
    const skills = r.config.sops.find((s) => s.slug === "mc-sop-skills")!;
    expect(skills.status).toBe("active");
    const detail = await getSopDetail(skills, createSopSource());
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.nodes.length).toBeGreaterThan(5);
      expect(detail.toc.some((h) => /install/i.test(h.text))).toBe(true);
    }
  });

  it("activates agent-PR, hygiene, and rollback SOPs with readable sources", async () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    if (!r.ok) throw new Error("seed registry invalid");
    const expected: Record<string, string> = {
      "mc-sop-agent-pr": "docs/AGENT-PR-SOP.md",
      "mc-sop-repo-hygiene": "docs/REPO_HYGIENE_SOP.md",
      "mc-sop-rollback": "docs/ROLLBACK-PLAN-SOP.md",
    };
    for (const [slug, path] of Object.entries(expected)) {
      const entry = r.config.sops.find((s) => s.slug === slug)!;
      expect(entry.status).toBe("active");
      expect(entry.source?.repo_path).toBe(path);
      const detail = await getSopDetail(entry, createSopSource());
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.nodes.length).toBeGreaterThan(5);
        expect(detail.toc.length).toBeGreaterThan(0);
      }
    }
  });

  it("activates human-mc SOP with docs/HUMAN-MC-SOP.md", async () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    if (!r.ok) throw new Error("seed registry invalid");
    const human = r.config.sops.find((s) => s.slug === "mc-sop-human-mc")!;
    expect(human.status).toBe("active");
    expect(human.source?.repo_path).toBe("docs/HUMAN-MC-SOP.md");
    const detail = await getSopDetail(human, createSopSource());
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.nodes.length).toBeGreaterThan(5);
      expect(detail.toc.length).toBeGreaterThan(0);
    }
  });

  it("renders agent, human, skills, rollback, and collaborator SOP sources", async () => {
    const raw = readFileSync(join(process.cwd(), "config/governance-sops-registry.json"), "utf8");
    const r = parseSopRegistryJson(raw);
    if (!r.ok) throw new Error("seed registry invalid");
    const slugs = [
      "mc-sop-agent-pr",
      "mc-sop-human-mc",
      "mc-sop-skills",
      "mc-sop-rollback",
      "mc-sop-collaborator",
    ] as const;
    for (const slug of slugs) {
      const entry = r.config.sops.find((s) => s.slug === slug)!;
      expect(entry.status).toBe("active");
      expect(entry.source?.repo_path).toBeTruthy();
      const detail = await getSopDetail(entry, createSopSource());
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.nodes.length).toBeGreaterThan(5);
        expect(detail.toc.length).toBeGreaterThan(0);
      }
    }
  });

  it("active SOPs contain petralabx, task.evidence, and petralabx/skills doctrine", () => {
    const checks: Record<string, { required: string[]; forbidden?: RegExp }> = {
      "docs/AGENT-PR-SOP.md": {
        required: ["petralabx", "task.evidence", "petralabx/skills"],
      },
      "docs/HUMAN-MC-SOP.md": {
        required: ["petralabx", "task.evidence"],
      },
      "docs/ROLLBACK-PLAN-SOP.md": {
        required: ["task.evidence"],
      },
      "docs/SKILLS-SOP.md": {
        required: ["petralabx/skills", "petralabx"],
        forbidden: /from \*\*`taylorvalton\/plx-cursor-skills`\*\*/i,
      },
    };
    for (const [path, { required, forbidden }] of Object.entries(checks)) {
      const content = readFileSync(join(process.cwd(), path), "utf8");
      for (const needle of required) {
        expect(content, `${path} missing ${needle}`).toContain(needle);
      }
      if (forbidden) {
        expect(content, `${path} presents legacy skills repo as primary install`).not.toMatch(forbidden);
      }
    }
    const skills = readFileSync(join(process.cwd(), "docs/SKILLS-SOP.md"), "utf8");
    const taylorPrimary = skills.match(
      /skills come\s+from\s+\*\*`taylorvalton\/plx-cursor-skills`\*\*/i,
    );
    expect(taylorPrimary).toBeNull();
  });
});
