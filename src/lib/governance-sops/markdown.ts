// Dependency-free markdown → token-tree parser for the SOP reader.
//
// Scope: the constructs SOP doctrine uses — headings, paragraphs, ordered/
// unordered lists (incl. GitHub task-list checkboxes and one level of nesting),
// GFM tables, fenced code, blockquote callouts, thematic breaks, and inline
// strong / em / code / link. It is intentionally NOT a full CommonMark engine.
//
// Safety: this emits a token tree only. The UI renders each node through React
// (which escapes text), so no raw HTML is ever injected — there is no
// dangerouslySetInnerHTML of source content anywhere downstream.
//
// Pure + server-unit-testable: no DOM, no I/O. Consumers import via the barrel.

import type { MdInline, MdListItem, MdNode, TableAlign, TocEntry } from "./types";

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseMarkdown(raw: string): MdNode[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const nodes = parseBlocks(lines);
  ensureUniqueHeadingIds(nodes);
  return nodes;
}

/** Build a table-of-contents from level-2 and level-3 headings. */
export function extractToc(nodes: MdNode[]): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const n of nodes) {
    if (n.type === "heading" && n.level >= 2 && n.level <= 3) {
      toc.push({ id: n.id, text: inlineToText(n.text), level: n.level });
    }
  }
  return toc;
}

// ─── Block parser ─────────────────────────────────────────────────────────────

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const RE_FENCE = /^(\s*)(```+|~~~+)\s*([^\s`~]*)\s*$/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const RE_BLOCKQUOTE = /^\s*>/;

function parseBlocks(lines: string[]): MdNode[] {
  const nodes: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code
    const fence = line.match(RE_FENCE);
    if (fence) {
      const indent = fence[1].length;
      const marker = fence[2][0];
      const lang = fence[3] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${marker === "`" ? "`" : "~"}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i].slice(indent));
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      nodes.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    // Heading
    const h = line.match(RE_HEADING);
    if (h) {
      const level = Math.min(h[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      const text = parseInline(h[2]);
      nodes.push({ type: "heading", level, text, id: slugify(inlineToText(text)) });
      i++;
      continue;
    }

    // Thematic break
    if (RE_HR.test(line)) {
      nodes.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote / callout
    if (RE_BLOCKQUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && RE_BLOCKQUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      nodes.push({ type: "blockquote", children: parseBlocks(inner) });
      continue;
    }

    // Table: a header row with a pipe, followed by a delimiter row
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      const headers = splitRow(line).map(parseInline);
      const align = parseAligns(lines[i + 1]);
      i += 2;
      const rows: MdInline[][][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]).map(parseInline));
        i++;
      }
      nodes.push({ type: "table", headers, align, rows });
      continue;
    }

    // List (ordered or unordered)
    if (RE_LIST.test(line)) {
      const { node, next } = parseList(lines, i);
      nodes.push(node);
      i = next;
      continue;
    }

    // Paragraph: consume until a blank line or a new block starter
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !RE_HEADING.test(lines[i]) &&
      !RE_HR.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !RE_BLOCKQUOTE.test(lines[i]) &&
      !RE_LIST.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i++;
    }
    nodes.push({ type: "paragraph", text: parseInline(para.join(" ")) });
  }

  return nodes;
}

function parseList(lines: string[], start: number): { node: MdNode; next: number } {
  const ordered = /^\s*\d+[.)]\s/.test(lines[start]);
  const items: MdListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(RE_LIST);
    if (!m) break;
    const contentCol = m[1].length + m[2].length + m[3].length;
    let rest = m[4];

    // Task-list checkbox
    let checked: boolean | null = null;
    const cb = rest.match(/^\[([ xX])\]\s+(.*)$/);
    if (cb) {
      checked = cb[1].toLowerCase() === "x";
      rest = cb[2];
    }

    // Collect indented continuation lines (nested blocks belong to this item)
    const childLines: string[] = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") {
        childLines.push("");
        i++;
        continue;
      }
      const lead = l.match(/^(\s*)/)![1].length;
      if (lead >= contentCol) {
        childLines.push(l.slice(contentCol));
        i++;
        continue;
      }
      break; // dedented line → next item at this level, or end of list
    }
    while (childLines.length && childLines[childLines.length - 1].trim() === "") childLines.pop();

    items.push({
      checked,
      lead: parseInline(rest),
      children: childLines.length ? parseBlocks(childLines) : [],
    });
  }

  return { node: { type: "list", ordered, items }, next: i };
}

// ─── Tables ───────────────────────────────────────────────────────────────────

function isTableDelimiter(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  // Note: a literal "|" inside a cell is not supported (SOP tables don't use one).
  return s.split("|").map((c) => c.trim());
}

function parseAligns(delim: string): TableAlign[] {
  let s = delim.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => {
    const t = c.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

// ─── Inline parser ────────────────────────────────────────────────────────────

export function parseInline(src: string): MdInline[] {
  const out: MdInline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };

  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const m = src.slice(i).match(/^(`+)([\s\S]*?)\1(?!`)/);
      if (m) {
        flush();
        out.push({ type: "code", value: m[2].trim() });
        i += m[0].length;
        continue;
      }
    }

    if (c === "[") {
      const m = src.slice(i).match(/^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (m) {
        flush();
        out.push({ type: "link", href: m[2], children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    if (src.startsWith("**", i) || src.startsWith("__", i)) {
      const marker = src.slice(i, i + 2);
      const re = marker === "**" ? /^\*\*([\s\S]+?)\*\*/ : /^__([\s\S]+?)__/;
      const m = src.slice(i).match(re);
      if (m) {
        flush();
        out.push({ type: "strong", children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    if (c === "*" || c === "_") {
      const re = c === "*" ? /^\*([^*\s][\s\S]*?)\*/ : /^_([^_\s][\s\S]*?)_/;
      const m = src.slice(i).match(re);
      if (m) {
        flush();
        out.push({ type: "em", children: parseInline(m[1]) });
        i += m[0].length;
        continue;
      }
    }

    buf += c;
    i++;
  }

  flush();
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function inlineToText(nodes: MdInline[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.value;
      if (n.type === "code") return n.value;
      return inlineToText(n.children);
    })
    .join("");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function ensureUniqueHeadingIds(nodes: MdNode[]): void {
  const seen = new Map<string, number>();
  for (const n of nodes) {
    if (n.type !== "heading") continue;
    const base = n.id || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    n.id = count === 0 ? base : `${base}-${count}`;
  }
}
