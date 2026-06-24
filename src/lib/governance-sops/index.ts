// governance-sops (MC-SOP-Guide) domain module barrel.
// All consumers must import through this file — not internal module files.

export type {
  MdInline,
  MdListItem,
  MdNode,
  SopDegradedReason,
  SopDetailResult,
  SopRegistryConfig,
  SopRegistryEntry,
  SopSource,
  SopSourceReader,
  SopSourceResult,
  SopState,
  SopStatus,
  SopSummaryRow,
  TableAlign,
  TocEntry,
} from "./types";

export type { SopRegistryParseResult } from "./registry";
export { parseSopRegistryConfig, parseSopRegistryJson } from "./registry";

export { extractToc, inlineToText, parseInline, parseMarkdown } from "./markdown";

export { LocalFsSopSource, createSopSource } from "./source";

export { getSopDetail, listSopSummaries } from "./loader";
