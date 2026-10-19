// TASK-3336: agent signals and trailers on a PR's head commits. Pure: verifyPr
// (service.ts) loads the commits (github-pr.ts) and the checkout records, and
// decides the verdict. A PR opened by a human login can still carry agent
// commits, so the commits, not the PR author, say whether agent work is in it.

import type { PrCommit } from "./github-pr";

// Lane mailboxes the agent runtimes commit as.
const AGENT_LANE_EMAILS = new Set(["cos@petrasoap.com", "uat@petrasoap.com"]);
const AGENT_COAUTHOR_RE = /^co-authored-by:.*\b(claude|codex|cursor)\b/im;
const TRAILER_RE = /^(Agent|On-Behalf-Of|MC-Checkout):[ \t]*(.*?)\s*$/i;

/** Why this commit counts as agent work; empty for a human commit. */
export function agentSignals(c: PrCommit): string[] {
  const signals = new Set<string>();
  for (const [name, email, login] of [
    [c.authorName, c.authorEmail, c.authorLogin],
    [c.committerName, c.committerEmail, c.committerLogin],
  ]) {
    const who = `${name} ${email} ${login}`.toLowerCase();
    if (who.includes("[bot]")) signals.add("[bot] identity");
    if (who.includes("plx-agents")) signals.add("plx-agents identity");
    if (name.trim().toLowerCase() === "plx agent") signals.add("PLX Agent identity");
    if (AGENT_LANE_EMAILS.has(email.trim().toLowerCase())) signals.add(`lane email ${email.trim().toLowerCase()}`);
  }
  if (AGENT_COAUTHOR_RE.test(c.message)) signals.add("agent Co-Authored-By trailer");
  for (const line of c.message.split(/\r?\n/)) {
    const key = TRAILER_RE.exec(line)?.[1];
    if (key) signals.add(`${canonicalKey(key)} trailer`);
  }
  return [...signals];
}

export interface CommitTrailers {
  agent: string | null;
  onBehalfOf: string | null;
  checkoutId: string | null;
  /** Shape problems; each one blocks. */
  problems: string[];
}

type TrailerKey = "Agent" | "On-Behalf-Of" | "MC-Checkout";

function canonicalKey(key: string): TrailerKey {
  const k = key.toLowerCase();
  return k === "agent" ? "Agent" : k === "on-behalf-of" ? "On-Behalf-Of" : "MC-Checkout";
}

/**
 * The agent trailer block. An agent commit must end with exactly
 * `Agent: <runtime>/<lane>`, `On-Behalf-Of: <email>`, `MC-Checkout: dsp_*`,
 * in that order, with MC-Checkout as the last line.
 */
export function commitTrailers(message: string): CommitTrailers {
  const lines = message.trimEnd().split(/\r?\n/);
  const values: Record<TrailerKey, string[]> = { Agent: [], "On-Behalf-Of": [], "MC-Checkout": [] };
  for (const line of lines) {
    const m = TRAILER_RE.exec(line);
    if (m) values[canonicalKey(m[1])].push(m[2]);
  }
  const problems: string[] = [];
  for (const key of ["Agent", "On-Behalf-Of", "MC-Checkout"] as const) {
    if (values[key].length === 0) problems.push(`missing ${key} trailer`);
    else if (values[key].length > 1) problems.push(`more than one ${key} trailer`);
  }
  const tail = lines.slice(-3).map((line) => {
    const key = TRAILER_RE.exec(line)?.[1];
    return key ? canonicalKey(key) : null;
  });
  if (values["MC-Checkout"].length > 0 && tail[2] !== "MC-Checkout") {
    problems.push("MC-Checkout trailer is not the last line");
  } else if (problems.length === 0 && (tail[0] !== "Agent" || tail[1] !== "On-Behalf-Of")) {
    problems.push("trailers are not the last three lines in order Agent, On-Behalf-Of, MC-Checkout");
  }
  const checkout = values["MC-Checkout"].at(-1) ?? null;
  const checkoutValid = checkout !== null && /^dsp_[A-Za-z0-9]+$/.test(checkout);
  if (checkout !== null && !checkoutValid) problems.push("MC-Checkout trailer is not a dsp_* id");
  return {
    agent: values.Agent.at(-1) || null,
    onBehalfOf: values["On-Behalf-Of"].at(-1) || null,
    checkoutId: checkoutValid ? checkout : null,
    problems,
  };
}

/** Short sha for gate reasons. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7) || "(unknown)";
}
