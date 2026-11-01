// Mission Control text (TASK-4390): descriptions, status notes and approval
// summaries written as plain text with a little markdown. Client-safe: no
// I/O, no server-only imports. Module contract: docs/modules/mc-text/README.md.

import { parseMarkdown } from "@/lib/governance-sops/markdown";
import type { MdNode } from "@/lib/governance-sops/types";

export { gateLabel, MC_HOST, pathRef, splitRefs, urlLabel, type McRef } from "./refs";
export type { MdInline, MdListItem, MdNode } from "@/lib/governance-sops/types";

/** The text's blocks. A single line break inside a paragraph stays one. */
export function parseMcText(raw: string): MdNode[] {
  return parseMarkdown(raw, { breaks: true });
}
