// Types for the governance-sops (MC-SOP-Guide) domain module.
// Read-only doctrine lens: a JSON registry points at repo-canonical SOP markdown;
// the loader reads + validates + parses it for the MC UI. Consumers must import
// through the barrel (src/lib/governance-sops/index.ts).

// ─── Editorial status (badge) vs availability state (can we render it) ────────

/** Editorial status of an SOP, shown as a badge. */
export type SopStatus = "active" | "draft" | "superseded" | "planned";

/**
 * Availability state, derived by the loader:
 *  - "ready"    → source present + readable (rendered in the reader)
 *  - "planned"  → no source yet (calm "coming soon" row)
 *  - "degraded" → source configured but missing/empty/unreadable (loud row)
 */
export type SopState = "ready" | "planned" | "degraded";

/** Loud reason codes for a degraded SOP source. */
export type SopDegradedReason = "source_missing" | "source_empty" | "read_error";

// ─── Registry (plx-governance-sops-registry/v1) ───────────────────────────────

export interface SopSource {
  /** Repo-relative path to the SOP markdown, e.g. "docs/COLLABORATOR-SOP.md". */
  repo_path: string;
}

export interface SopRegistryEntry {
  slug: string;
  title: string;
  description: string;
  audience: string;
  owner: string;
  /** ISO date (YYYY-MM-DD). */
  effective_date: string;
  /** ISO date (YYYY-MM-DD); optional. */
  last_reviewed?: string;
  status: SopStatus;
  /** Category tags (Collaborator, Agent workflow, Repo hygiene, Compliance gate, Rollback…). */
  tags: string[];
  /** Omitted for a "planned"/coming-soon entry; set once content is wired. */
  source?: SopSource;
}

export interface SopRegistryConfig {
  schema_version: "plx-governance-sops-registry/v1";
  sops: SopRegistryEntry[];
}

// ─── Source adapter result (server-only read) ─────────────────────────────────

export type SopSourceResult =
  | { ok: true; content: string }
  | { ok: false; reason: SopDegradedReason; note: string };

/** Reads SOP markdown by repo-relative path. Injected for testability. */
export interface SopSourceReader {
  read(repoPath: string): Promise<SopSourceResult>;
}

// ─── Markdown token tree (rendered by the UI with PLX `gs-` styles) ───────────

export type MdInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MdInline[] };

export interface MdListItem {
  /** null = a normal bullet; true/false = a GitHub task-list checkbox. */
  checked: boolean | null;
  /** Inline content of the item's first line. */
  lead: MdInline[];
  /** Nested blocks (sub-lists, code, paragraphs) under the item. */
  children: MdNode[];
}

export type MdNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: MdInline[]; id: string }
  | { type: "paragraph"; text: MdInline[] }
  | { type: "list"; ordered: boolean; items: MdListItem[] }
  | { type: "table"; headers: MdInline[][]; align: TableAlign[]; rows: MdInline[][][] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "blockquote"; children: MdNode[] }
  | { type: "hr" };

export type TableAlign = "left" | "center" | "right" | null;

// ─── Loader output ────────────────────────────────────────────────────────────

export interface SopSummaryRow {
  meta: SopRegistryEntry;
  state: SopState;
  /** Set when state="degraded". */
  reason?: SopDegradedReason;
  /** Human-readable explanation for degraded/planned rows. */
  note?: string;
}

export interface TocEntry {
  id: string;
  text: string;
  level: number;
}

export type SopDetailResult =
  | {
      ok: true;
      meta: SopRegistryEntry;
      nodes: MdNode[];
      toc: TocEntry[];
      /** Byte length of the source (shown in the folio strip). */
      bytes: number;
    }
  | {
      ok: false;
      meta: SopRegistryEntry;
      /** "planned" is calm; the SopDegradedReason values are loud. */
      reason: SopDegradedReason | "planned";
      note: string;
    };
