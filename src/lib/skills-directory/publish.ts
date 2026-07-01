// Publish approved Skills Directory submissions into plx-cursor-skills.

import { skillsSubmitGithubToken, skillsSubmitGithubWriteEnabled } from "@/lib/secrets";

import { assertValidSkillId } from "./ids";
import { parseManifestJson } from "./manifest";
import type { SkillSubmission } from "./submissions-store";
import type { SkillManifestEntry, SkillsManifest } from "./types";

const DEFAULT_TARGET_REPO = "taylorvalton/plx-cursor-skills";
const DEFAULT_BASE_BRANCH = "main";
const DEFAULT_MANIFEST_PATH = "manifest.json";
const DEFAULT_PACKAGE_ID = "plx-engineering-core";

export interface GithubFile {
  content: string;
  sha: string;
}

export interface GithubPullRequest {
  number: number;
  htmlUrl: string;
}

export interface SkillsPublishGithubClient {
  getBranchHead(input: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<string>;
  createBranch(input: {
    owner: string;
    repo: string;
    branch: string;
    sha: string;
  }): Promise<void>;
  getFile(input: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<GithubFile | null>;
  putFile(input: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
  }): Promise<void>;
  openPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GithubPullRequest>;
}

export type SkillPublishResult =
  | {
      mode: "instructions";
      writeEnabled: false;
      branchName: string;
      instructionsPath: "publish-instructions.md";
      content: string;
    }
  | {
      mode: "github_pr";
      writeEnabled: true;
      branchName: string;
      skillPath: string;
      manifestPath: string;
      pullRequestNumber: number;
      pullRequestUrl: string;
    };

export interface PublishApprovedSkillOptions {
  github?: SkillsPublishGithubClient;
  now?: Date;
  writeEnabled?: boolean;
  token?: string;
  targetRepo?: string;
  baseBranch?: string;
  manifestPath?: string;
  packageId?: string;
}

function parseRepo(slug: string): { owner: string; repo: string } {
  const parts = slug.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`target repo "${slug}" must be owner/name`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function branchSafe(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "submission";
}

function timestampForBranch(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function skillPath(skillId: string): string {
  return `skills/${assertValidSkillId(skillId)}/SKILL.md`;
}

function skillContentPath(skillId: string): string {
  return `skills/${assertValidSkillId(skillId)}/`;
}

function jsonStable(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function upsertPackageSkill(
  manifest: SkillsManifest,
  packageId: string,
  skillId: string
): SkillsManifest["packages"] {
  const packages = manifest.packages.map((pkg) =>
    pkg.id === packageId
      ? {
          ...pkg,
          skillIds: pkg.skillIds.includes(skillId)
            ? pkg.skillIds
            : [...pkg.skillIds, skillId],
        }
      : pkg
  );
  if (packages.some((pkg) => pkg.id === packageId)) return packages;
  return [
    ...packages,
    {
      id: packageId,
      name: packageId,
      skillIds: [skillId],
    },
  ];
}

export function buildPublishedManifest(
  manifest: SkillsManifest,
  submission: SkillSubmission,
  packageId: string,
  now: Date
): SkillsManifest {
  const skillId = assertValidSkillId(submission.skillId);
  const existing = manifest.skills.find((entry) => entry.id === skillId);
  const nextEntry: SkillManifestEntry = {
    ...(existing ?? {}),
    id: skillId,
    name: submission.title || existing?.name || skillId,
    description: submission.description || existing?.description || "",
    status: "published",
    contentPath: existing?.contentPath || skillContentPath(skillId),
    owner: submission.submitterEmail || existing?.owner,
  };
  const skills = existing
    ? manifest.skills.map((entry) =>
        entry.id === skillId ? nextEntry : entry
      )
    : [...manifest.skills, nextEntry];
  return {
    ...manifest,
    publishedAt: now.toISOString(),
    packages: upsertPackageSkill(manifest, packageId, skillId),
    skills,
  };
}

function instructionsContent(input: {
  submission: SkillSubmission;
  branchName: string;
  targetRepo: string;
  baseBranch: string;
  manifestPath: string;
  packageId: string;
}): string {
  const path = skillPath(input.submission.skillId);
  return [
    "# Publish Instructions",
    "",
    "`SKILLS_SUBMIT_GITHUB_WRITE_ENABLED` is off, so Mission Control did not write to GitHub.",
    "",
    "## Target",
    "",
    `- Repo: \`${input.targetRepo}\``,
    `- Base branch: \`${input.baseBranch}\``,
    `- Publish branch: \`${input.branchName}\``,
    `- Skill file: \`${path}\``,
    `- Manifest: \`${input.manifestPath}\``,
    "",
    "## Manual Steps",
    "",
    `1. Create branch \`${input.branchName}\` from \`${input.baseBranch}\`.`,
    `2. Add the submitted skill markdown at \`${path}\`.`,
    `3. Update \`${input.manifestPath}\`: add or promote \`${input.submission.skillId}\` to \`status: \"published\"\`, set \`contentPath: \"${skillContentPath(input.submission.skillId)}\"\`, and include it in package \`${input.packageId}\`.`,
    "4. Open a PR for review and merge through the normal plx-cursor-skills flow.",
    "",
    "## Submission",
    "",
    `- Submission: \`${input.submission.id}\``,
    `- Skill: \`${input.submission.skillId}\``,
    `- Title: ${input.submission.title}`,
    `- Submitter: ${input.submission.submitterEmail}`,
    input.submission.skillMd
      ? "- SKILL.md content: supplied with submission"
      : "- SKILL.md content: not supplied; reviewer must provide it before publishing.",
    input.submission.repoUrl ? `- Source repo: ${input.submission.repoUrl}` : "",
    input.submission.notes ? `- Notes: ${input.submission.notes}` : "",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function submittedSkillMarkdown(submission: SkillSubmission): string {
  const content = submission.skillMd ?? "";
  if (!content.trim()) {
    throw new Error("submitted SKILL.md content is required when GitHub write publishing is enabled");
  }
  return content.endsWith("\n") ? content : `${content}\n`;
}

function prBody(input: {
  submission: SkillSubmission;
  skillPath: string;
  manifestPath: string;
}): string {
  return [
    "## Summary",
    "",
    `- Publishes approved Skills Directory submission \`${input.submission.id}\`.`,
    `- Adds or updates \`${input.skillPath}\` and promotes the manifest entry to \`published\`.`,
    "",
    "## Review Notes",
    "",
    `Submitter: ${input.submission.submitterEmail}`,
    input.submission.repoUrl ? `Source repo: ${input.submission.repoUrl}` : "",
    input.submission.contentUrl ? `Content URL: ${input.submission.contentUrl}` : "",
    input.submission.reviewComment
      ? `Review comment: ${input.submission.reviewComment}`
      : "",
    "",
    "## Rollback",
    "",
    `Revert this PR to remove \`${input.skillPath}\` and restore \`${input.manifestPath}\` to the prior catalog state.`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function publishApprovedSkillSubmission(
  submission: SkillSubmission,
  options: PublishApprovedSkillOptions = {}
): Promise<SkillPublishResult> {
  const now = options.now ?? new Date();
  const branchName = `submit/${branchSafe(submission.id)}-${timestampForBranch(now)}`;
  const targetRepo = options.targetRepo ?? DEFAULT_TARGET_REPO;
  const baseBranch = options.baseBranch ?? DEFAULT_BASE_BRANCH;
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const packageId = options.packageId ?? DEFAULT_PACKAGE_ID;
  const writeEnabled = options.writeEnabled ?? skillsSubmitGithubWriteEnabled();

  if (!writeEnabled) {
    return {
      mode: "instructions",
      writeEnabled: false,
      branchName,
      instructionsPath: "publish-instructions.md",
      content: instructionsContent({
        submission,
        branchName,
        targetRepo,
        baseBranch,
        manifestPath,
        packageId,
      }),
    };
  }

  const token = options.token ?? skillsSubmitGithubToken();
  const github = options.github ?? new RestSkillsPublishGithubClient(token);
  const { owner, repo } = parseRepo(targetRepo);
  const submittedSkill = submittedSkillMarkdown(submission);
  const baseSha = await github.getBranchHead({ owner, repo, branch: baseBranch });
  const manifestFile = await github.getFile({
    owner,
    repo,
    ref: baseBranch,
    path: manifestPath,
  });
  if (!manifestFile) {
    throw new Error(`${manifestPath} not found in ${targetRepo}@${baseBranch}`);
  }
  const parsedManifest = parseManifestJson(manifestFile.content);
  if (!parsedManifest.ok) {
    throw new Error(`invalid ${manifestPath}: ${parsedManifest.error}`);
  }
  const nextManifest = buildPublishedManifest(
    parsedManifest.manifest,
    submission,
    packageId,
    now
  );
  const path = skillPath(submission.skillId);
  const existingSkill = await github.getFile({ owner, repo, ref: baseBranch, path });

  await github.createBranch({ owner, repo, branch: branchName, sha: baseSha });
  await github.putFile({
    owner,
    repo,
    branch: branchName,
    path,
    content: submittedSkill,
    message: `Publish skill ${submission.skillId}`,
    sha: existingSkill?.sha,
  });
  await github.putFile({
    owner,
    repo,
    branch: branchName,
    path: manifestPath,
    content: jsonStable(nextManifest),
    message: `Update manifest for ${submission.skillId}`,
    sha: manifestFile.sha,
  });
  const pr = await github.openPullRequest({
    owner,
    repo,
    title: `Publish skill ${submission.skillId}`,
    body: prBody({ submission, skillPath: path, manifestPath }),
    head: branchName,
    base: baseBranch,
  });

  return {
    mode: "github_pr",
    writeEnabled: true,
    branchName,
    skillPath: path,
    manifestPath,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.htmlUrl,
  };
}

class RestSkillsPublishGithubClient implements SkillsPublishGithubClient {
  constructor(private readonly token: string) {}

  private headers(): HeadersInit {
    return {
      authorization: `Bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    };
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    allowNotFound = false
  ): Promise<T | null> {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    if (allowNotFound && res.status === 404) return null;
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        // body not JSON — keep status-only message
      }
      throw new Error(
        `GitHub publish request failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`
      );
    }
    return (await res.json()) as T;
  }

  async getBranchHead(input: {
    owner: string;
    repo: string;
    branch: string;
  }): Promise<string> {
    const body = await this.request<{ object: { sha: string } }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/ref/heads/${encodeURIComponent(input.branch)}`
    );
    if (!body?.object.sha) throw new Error(`branch ${input.branch} has no HEAD sha`);
    return body.object.sha;
  }

  async createBranch(input: {
    owner: string;
    repo: string;
    branch: string;
    sha: string;
  }): Promise<void> {
    await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: input.sha }),
      }
    );
  }

  async getFile(input: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<GithubFile | null> {
    const body = await this.request<{
      content?: string;
      encoding?: string;
      sha?: string;
    }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path}?ref=${encodeURIComponent(input.ref)}`,
      {},
      true
    );
    if (!body) return null;
    if (!body.sha || body.encoding !== "base64" || typeof body.content !== "string") {
      throw new Error(`${input.path} is not a base64 GitHub file response`);
    }
    return {
      sha: body.sha,
      content: Buffer.from(body.content.replace(/\n/g, ""), "base64").toString("utf8"),
    };
  }

  async putFile(input: {
    owner: string;
    repo: string;
    branch: string;
    path: string;
    content: string;
    message: string;
    sha?: string;
  }): Promise<void> {
    await this.request(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/contents/${input.path}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: input.message,
          content: Buffer.from(input.content, "utf8").toString("base64"),
          branch: input.branch,
          ...(input.sha ? { sha: input.sha } : {}),
        }),
      }
    );
  }

  async openPullRequest(input: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<GithubPullRequest> {
    const body = await this.request<{ number: number; html_url: string }>(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        }),
      }
    );
    if (!body) throw new Error("GitHub PR response was empty");
    return { number: body.number, htmlUrl: body.html_url };
  }
}
