// skills-directory domain module barrel.

export type {
  AllowlistConfig,
  CatalogListResult,
  CatalogMeta,
  CatalogPointer,
  ContentFetchResult,
  ManifestFetchResult,
  SkillDetailResult,
  SkillSummaryRow,
  SkillsManifest,
  SkillsSourceReader,
} from "./types";
export type { SkillsInstallMode, SkillsInstallPlan, SkillsRuntime } from "./install";
export type { RegistryDrift, SkillsRegistry, SkillsRegistrySkill } from "./registry";
export type {
  CreateSkillSubmissionInput,
  SkillSubmission,
  SkillSubmissionStatus,
  UpdateSkillSubmissionInput,
} from "./submissions-store";
export type {
  GithubFile,
  GithubPullRequest,
  SkillPublishResult,
  SkillsPublishGithubClient,
} from "./publish";

export {
  CATALOG_CONFIG_FILES,
  degradedFallbackIds,
  loadCatalogConfig,
  loadCatalogConfigRaw,
  parseCatalogConfig,
  readCompanySkillsAllowlist,
  resolveAllowIds,
} from "./catalog";
export { parseAllowlistJson, pointerFromAllowlist } from "./allowlist";
export { assertValidSkillId, isValidSkillId, SKILL_ID_PATTERN } from "./ids";
export { packageSkillIds, parseManifestJson, publishedSkills } from "./manifest";
export { createSkillsSource, GithubSkillsSource } from "./github";
export { getSkillDetail, listSkillCatalog } from "./loader";
export { buildSkillsInstallPlan } from "./install";
export {
  buildRegistry,
  detectRegistryDrift,
  parseSkillsRegistryJson,
  SKILLS_REGISTRY_SCHEMA_VERSION,
} from "./registry";
export {
  createSkillSubmission,
  deleteSkillSubmission,
  getSkillSubmission,
  listSkillSubmissions,
  updateSkillSubmission,
} from "./submissions-store";
export { buildPublishedManifest, publishApprovedSkillSubmission } from "./publish";
