// Workstream notes (TASK-3953): exit-code contract for scripts/workstream-note.mjs.
// The broken-index case runs in a throwaway git repo under os.tmpdir(); the clean
// case checks this repository's own docs/workstreams/.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/workstream-note.mjs");

function run(cwd: string, args: string[], input = "") {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
}

describe("scripts/workstream-note.mjs", () => {
  it("check --strict passes on this repo's index and notes", () => {
    const result = run(root, ["check", "--strict"]);
    expect(result.stdout).toContain("index and notes agree");
    expect(result.status).toBe(0);
  });

  it("check --strict exits 1 on an unindexed note and only reports without --strict", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workstream-note-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      mkdirSync(path.join(dir, "docs/workstreams"), { recursive: true });
      copyFileSync(path.join(root, "docs/workstreams/README.md"), path.join(dir, "docs/workstreams/README.md"));
      writeFileSync(path.join(dir, "docs/workstreams/orphan.md"), "# Orphan\n\n## Goal\n\nx\n");
      const strict = run(dir, ["check", "--strict"]);
      expect(strict.status).toBe(1);
      expect(strict.stdout).toContain("orphan.md: no row in the index");
      expect(run(dir, ["check"]).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hooks never fail a session: stop and session-start exit 0 outside a workstream repo", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "workstream-note-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      expect(run(dir, ["session-start"]).status).toBe(0);
      expect(run(dir, ["stop"], "not json").status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
