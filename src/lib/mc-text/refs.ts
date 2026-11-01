// Mission Control references in plain text (TASK-4390): the ids, pull
// requests, gates and links an agent or a person writes in a description,
// split out so the renderer can make each one a link. Pure: a string in,
// typed pieces out, so it runs on the server and in unit tests alike.
//
// Order matters where two rules could claim the same text: a full URL wins
// over the id inside it (a Mission Control URL collapses to its chip, a
// GitHub pull-request URL to its short name), and an owner/repo#N reference
// wins over a bare word.

import { BARE_URL_SOURCE } from "@/lib/governance-sops/markdown";

export type McRef =
  | { kind: "text"; value: string }
  | { kind: "task"; id: string }
  | { kind: "project"; id: string }
  | { kind: "bucket"; id: string }
  | { kind: "draft"; id: string; version?: string }
  | { kind: "gate"; id: string; label: string }
  | { kind: "pr"; repo: string; number: number; label: string; href: string }
  | { kind: "url"; href: string; label: string };

/** The Mission Control host whose links collapse to chips. */
export const MC_HOST = "mc.plxcustomer.io";

const ID = String.raw`\b(TASK-\d{1,6}|DRF-\d{1,6})\b`;
// Project and bucket ids are cut at a fixed length, so a real one can end in a hyphen ("BKT-SESSION-NUDGE-DOOR-GROK-"): no \b at the end.
const BUCKET = String.raw`\b((?:BKT|PRJ)-[A-Z0-9][A-Z0-9-]{0,40})(?![A-Za-z0-9])`;
const URL_RE = BARE_URL_SOURCE;
const PR_REF = String.raw`(?<![\w./-])([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d{1,7})\b`;
const GATE = String.raw`\b(apg_[0-9a-f]{8,32})\b`;
const PATTERN = new RegExp(`(${URL_RE})|${PR_REF}|${GATE}|${ID}|${BUCKET}`, "g");

/** Trailing punctuation that ends a sentence, not the URL. */
function trimUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

function idRef(id: string): McRef {
  if (id.startsWith("TASK-")) return { kind: "task", id };
  if (id.startsWith("PRJ-")) return { kind: "project", id };
  if (id.startsWith("BKT-")) return { kind: "bucket", id };
  return { kind: "draft", id };
}

/** "apg_4d3a38538a1955b8" → "apg_4d3a…55b8". */
export function gateLabel(id: string): string {
  const hex = id.slice(4);
  return hex.length > 10 ? `apg_${hex.slice(0, 4)}…${hex.slice(-4)}` : id;
}

/** A pull request's short name: the repo without its owner, then #N ("agentic-swarm#1731"). */
function prRef(repo: string, n: string): McRef {
  const number = Number(n);
  const name = repo.split("/").pop() ?? repo;
  return { kind: "pr", repo, number, label: `${name}#${number}`, href: `https://github.com/${repo}/pull/${number}` };
}

/** A link's short form: the host, then the last two path segments ("petrasoap.sharepoint.com · …/Systems/Runbooks"). */
export function urlLabel(href: string): string {
  try {
    const url = new URL(href);
    const parts = url.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
    if (parts.length === 0) return url.host;
    const tail = parts.slice(-2).join("/");
    return parts.length > 2 ? `${url.host} · …/${tail}` : `${url.host} · /${tail}`;
  } catch {
    return href;
  }
}

/**
 * A Mission Control path alias ("/tasks/TASK-1", "/projects/PRJ-X", "/buckets/BKT-Y"), the
 * deep links the app redirects into its shell: the reference it names, else null.
 */
export function pathRef(pathname: string): Extract<McRef, { kind: "task" | "project" | "bucket" }> | null {
  const m = /^\/(tasks|projects|buckets)\/([A-Z0-9-]+)\/?$/.exec(pathname);
  if (!m) return null;
  const [, kind, id] = m;
  if (kind === "tasks") return /^TASK-\d{1,6}$/.test(id) ? { kind: "task", id } : null;
  if (kind === "projects") return id.startsWith("PRJ-") ? { kind: "project", id } : null;
  return id.startsWith("BKT-") ? { kind: "bucket", id } : null;
}

/** A URL as a reference: a Mission Control page collapses to its chip, a GitHub pull request to its short name. */
function urlRef(href: string): McRef {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: "text", value: href };
  }
  if (url.host === MC_HOST) {
    const alias = pathRef(url.pathname);
    if (alias) return alias;
    const q = url.searchParams;
    // A link that names a screen collapses only to that screen's chip: a board link
    // that also carries a taskId stays a link, and approvals with a gate is the gate.
    const screen = q.get("screen");
    const on = (name: string) => screen === null || screen === name;
    const taskId = q.get("taskId");
    if (on("task") && taskId && /^TASK-\d{1,6}$/.test(taskId)) return { kind: "task", id: taskId };
    const bucketId = q.get("bucketId");
    if (on("bucket") && bucketId && /^BKT-[A-Z0-9-]+$/.test(bucketId)) return { kind: "bucket", id: bucketId };
    const projectId = q.get("projectId");
    if (on("project") && projectId && /^PRJ-[A-Z0-9-]+$/.test(projectId)) return { kind: "project", id: projectId };
    const draftId = q.get("draftId");
    if (on("drafts") && draftId && /^DRF-\d{1,6}$/.test(draftId)) {
      // A frozen version (the link Accept writes as the PRD) keeps its version.
      const version = q.get("version");
      return version && /^\d{1,6}$/.test(version) ? { kind: "draft", id: draftId, version } : { kind: "draft", id: draftId };
    }
    const gate = q.get("gate");
    if (on("approvals") && gate && /^apg_[0-9a-f]{8,32}$/.test(gate)) return { kind: "gate", id: gate, label: gateLabel(gate) };
  }
  const pr = /^\/([\w.-]+\/[\w.-]+)\/pull\/(\d{1,7})(?:\/.*)?$/.exec(url.pathname);
  if (url.host === "github.com" && pr) return prRef(pr[1], pr[2]);
  return { kind: "url", href: url.toString(), label: urlLabel(url.toString()) };
}

/** Plain text split into text and references, in order. Adjacent text stays one piece. */
export function splitRefs(src: string): McRef[] {
  const out: McRef[] = [];
  const text = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.value += value;
    else out.push({ kind: "text", value });
  };
  let at = 0;
  PATTERN.lastIndex = 0;
  for (let m = PATTERN.exec(src); m; m = PATTERN.exec(src)) {
    let whole = m[0];
    let ref: McRef;
    if (m[1]) {
      whole = trimUrl(m[1]);
      ref = urlRef(whole);
    } else if (m[2] && m[3]) {
      ref = prRef(m[2], m[3]);
    } else if (m[4]) {
      ref = { kind: "gate", id: m[4], label: gateLabel(m[4]) };
    } else {
      ref = idRef(m[5] ?? m[6]);
    }
    text(src.slice(at, m.index));
    if (ref.kind === "text") text(ref.value);
    else out.push(ref);
    at = m.index + whole.length;
    PATTERN.lastIndex = at;
  }
  text(src.slice(at));
  return out;
}
