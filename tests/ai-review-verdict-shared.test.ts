// The shared ai-review/verdict workflow (TASK-3902) and PLX_MC's caller of it.
// Runs the workflow's github-script body against mocked github/context/core, like the portal's
// scripts/ai-review-verdict.test.mjs, whose rule this file copies. New here: the base branch and the
// caller file come from the caller, and trust_org_members also trusts petralabx members' markers on
// PRs they did not open (Vince, 2026-10-25).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SHARED = readFileSync(join(process.cwd(), ".github/workflows/ai-review-verdict-shared.yml"), "utf8");
const CALLER = readFileSync(join(process.cwd(), ".github/workflows/ai-review-verdict.yml"), "utf8");

type Script = (github: unknown, context: unknown, core: unknown) => Promise<void>;

/** The first `script: |` block of the shared workflow (the verdict job), dedented. */
function verdictScript(): Script {
  const lines = SHARED.split("\n");
  const at = lines.findIndex((l) => /^\s+script: \|\s*$/.test(l));
  const indent = (lines[at + 1].match(/^ */) ?? [""])[0].length;
  const body: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() && (lines[i].match(/^ */) ?? [""])[0].length < indent) break;
    body.push(lines[i].slice(indent));
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => Script;
  return new AsyncFunction("github", "context", "core", body.join("\n"));
}
const script = verdictScript();

const SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const BLOB = "s".repeat(40);
const ENV_KEYS = ["BASE_BRANCH", "CALLER_PATH", "TRUST_ORG_MEMBERS", "APPROVED_REVIEWERS", "MIN_REVIEWERS", "GITHUB_WORKFLOW_SHA"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

interface User {
  login: string;
  type: string;
}
interface Comment {
  body: string;
  user: User;
  author_association: string;
  created_at: string;
  updated_at?: string;
  node_id?: string;
}
interface Status {
  sha: string;
  state: string;
  context: string;
  description: string;
}
interface Summary {
  addHeading(): Summary;
  addRaw(): Summary;
  addCodeBlock(): Summary;
  write(): Promise<void>;
}

const agentsBot: User = { login: "plx-agents[bot]", type: "Bot" };
const marker = ({ reviewer = "astra", sha = SHA, p1 = 0 }: { reviewer?: string; sha?: string; p1?: number } = {}) =>
  `<!-- ai-review {"reviewer":"${reviewer}","sha":"${sha}","open_p0":0,"open_p1":${p1},"files_read":3,"diff_files":3} -->`;
const comment = (body: string, user: User, assoc = "NONE"): Comment => ({
  body,
  user,
  author_association: assoc,
  created_at: "2026-10-25T18:00:00Z",
});

interface RunOptions {
  comments?: Comment[];
  prUser?: User;
  prBase?: string;
  agents?: string[];
  env?: Record<string, string>;
  eventName?: string;
  blobs?: Record<string, string>;
  mergeGroup?: boolean;
  edits?: Record<string, { lastEditedAt: string | null; editor: { login: string; __typename: string } | null }>;
  sameHeadPrs?: number[];
}

async function run(o: RunOptions = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { BASE_BRANCH: "main", ...o.env });
  const pr = {
    number: 7,
    state: "open",
    base: { ref: o.prBase ?? "main", sha: BASE_SHA },
    head: { sha: SHA },
    body: "",
    author_association: "MEMBER",
    user: o.prUser ?? { login: "pr-author", type: "User" },
  };
  // A one-PR merge group: BASE <- MERGE (parents BASE and the PR head).
  const MERGE = "c".repeat(40);
  const queueCommits = [
    { sha: SHA, parents: [{ sha: BASE_SHA }] },
    { sha: MERGE, parents: [{ sha: BASE_SHA }, { sha: SHA }] },
  ];
  const posted: Status[] = [];
  const failed: string[] = [];
  const notices: string[] = [];
  const contentPaths: string[] = [];
  const github = {
    graphql: async (_q: string, { ids }: { ids: string[] }) => ({
      nodes: ids.map((id) => ({ id, ...(o.edits?.[id] ?? { lastEditedAt: null, editor: null }) })),
    }),
    paginate: async (f: (a?: unknown) => unknown, a?: unknown) => f(a),
    request: async (route: string) => {
      if (route.includes(`/compare/${BASE_SHA}...${MERGE}`)) return { data: { total_commits: 2, commits: queueCommits } };
      if (route.includes(`/commits/${SHA}/pulls`)) return { data: [pr] };
      throw new Error(`unexpected ${route}`);
    },
    rest: {
      pulls: {
        list: () => [pr, ...(o.sameHeadPrs ?? []).map((n) => ({ ...pr, number: n }))],
        listReviews: () => [],
        listCommits: () => (o.agents ?? []).map((a) => ({ commit: { message: `subject\n\nAgent: ${a}\nOn-Behalf-Of: x@y` } })),
        get: async () => ({ data: pr }),
      },
      issues: { listComments: () => o.comments ?? [] },
      repos: {
        getContent: async ({ ref, path }: { ref: string; path: string }) => {
          contentPaths.push(path);
          return { data: { sha: o.blobs?.[ref] ?? BLOB } };
        },
        listCommitStatusesForRef: async () => ({ data: [] }),
        createCommitStatus: async (s: Status) => {
          posted.push(s);
        },
      },
    },
  };
  const summary: Summary = {
    addHeading: () => summary,
    addRaw: () => summary,
    addCodeBlock: () => summary,
    write: async () => {},
  };
  const core = {
    info() {},
    error() {},
    warning() {},
    notice: (m: string) => void notices.push(m),
    setFailed: (m: string) => void failed.push(m),
    summary,
  };
  const eventName = o.mergeGroup ? "merge_group" : (o.eventName ?? "pull_request_target");
  const payload = o.mergeGroup
    ? {
        merge_group: {
          head_sha: MERGE,
          base_sha: BASE_SHA,
          base_ref: "refs/heads/main",
          head_ref: `refs/heads/gh-readonly-queue/main/pr-7-${BASE_SHA}`,
        },
      }
    : { pull_request: { number: 7 } };
  const context = { repo: { owner: "petralabx", repo: "x" }, serverUrl: "https://github.com", runId: 1, eventName, sha: SHA, payload };
  await script(github, context, core);
  return { posted, failed, notices, contentPaths };
}

describe("ai-review-verdict-shared.yml: who may post a marker", () => {
  it("passes on a clean plx-agents marker for the head", async () => {
    const { posted } = await run({ comments: [comment(marker(), agentsBot)] });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ sha: SHA, state: "success", context: "ai-review/verdict" });
    expect(posted[0].description).toMatch(/^Clean: astra/);
  });

  it("stays pending without a trusted marker", async () => {
    const { posted } = await run({ comments: [comment(marker(), { login: "someone", type: "User" })] });
    expect(posted[0].state).toBe("pending");
  });

  it("counts a member's or an owner's marker when trust_org_members is on", async () => {
    for (const assoc of ["MEMBER", "OWNER"]) {
      const { posted } = await run({
        env: { TRUST_ORG_MEMBERS: "true" },
        comments: [comment(marker(), { login: "reviewer", type: "User" }, assoc)],
      });
      expect(posted[0].state, assoc).toBe("success");
    }
  });

  it("never counts a marker from the PR's own author", async () => {
    const { posted } = await run({
      env: { TRUST_ORG_MEMBERS: "true" },
      prUser: { login: "taylorvalton", type: "User" },
      comments: [comment(marker(), { login: "taylorvalton", type: "User" }, "OWNER")],
    });
    expect(posted[0].state).toBe("pending");
  });

  it("never counts collaborators, contributors, outsiders or other bots", async () => {
    const posters: [User, string][] = [
      [{ login: "c", type: "User" }, "COLLABORATOR"],
      [{ login: "c", type: "User" }, "CONTRIBUTOR"],
      [{ login: "c", type: "User" }, "NONE"],
      [{ login: "plx-cip[bot]", type: "Bot" }, "MEMBER"],
    ];
    for (const [user, assoc] of posters) {
      const { posted } = await run({ env: { TRUST_ORG_MEMBERS: "true" }, comments: [comment(marker(), user, assoc)] });
      expect(posted[0].state, `${user.login} ${assoc}`).toBe("pending");
    }
  });

  it("ignores members' markers when trust_org_members is off", async () => {
    const { posted } = await run({ comments: [comment(marker(), { login: "reviewer", type: "User" }, "MEMBER")] });
    expect(posted[0].state).toBe("pending");
  });

  it("fails on an open P1 from a trusted member", async () => {
    const { posted } = await run({
      env: { TRUST_ORG_MEMBERS: "true" },
      comments: [comment(marker(), agentsBot), comment(marker({ reviewer: "claude", p1: 1 }), { login: "r", type: "User" }, "MEMBER")],
    });
    expect(posted[0].state).toBe("failure");
    expect(posted[0].description).toMatch(/claude P0=0 P1=1/);
  });

  it("does not count the author's own family", async () => {
    const { posted } = await run({ agents: ["claude-code/claude-code"], comments: [comment(marker({ reviewer: "claude" }), agentsBot)] });
    expect(posted[0].state).toBe("pending");
    expect(posted[0].description).toMatch(/author family claude not counted/);
  });
});

describe("ai-review-verdict-shared.yml: edited markers and shared heads (Sol P1s, TASK-3832)", () => {
  const withNode = (c: Comment, id: string, edited = false): Comment =>
    ({ ...c, node_id: id, updated_at: edited ? "2026-10-25T19:00:00Z" : c.created_at });
  it("counts an unedited bot marker", async () => {
    const { posted } = await run({ comments: [withNode(comment(marker(), agentsBot), "IC_1")] });
    expect(posted[0].state).toBe("success");
  });
  it("ignores a bot marker edited by the PR author", async () => {
    const { posted } = await run({
      comments: [withNode(comment(marker(), agentsBot), "IC_1", true)],
      edits: { IC_1: { lastEditedAt: "2026-10-25T19:00:00Z", editor: { login: "pr-author", __typename: "User" } } },
    });
    expect(posted[0].state).toBe("pending");
  });
  it("counts a bot marker edited by the bot itself", async () => {
    const { posted } = await run({
      comments: [withNode(comment(marker(), agentsBot), "IC_1", true)],
      edits: { IC_1: { lastEditedAt: "2026-10-25T19:00:00Z", editor: { login: "plx-agents", __typename: "Bot" } } },
    });
    expect(posted[0].state).toBe("success");
  });
  it("ignores a member's marker edited by another member, counts the member's own edit", async () => {
    const c0 = withNode(comment(marker(), { login: "reviewer", type: "User" }, "MEMBER"), "IC_2", true);
    const other = await run({ env: { TRUST_ORG_MEMBERS: "true" }, comments: [c0],
      edits: { IC_2: { lastEditedAt: "x", editor: { login: "pr-author", __typename: "User" } } } });
    expect(other.posted[0].state).toBe("pending");
    const own = await run({ env: { TRUST_ORG_MEMBERS: "true" }, comments: [c0],
      edits: { IC_2: { lastEditedAt: "x", editor: { login: "reviewer", __typename: "User" } } } });
    expect(own.posted[0].state).toBe("success");
  });
  it("ignores an edited marker with no node id", async () => {
    const c0 = { ...comment(marker(), agentsBot), updated_at: "2026-10-25T19:00:00Z" };
    const { posted } = await run({ comments: [c0] });
    expect(posted[0].state).toBe("pending");
  });
  it("never lets two open PRs on one head share a pass", async () => {
    const { posted } = await run({ comments: [comment(marker(), agentsBot)], sameHeadPrs: [8] });
    expect(posted.length).toBeGreaterThan(0);
    for (const s of posted) {
      expect(s.state).toBe("failure");
      expect(s.description).toMatch(/shared by open PRs #7, #8/);
    }
  });
});

describe("ai-review-verdict-shared.yml: the caller's base branch and file", () => {
  it("grades only PRs on the caller's base branch", async () => {
    const { posted } = await run({ prBase: "staging", comments: [comment(marker(), agentsBot)] });
    expect(posted).toHaveLength(0);
  });

  it("refuses to run without a base branch", async () => {
    const { posted, failed } = await run({ env: { BASE_BRANCH: "" }, comments: [comment(marker(), agentsBot)] });
    expect(posted).toHaveLength(0);
    expect(failed[0]).toMatch(/BASE_BRANCH is required/);
  });

  it("posts nothing from a pull_request_review run whose caller file is not the base branch's", async () => {
    const { posted, notices, contentPaths } = await run({
      eventName: "pull_request_review",
      env: { CALLER_PATH: ".github/workflows/review.yml" },
      blobs: { [SHA]: "x".repeat(40), main: BLOB },
      comments: [comment(marker(), agentsBot)],
    });
    expect(posted).toHaveLength(0);
    expect(contentPaths).toEqual([".github/workflows/review.yml", ".github/workflows/review.yml"]);
    expect(notices[0]).toMatch(/is not main's/);
  });

  it("grades a merge group on the queued commit", async () => {
    const clean = await run({ mergeGroup: true, comments: [comment(marker(), agentsBot)] });
    expect(clean.posted).toHaveLength(1);
    expect(clean.posted[0]).toMatchObject({ sha: "c".repeat(40), state: "success" });
    expect(clean.posted[0].description).toBe("Queue: clean #7");

    const unreviewed = await run({ mergeGroup: true });
    expect(unreviewed.posted[0].state).toBe("failure");
    expect(unreviewed.posted[0].description).toMatch(/^Queue: #7 Need 1 clean approved review/);
  });
});

describe("workflow wiring", () => {
  it("the shared file is only callable, and passes every input to the verdict job", () => {
    expect(SHARED).toMatch(/^on:\n {2}workflow_call:\n {4}inputs:\n/m);
    expect(SHARED).toMatch(/^ {6}base_branch:\n(?: {8}.*\n)*? {8}required: true$/m);
    expect(SHARED).toMatch(/^ {6}trust_org_members:\n(?: {8}.*\n)*? {8}default: false$/m);
    for (const env of ["BASE_BRANCH", "CALLER_PATH", "APPROVED_REVIEWERS", "MIN_REVIEWERS", "TRUST_ORG_MEMBERS"]) {
      expect(SHARED).toMatch(new RegExp(`^ {6}${env}: \\$\\{\\{ inputs\\.[a-z_]+ \\}\\}$`, "m"));
    }
    expect(SHARED).not.toMatch(/staging/);
  });

  it("PLX_MC calls the shared file pinned to main, with the portal's triggers and scopes", () => {
    expect(CALLER).toMatch(/^ {4}uses: petralabx\/PLX_MC\/\.github\/workflows\/ai-review-verdict-shared\.yml@main$/m);
    expect(CALLER).toMatch(/^ {6}base_branch: main$/m);
    expect(CALLER).toMatch(/^ {6}trust_org_members: true$/m);
    expect(CALLER).toMatch(/^ {2}pull_request_target:\n {4}types: \[opened, reopened, synchronize, edited, ready_for_review\]\n {4}branches: \[main\]$/m);
    for (const trigger of ["issue_comment", "pull_request_review", "workflow_dispatch", "schedule", "merge_group"]) {
      expect(CALLER).toMatch(new RegExp(`^ {2}${trigger}:`, "m"));
    }
    expect(CALLER).toMatch(/^permissions:\n {2}statuses: write\n {2}pull-requests: read\n {2}issues: read\n {2}contents: read$/m);
    expect(CALLER).toMatch(
      /group: \$\{\{ github\.event_name == 'merge_group' && format\('ai-review-verdict-mg-\{0\}', github\.event\.merge_group\.head_sha\) \|\| 'ai-review-verdict' \}\}/,
    );
    expect(CALLER).not.toMatch(/^ {2}pull_request:/m);
  });
});
