// Build local install/sync scripts for company skills. Server returns scripts only.

import { pointerFromAllowlist } from "./allowlist";
import { assertValidSkillId } from "./ids";
import { publishedSkills } from "./manifest";
import {
  detectRegistryDrift,
  type RegistryDrift,
  type SkillsRegistry,
} from "./registry";
import type { AllowlistConfig, SkillManifestEntry, SkillsManifest } from "./types";

export type SkillsInstallMode = "install" | "sync";
export type SkillsRuntime = "cursor" | "claude";

export interface BuildSkillsInstallOptions {
  mode: SkillsInstallMode;
  allowlist: AllowlistConfig;
  manifest: SkillsManifest;
  localRegistry?: SkillsRegistry | null;
  ids?: string[];
  runtimes?: SkillsRuntime[];
  projectRoot?: string;
}

export interface SkillsInstallPlan {
  mode: SkillsInstallMode;
  sourceRepo: string;
  gitRef: string;
  packageId: string;
  catalogVersion: string;
  installSkillIds: string[];
  requestedSkillIds: string[];
  unknownSkillIds: string[];
  missingSkillIds: string[];
  staleSkillIds: string[];
  runtimes: SkillsRuntime[];
  projectRoot?: string;
  drift: RegistryDrift;
  scripts: {
    bash: string;
    powershell: string;
  };
}

function bashQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function refForInstall(allowlist: AllowlistConfig, manifest: SkillsManifest): string {
  return allowlist.pinSha || allowlist.pinTag || manifest.gitRef || allowlist.sourceBranch;
}

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

function validateSkillIds(ids: string[]): string[] {
  return ids.map(assertValidSkillId);
}

function normalizeRuntimes(values: SkillsRuntime[] | undefined): SkillsRuntime[] {
  const runtimes = uniqueNonEmpty(values).filter(
    (value): value is SkillsRuntime => value === "cursor" || value === "claude"
  );
  return runtimes.length ? runtimes : ["cursor", "claude"];
}

function buildBashScript(
  mode: SkillsInstallMode,
  sourceRepo: string,
  gitRef: string,
  manifestPath: string,
  packageId: string,
  skills: SkillManifestEntry[],
  catalogVersion: string,
  runtimes: SkillsRuntime[],
  projectRoot: string | undefined
): string {
  const ids = skills.map((s) => s.id).join(" ");
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `MODE=${bashQuote(mode)}`,
    `SOURCE_REPO=${bashQuote(sourceRepo)}`,
    `GIT_REF=${bashQuote(gitRef)}`,
    `MANIFEST_PATH=${bashQuote(manifestPath)}`,
    `PACKAGE_ID=${bashQuote(packageId)}`,
    `CATALOG_VERSION=${bashQuote(catalogVersion)}`,
    `INSTALL_IDS=(${ids.split(" ").filter(Boolean).map(bashQuote).join(" ")})`,
    `RUNTIMES=(${runtimes.map(bashQuote).join(" ")})`,
    `PROJECT_ROOT=${bashQuote(projectRoot ?? "")}`,
    'SKILLS_REPO="${SKILLS_REPO:-${HOME}/plx-cursor-skills}"',
    'if [[ -n "${PROJECT_ROOT}" ]]; then',
    '  CURSOR_DEST="${CURSOR_DEST:-${PROJECT_ROOT}/.cursor/skills}"',
    '  CLAUDE_DEST="${CLAUDE_DEST:-${PROJECT_ROOT}/.claude/skills}"',
    "else",
    '  CURSOR_DEST="${CURSOR_DEST:-${HOME}/.cursor/skills}"',
    '  CLAUDE_DEST="${CLAUDE_DEST:-${HOME}/.claude/skills}"',
    "fi",
    'REGISTRY_PATH="${REGISTRY_PATH:-${HOME}/.agentic/skills.registry.json}"',
    'runtime_enabled() { local target="$1"; for runtime in "${RUNTIMES[@]}"; do [[ "${runtime}" == "${target}" ]] && return 0; done; return 1; }',
    'echo "=== PLX skills ${MODE} ==="',
    'if [[ ! -d "${SKILLS_REPO}/.git" ]]; then',
    '  git clone "https://github.com/${SOURCE_REPO}.git" "${SKILLS_REPO}"',
    "else",
    '  git -C "${SKILLS_REPO}" fetch origin --tags',
    "fi",
    'git -C "${SKILLS_REPO}" checkout "${GIT_REF}"',
    'runtime_enabled cursor && mkdir -p "${CURSOR_DEST}"',
    'runtime_enabled claude && mkdir -p "${CLAUDE_DEST}"',
    'mkdir -p "$(dirname "${REGISTRY_PATH}")"',
    'for id in "${INSTALL_IDS[@]}"; do',
    '  src="${SKILLS_REPO}/skills/${id}"',
    '  if [[ ! -f "${src}/SKILL.md" ]]; then echo "WARN: missing ${id}" >&2; continue; fi',
    '  if runtime_enabled cursor; then rm -rf "${CURSOR_DEST}/${id}"; cp -R "${src}" "${CURSOR_DEST}/${id}"; fi',
    '  if runtime_enabled claude; then rm -rf "${CLAUDE_DEST}/${id}"; cp -R "${src}" "${CLAUDE_DEST}/${id}"; fi',
    'done',
    'REGISTRY_CONTENT_DEST="${CURSOR_DEST}"',
    'if ! runtime_enabled cursor && runtime_enabled claude; then REGISTRY_CONTENT_DEST="${CLAUDE_DEST}"; fi',
    'export REGISTRY_CONTENT_DEST',
    "python - <<'PY'",
    "import hashlib, json, os",
    "from datetime import datetime, timezone",
    "from pathlib import Path",
    "content_root = Path(os.environ.get('REGISTRY_CONTENT_DEST', str(Path.home() / '.cursor' / 'skills')))",
    "registry_path = Path(os.environ.get('REGISTRY_PATH', str(Path.home() / '.agentic' / 'skills.registry.json')))",
    `ids = ${JSON.stringify(skills.map((s) => s.id))}`,
    `payload = {"schemaVersion":"agentic-skills-registry.v1","catalogVersion":${JSON.stringify(catalogVersion)},"gitRef":${JSON.stringify(gitRef)},"packageId":${JSON.stringify(packageId)},"syncedAt":datetime.now(timezone.utc).isoformat(),"skills":[]}`,
    "for skill_id in ids:",
    "    skill_file = content_root / skill_id / 'SKILL.md'",
    "    if skill_file.is_file():",
    "        payload['skills'].append({'id': skill_id, 'contentSha': hashlib.sha256(skill_file.read_bytes()).hexdigest(), 'installedAt': payload['syncedAt']})",
    "registry_path.parent.mkdir(parents=True, exist_ok=True)",
    "registry_path.write_text(json.dumps(payload, indent=2) + '\\n', encoding='utf-8')",
    "print(f\"Registry: {registry_path} ({len(payload['skills'])} skills)\")",
    "PY",
  ];
  return `${lines.join("\n")}\n`;
}

function buildPowershellScript(
  mode: SkillsInstallMode,
  sourceRepo: string,
  gitRef: string,
  packageId: string,
  skills: SkillManifestEntry[],
  catalogVersion: string,
  runtimes: SkillsRuntime[],
  projectRoot: string | undefined
): string {
  const ids = skills.map((s) => psSingleQuote(s.id)).join(", ");
  const runtimeValues = runtimes.map((runtime) => psSingleQuote(runtime)).join(", ");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$Mode = ${psSingleQuote(mode)}`,
    `$SourceRepo = ${psSingleQuote(sourceRepo)}`,
    `$GitRef = ${psSingleQuote(gitRef)}`,
    `$PackageId = ${psSingleQuote(packageId)}`,
    `$CatalogVersion = ${psSingleQuote(catalogVersion)}`,
    `$InstallIds = @(${ids})`,
    `$Runtimes = @(${runtimeValues})`,
    `$ProjectRoot = ${psSingleQuote(projectRoot ?? "")}`,
    "$SkillsRepo = if ($env:SKILLS_REPO) { $env:SKILLS_REPO } else { Join-Path $env:USERPROFILE 'plx-cursor-skills' }",
    "if ($ProjectRoot) {",
    "  $CursorDest = if ($env:CURSOR_DEST) { $env:CURSOR_DEST } else { Join-Path $ProjectRoot '.cursor\\skills' }",
    "  $ClaudeDest = if ($env:CLAUDE_DEST) { $env:CLAUDE_DEST } else { Join-Path $ProjectRoot '.claude\\skills' }",
    "} else {",
    "  $CursorDest = if ($env:CURSOR_DEST) { $env:CURSOR_DEST } else { Join-Path $env:USERPROFILE '.cursor\\skills' }",
    "  $ClaudeDest = if ($env:CLAUDE_DEST) { $env:CLAUDE_DEST } else { Join-Path $env:USERPROFILE '.claude\\skills' }",
    "}",
    "$RegistryPath = if ($env:REGISTRY_PATH) { $env:REGISTRY_PATH } else { Join-Path $env:USERPROFILE '.agentic\\skills.registry.json' }",
    "function Test-RuntimeEnabled([string]$RuntimeName) { return $Runtimes -contains $RuntimeName }",
    'Write-Host "=== PLX skills $Mode ==="',
    "if (-not (Test-Path (Join-Path $SkillsRepo '.git'))) {",
    "  git clone \"https://github.com/$SourceRepo.git\" $SkillsRepo",
    "} else {",
    "  git -C $SkillsRepo fetch origin --tags",
    "}",
    "git -C $SkillsRepo checkout $GitRef",
    "if (Test-RuntimeEnabled 'cursor') { New-Item -ItemType Directory -Force -Path $CursorDest | Out-Null }",
    "if (Test-RuntimeEnabled 'claude') { New-Item -ItemType Directory -Force -Path $ClaudeDest | Out-Null }",
    "New-Item -ItemType Directory -Force -Path (Split-Path $RegistryPath -Parent) | Out-Null",
    "foreach ($id in $InstallIds) {",
    "  $src = Join-Path $SkillsRepo \"skills\\$id\"",
    "  if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { Write-Warning \"missing $id\"; continue }",
    "  if (Test-RuntimeEnabled 'cursor') { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $CursorDest $id); Copy-Item -Recurse $src (Join-Path $CursorDest $id) }",
    "  if (Test-RuntimeEnabled 'claude') { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $ClaudeDest $id); Copy-Item -Recurse $src (Join-Path $ClaudeDest $id) }",
    "}",
    "$RegistryContentDest = if ((Test-RuntimeEnabled 'cursor') -or -not (Test-RuntimeEnabled 'claude')) { $CursorDest } else { $ClaudeDest }",
    "$SyncedAt = (Get-Date).ToUniversalTime().ToString('o')",
    "$Skills = @()",
    "foreach ($id in $InstallIds) {",
    "  $skillFile = Join-Path (Join-Path $RegistryContentDest $id) 'SKILL.md'",
    "  if (Test-Path $skillFile) {",
    "    $sha = (Get-FileHash -Algorithm SHA256 $skillFile).Hash.ToLowerInvariant()",
    "    $Skills += @{ id = $id; contentSha = $sha; installedAt = $SyncedAt }",
    "  }",
    "}",
    "$Payload = @{ schemaVersion = 'agentic-skills-registry.v1'; catalogVersion = $CatalogVersion; gitRef = $GitRef; packageId = $PackageId; syncedAt = $SyncedAt; skills = $Skills }",
    "$Payload | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $RegistryPath",
    'Write-Host "Registry: $RegistryPath ($($Skills.Count) skills)"',
  ];
  return `${lines.join("\n")}\n`;
}

export function buildSkillsInstallPlan(options: BuildSkillsInstallOptions): SkillsInstallPlan {
  const pointer = pointerFromAllowlist(options.allowlist);
  const requestedSkillIds = validateSkillIds(uniqueNonEmpty(options.ids));
  const runtimes = normalizeRuntimes(options.runtimes);
  const allowIds = new Set(validateSkillIds(options.allowlist.skills));
  const allowedSkills = publishedSkills(options.manifest, pointer.packageId, allowIds);
  allowedSkills.forEach((skill) => assertValidSkillId(skill.id));
  const requested = new Set(requestedSkillIds);
  const skills = requested.size
    ? allowedSkills.filter((skill) => requested.has(skill.id))
    : allowedSkills;
  const knownIds = new Set(allowedSkills.map((skill) => skill.id));
  const unknownSkillIds = requestedSkillIds.filter((id) => !knownIds.has(id));
  const drift = detectRegistryDrift(
    options.localRegistry ?? null,
    options.manifest,
    pointer.packageId,
    skills
  );
  const selectedSkills =
    options.mode === "sync" && options.localRegistry
      ? skills.filter(
          (skill) =>
            drift.catalogVersionChanged ||
            drift.gitRefChanged ||
            drift.packageIdChanged ||
            drift.missingSkillIds.includes(skill.id) ||
            drift.staleSkillIds.includes(skill.id)
        )
      : skills;
  const gitRef = refForInstall(options.allowlist, options.manifest);

  return {
    mode: options.mode,
    sourceRepo: pointer.sourceRepo,
    gitRef,
    packageId: pointer.packageId,
    catalogVersion: options.manifest.version,
    installSkillIds: selectedSkills.map((s) => s.id),
    requestedSkillIds,
    unknownSkillIds,
    missingSkillIds: drift.missingSkillIds,
    staleSkillIds: drift.staleSkillIds,
    runtimes,
    projectRoot: options.projectRoot,
    drift,
    scripts: {
      bash: buildBashScript(
        options.mode,
        pointer.sourceRepo,
        gitRef,
        pointer.manifestPath,
        pointer.packageId,
        selectedSkills,
        options.manifest.version,
        runtimes,
        options.projectRoot
      ),
      powershell: buildPowershellScript(
        options.mode,
        pointer.sourceRepo,
        gitRef,
        pointer.packageId,
        selectedSkills,
        options.manifest.version,
        runtimes,
        options.projectRoot
      ),
    },
  };
}
