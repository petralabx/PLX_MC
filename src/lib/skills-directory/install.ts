// Build local install/sync scripts for company skills. Server returns scripts only.

import { pointerFromAllowlist } from "./allowlist";
import { publishedSkills } from "./manifest";
import {
  detectRegistryDrift,
  type RegistryDrift,
  type SkillsRegistry,
} from "./registry";
import type { AllowlistConfig, SkillManifestEntry, SkillsManifest } from "./types";

export type SkillsInstallMode = "install" | "sync";

export interface BuildSkillsInstallOptions {
  mode: SkillsInstallMode;
  allowlist: AllowlistConfig;
  manifest: SkillsManifest;
  localRegistry?: SkillsRegistry | null;
}

export interface SkillsInstallPlan {
  mode: SkillsInstallMode;
  sourceRepo: string;
  gitRef: string;
  packageId: string;
  catalogVersion: string;
  installSkillIds: string[];
  missingSkillIds: string[];
  staleSkillIds: string[];
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

function buildBashScript(
  mode: SkillsInstallMode,
  sourceRepo: string,
  gitRef: string,
  manifestPath: string,
  packageId: string,
  skills: SkillManifestEntry[],
  catalogVersion: string
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
    'SKILLS_REPO="${SKILLS_REPO:-${HOME}/plx-cursor-skills}"',
    'CURSOR_DEST="${CURSOR_DEST:-${HOME}/.cursor/skills}"',
    'CLAUDE_DEST="${CLAUDE_DEST:-${HOME}/.claude/skills}"',
    'REGISTRY_PATH="${REGISTRY_PATH:-${HOME}/.agentic/skills.registry.json}"',
    'echo "=== PLX skills ${MODE} ==="',
    'if [[ ! -d "${SKILLS_REPO}/.git" ]]; then',
    '  git clone "https://github.com/${SOURCE_REPO}.git" "${SKILLS_REPO}"',
    "else",
    '  git -C "${SKILLS_REPO}" fetch origin --tags',
    "fi",
    'git -C "${SKILLS_REPO}" checkout "${GIT_REF}"',
    'mkdir -p "${CURSOR_DEST}" "${CLAUDE_DEST}" "$(dirname "${REGISTRY_PATH}")"',
    'for id in "${INSTALL_IDS[@]}"; do',
    '  src="${SKILLS_REPO}/skills/${id}"',
    '  if [[ ! -f "${src}/SKILL.md" ]]; then echo "WARN: missing ${id}" >&2; continue; fi',
    '  rm -rf "${CURSOR_DEST}/${id}" "${CLAUDE_DEST}/${id}"',
    '  cp -R "${src}" "${CURSOR_DEST}/${id}"',
    '  cp -R "${src}" "${CLAUDE_DEST}/${id}"',
    'done',
    "python - <<'PY'",
    "import hashlib, json, os",
    "from datetime import datetime, timezone",
    "from pathlib import Path",
    "cursor = Path(os.environ.get('CURSOR_DEST', str(Path.home() / '.cursor' / 'skills')))",
    "registry_path = Path(os.environ.get('REGISTRY_PATH', str(Path.home() / '.agentic' / 'skills.registry.json')))",
    `ids = ${JSON.stringify(skills.map((s) => s.id))}`,
    `payload = {"schemaVersion":"agentic-skills-registry.v1","catalogVersion":${JSON.stringify(catalogVersion)},"gitRef":${JSON.stringify(gitRef)},"packageId":${JSON.stringify(packageId)},"syncedAt":datetime.now(timezone.utc).isoformat(),"skills":[]}`,
    "for skill_id in ids:",
    "    skill_file = cursor / skill_id / 'SKILL.md'",
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
  catalogVersion: string
): string {
  const ids = skills.map((s) => psSingleQuote(s.id)).join(", ");
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$Mode = ${psSingleQuote(mode)}`,
    `$SourceRepo = ${psSingleQuote(sourceRepo)}`,
    `$GitRef = ${psSingleQuote(gitRef)}`,
    `$PackageId = ${psSingleQuote(packageId)}`,
    `$CatalogVersion = ${psSingleQuote(catalogVersion)}`,
    `$InstallIds = @(${ids})`,
    "$SkillsRepo = if ($env:SKILLS_REPO) { $env:SKILLS_REPO } else { Join-Path $env:USERPROFILE 'plx-cursor-skills' }",
    "$CursorDest = if ($env:CURSOR_DEST) { $env:CURSOR_DEST } else { Join-Path $env:USERPROFILE '.cursor\\skills' }",
    "$ClaudeDest = if ($env:CLAUDE_DEST) { $env:CLAUDE_DEST } else { Join-Path $env:USERPROFILE '.claude\\skills' }",
    "$RegistryPath = if ($env:REGISTRY_PATH) { $env:REGISTRY_PATH } else { Join-Path $env:USERPROFILE '.agentic\\skills.registry.json' }",
    'Write-Host "=== PLX skills $Mode ==="',
    "if (-not (Test-Path (Join-Path $SkillsRepo '.git'))) {",
    "  git clone \"https://github.com/$SourceRepo.git\" $SkillsRepo",
    "} else {",
    "  git -C $SkillsRepo fetch origin --tags",
    "}",
    "git -C $SkillsRepo checkout $GitRef",
    "New-Item -ItemType Directory -Force -Path $CursorDest, $ClaudeDest, (Split-Path $RegistryPath -Parent) | Out-Null",
    "foreach ($id in $InstallIds) {",
    "  $src = Join-Path $SkillsRepo \"skills\\$id\"",
    "  if (-not (Test-Path (Join-Path $src 'SKILL.md'))) { Write-Warning \"missing $id\"; continue }",
    "  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $CursorDest $id), (Join-Path $ClaudeDest $id)",
    "  Copy-Item -Recurse $src (Join-Path $CursorDest $id)",
    "  Copy-Item -Recurse $src (Join-Path $ClaudeDest $id)",
    "}",
    "$SyncedAt = (Get-Date).ToUniversalTime().ToString('o')",
    "$Skills = @()",
    "foreach ($id in $InstallIds) {",
    "  $skillFile = Join-Path (Join-Path $CursorDest $id) 'SKILL.md'",
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
  const allowIds = new Set(options.allowlist.skills);
  const skills = publishedSkills(options.manifest, pointer.packageId, allowIds);
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
    missingSkillIds: drift.missingSkillIds,
    staleSkillIds: drift.staleSkillIds,
    drift,
    scripts: {
      bash: buildBashScript(
        options.mode,
        pointer.sourceRepo,
        gitRef,
        pointer.manifestPath,
        pointer.packageId,
        selectedSkills,
        options.manifest.version
      ),
      powershell: buildPowershellScript(
        options.mode,
        pointer.sourceRepo,
        gitRef,
        pointer.packageId,
        selectedSkills,
        options.manifest.version
      ),
    },
  };
}
