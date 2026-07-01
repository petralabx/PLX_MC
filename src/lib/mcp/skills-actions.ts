// Shared PLX skills-directory actions for cursor REST routes and HTTP MCP tools.

import { ApiError } from "@/lib/api/route";
import {
  buildSkillsInstallPlan,
  createSkillSubmission,
  createSkillsSource,
  listSkillCatalog,
  parseSkillsRegistryJson,
  pointerFromAllowlist,
  readCompanySkillsAllowlist,
  type CatalogListResult,
  type SkillSummaryRow,
  type SkillsInstallMode,
  type SkillsRegistry,
  type SkillsRuntime,
} from "@/lib/skills-directory";
import type { McpIdentity } from "./auth";

export interface ListSkillsInput {
  q?: string;
  tag?: string;
  status?: string;
}

export interface InstallSkillsInput {
  ids?: string[];
  mode?: SkillsInstallMode;
  runtimes?: SkillsRuntime[];
  projectRoot?: string;
  localRegistry?: unknown;
}

export interface SyncSkillsInput {
  packageId?: string;
  localRegistry?: unknown;
  runtimes?: SkillsRuntime[];
}

export interface SubmitSkillInput {
  id: string;
  name: string;
  description: string;
  skillMd: string;
  tags?: string[];
  owner?: string;
}

function parseLocalRegistry(value: unknown): SkillsRegistry | null {
  if (value === undefined || value === null) return null;
  const parsed = parseSkillsRegistryJson(
    typeof value === "string" ? value : JSON.stringify(value)
  );
  if (!parsed.ok) {
    throw new ApiError("invalid_registry", `Local skills registry is invalid: ${parsed.error}`);
  }
  return parsed.registry;
}

function applySkillFilters(
  result: CatalogListResult,
  filters: ListSkillsInput
): CatalogListResult {
  const q = filters.q?.trim().toLowerCase();
  const tag = filters.tag?.trim().toLowerCase();
  const status = filters.status?.trim().toLowerCase();
  const skills = result.skills.filter((skill: SkillSummaryRow) => {
    const matchesQ =
      !q ||
      skill.id.toLowerCase().includes(q) ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q);
    const matchesTag = !tag || skill.tags.some((value) => value.toLowerCase() === tag);
    const matchesStatus = !status || skill.status.toLowerCase() === status;
    return matchesQ && matchesTag && matchesStatus;
  });
  return { ...result, skills };
}

function allowlistForPackage(packageId?: string) {
  const allowlist = readCompanySkillsAllowlist();
  return packageId?.trim() ? { ...allowlist, packageId: packageId.trim() } : allowlist;
}

export async function actionListSkills(filters: ListSkillsInput = {}) {
  const allowlist = readCompanySkillsAllowlist();
  const result = await listSkillCatalog(allowlist, createSkillsSource());
  return applySkillFilters(result, filters);
}

export async function actionInstallSkills(input: InstallSkillsInput = {}) {
  const allowlist = readCompanySkillsAllowlist();
  const source = createSkillsSource();
  const fetched = await source.fetchManifest(pointerFromAllowlist(allowlist));
  if (!fetched.ok) {
    throw new ApiError(
      "catalog_unavailable",
      `Skills catalog unavailable: ${fetched.note}`,
      502
    );
  }
  return buildSkillsInstallPlan({
    mode: input.mode ?? "install",
    allowlist,
    manifest: fetched.manifest,
    localRegistry: parseLocalRegistry(input.localRegistry),
    ids: input.ids,
    runtimes: input.runtimes,
    projectRoot: input.projectRoot,
  });
}

export async function actionSyncSkills(input: SyncSkillsInput = {}) {
  const allowlist = allowlistForPackage(input.packageId);
  const source = createSkillsSource();
  const fetched = await source.fetchManifest(pointerFromAllowlist(allowlist));
  if (!fetched.ok) {
    throw new ApiError(
      "catalog_unavailable",
      `Skills catalog unavailable: ${fetched.note}`,
      502
    );
  }
  const plan = buildSkillsInstallPlan({
    mode: "sync",
    allowlist,
    manifest: fetched.manifest,
    localRegistry: parseLocalRegistry(input.localRegistry),
    runtimes: input.runtimes,
  });
  return {
    mode: plan.mode,
    sourceRepo: plan.sourceRepo,
    gitRef: plan.gitRef,
    packageId: plan.packageId,
    catalogVersion: plan.catalogVersion,
    installSkillIds: plan.installSkillIds,
    missingSkillIds: plan.missingSkillIds,
    staleSkillIds: plan.staleSkillIds,
    requestedSkillIds: plan.requestedSkillIds,
    unknownSkillIds: plan.unknownSkillIds,
    runtimes: plan.runtimes,
    drift: plan.drift,
  };
}

function ownerAsEmail(owner: string | undefined, fallback: string): string {
  if (owner && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) return owner;
  return fallback;
}

export async function actionSubmitSkill(identity: McpIdentity, input: SubmitSkillInput) {
  const noteParts = [
    "Submitted through mc_submit_skill.",
    input.tags?.length ? `Tags: ${input.tags.join(", ")}` : "",
    input.owner && input.owner !== ownerAsEmail(input.owner, identity.operatorEmail)
      ? `Owner: ${input.owner}`
      : "",
    "SKILL.md:",
    input.skillMd,
  ].filter(Boolean);

  return createSkillSubmission({
    skillId: input.id,
    title: input.name,
    description: input.description,
    submitterEmail: ownerAsEmail(input.owner, identity.operatorEmail),
    skillMd: input.skillMd,
    notes: noteParts.join("\n\n"),
  });
}
