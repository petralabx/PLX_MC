// SOP source reader — reads repo-canonical markdown from the local work tree.
// Server-only (node:fs). The loader takes a SopSourceReader so tests can inject
// a fake without touching the filesystem (mirrors loop-ledgers' source seam).

import { readFile } from "node:fs/promises";
import { join, normalize, resolve, sep } from "node:path";

import type { SopSourceReader, SopSourceResult } from "./types";

export class LocalFsSopSource implements SopSourceReader {
  private readonly root: string;

  constructor(root: string = process.cwd()) {
    this.root = resolve(root);
  }

  async read(repoPath: string): Promise<SopSourceResult> {
    // Reject path traversal — a registry path must stay inside the repo root.
    if (repoPath.includes("..")) {
      return { ok: false, reason: "read_error", note: `rejected path with '..': ${repoPath}` };
    }
    const abs = join(this.root, normalize(repoPath));
    if (abs !== this.root && !abs.startsWith(this.root + sep)) {
      return { ok: false, reason: "read_error", note: `path escapes repo root: ${repoPath}` };
    }

    let content: string;
    try {
      content = await readFile(abs, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { ok: false, reason: "source_missing", note: `SOP source not found: ${repoPath}` };
      }
      return {
        ok: false,
        reason: "read_error",
        note: `failed to read ${repoPath}: ${(err as Error).message}`,
      };
    }

    if (content.trim() === "") {
      return { ok: false, reason: "source_empty", note: `SOP source is empty: ${repoPath}` };
    }
    return { ok: true, content };
  }
}

export function createSopSource(): SopSourceReader {
  return new LocalFsSopSource();
}
