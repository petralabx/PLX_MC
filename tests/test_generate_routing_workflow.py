"""Contract tests for the metadata-only GitHub routing workflow generator."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = REPO_ROOT / "scripts" / "generate-routing-workflow.py"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "mc-routing-metadata.yml"
MANIFEST = REPO_ROOT / "docs" / "templates" / "mc-routing-manifest.json"
REGISTRY = REPO_ROOT / "config" / "tracked-repos-registry.json"
PILOTS = REPO_ROOT / "config" / "routing-pilots"


def _extract_github_script(workflow: str) -> str:
    marker = "          script: |\n"
    assert marker in workflow
    lines = workflow.split(marker, 1)[1].splitlines()
    return "\n".join(
        line[12:] if line.startswith("            ") else line for line in lines
    )


def _run(
    *arguments: str, cwd: Path = REPO_ROOT, generator: Path = GENERATOR
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(generator), *arguments],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


def test_generator_check_passes_for_committed_workflow():
    assert _run("--check").returncode == 0


def test_generator_check_rejects_workflow_drift(tmp_path):
    scripts = tmp_path / "scripts"
    workflows = tmp_path / ".github" / "workflows"
    scripts.mkdir()
    workflows.mkdir(parents=True)
    shutil.copy(GENERATOR, scripts)
    (workflows / WORKFLOW.name).write_text("hand edited\n", encoding="utf-8")

    result = _run("--check", cwd=tmp_path, generator=scripts / GENERATOR.name)

    assert result.returncode == 1
    assert "ROUTING WORKFLOW DRIFT" in result.stderr


def test_generator_emit_matches_committed_workflow():
    result = _run("--emit")

    assert result.returncode == 0
    assert result.stdout == WORKFLOW.read_text(encoding="utf-8")


def test_workflow_security_contract_is_metadata_only():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    lower = workflow.lower()
    uses = [
        line.strip()
        for line in workflow.splitlines()
        if line.strip().startswith("uses:")
    ]

    assert "pull_request:" in workflow
    assert "types: [opened, reopened, synchronize, closed]" in workflow
    assert "push:" not in workflow
    assert "workflow_dispatch:" not in workflow
    assert "schedule:" not in workflow
    assert "actions/github-script@v7" in workflow
    assert uses == ["uses: actions/github-script@v7"]
    assert "github.rest.pulls.listFiles" in workflow
    assert 'core.getIDToken("plx-mc-compliance-verify")' in workflow
    assert "/api/routing/propose" in workflow
    assert "id-token: write" in workflow
    for forbidden in (
        "actions/checkout",
        "actions/cache",
        "actions/setup-",
        "cache:",
        "pull_request_target",
        "run:",
        "npm ",
        "pip ",
        "pnpm ",
        "yarn ",
        "docker ",
        "git checkout",
        "restore-cache",
        "restore-keys",
        "save-cache",
    ):
        assert forbidden not in lower


def test_workflow_is_variable_gated_with_legacy_url_fallback():
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "if: ${{ vars.PLX_MC_ROUTING_METADATA_ENABLED == '1' }}" in workflow
    assert (
        "MC_BASE_URL: ${{ vars.PLX_MC_BASE_URL || secrets.PLX_MC_BASE_URL }}"
        in workflow
    )


def test_destination_and_fork_validation_precede_oidc_and_network():
    workflow = WORKFLOW.read_text(encoding="utf-8")

    destination_validation = workflow.index("const configuredBaseUrl")
    fork_validation = workflow.index("const sourceRepository")
    automation_validation = workflow.index("dependabot[bot]")
    files_request = workflow.index("github.paginate")
    oidc_request = workflow.index("core.getIDToken")
    proposal_request = workflow.index("await fetch")

    assert destination_validation < fork_validation
    assert fork_validation < automation_validation
    assert automation_validation < files_request < oidc_request < proposal_request
    assert 'configuredBaseUrl !== "https://mc.plxcustomer.io"' in workflow
    assert 'configuredBaseUrl !== "https://mc.plxcustomer.io/"' in workflow
    assert 'parsedBaseUrl.protocol !== "https:"' in workflow
    assert 'parsedBaseUrl.host !== "mc.plxcustomer.io"' in workflow
    assert 'parsedBaseUrl.origin !== "https://mc.plxcustomer.io"' in workflow
    assert "parsedBaseUrl.username" in workflow
    assert "parsedBaseUrl.password" in workflow
    assert 'parsedBaseUrl.pathname !== "/"' in workflow
    assert "parsedBaseUrl.search" in workflow
    assert "parsedBaseUrl.hash" in workflow
    assert "sourceRepository.id !== targetRepository.id" in workflow
    assert "sourceRepository.full_name !== targetRepository.full_name" in workflow
    assert "context.actor" in workflow
    assert "pr.user?.login" in workflow


def test_oidc_binding_uses_actual_head_and_github_sha_auth_alternate():
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert 'core.getIDToken("plx-mc-compliance-verify")' in workflow
    assert "plx-mc-routing-propose" not in workflow
    assert "headSha: pr.head.sha" in workflow
    assert "merged: pr.merged === true" in workflow
    assert "mergeSha: process.env.GITHUB_SHA || null" in workflow
    assert "only as an authentication alternate" in workflow
    assert "never as persisted merge evidence" in workflow


def test_delivery_is_bounded_advisory_and_warn_only():
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "signal: AbortSignal.timeout(20_000)" in workflow
    assert "core.warning(" in workflow
    assert "core.setFailed" not in workflow
    assert "response.status" not in workflow
    assert "JSON.stringify(result)" not in workflow
    assert "delivery remains advisory" in workflow
    assert "compliance is unaffected" in workflow


def test_summary_exposes_only_authenticated_suggestion_deep_link():
    workflow = WORKFLOW.read_text(encoding="utf-8")
    success_summary = workflow[workflow.index("result.data?.effectiveMode") :]
    summary_messages = re.findall(r'writeSafeSummary\("([^"]*)"', workflow)
    warning_messages = re.findall(r'core\.warning\("([^"]*)"', workflow)

    assert 'result.data?.effectiveMode === "suggestion"' in success_summary
    assert 'typeof result.data?.deepLink === "string"' in success_summary
    assert "validateSuggestionDeepLink(result.data.deepLink)" in success_summary
    assert (
        'writeSafeSummary("An MC suggestion is ready.", validatedDeepLink)'
        in success_summary
    )
    assert (
        'writeSafeSummary("Pull request metadata was recorded by Mission Control.")'
        in success_summary
    )
    for sensitive_field in (
        "proposalId",
        "taskId",
        "candidate",
        "matchScore",
        "score",
        "reason",
        "title",
    ):
        assert sensitive_field not in success_summary
        assert all(
            sensitive_field not in message
            for message in summary_messages + warning_messages
        )
    assert "${configuredBaseUrl}" not in workflow
    assert "${process.env.MC_BASE_URL}" not in workflow
    assert "core.warning(configuredBaseUrl" not in workflow
    assert "writeSafeSummary(configuredBaseUrl" not in workflow
    assert 'parsedDeepLink.origin !== "https://mc.plxcustomer.io"' in workflow
    assert 'parsedDeepLink.pathname !== "/routing"' in workflow
    assert "parsedDeepLink.username" in workflow
    assert "parsedDeepLink.password" in workflow
    assert "parsedDeepLink.hash" in workflow
    assert 'parsedDeepLink.searchParams.getAll("proposal")' in workflow
    assert 'key !== "proposal"' in workflow
    assert "core.warning(result.data.deepLink" not in workflow


def test_generated_script_behavior_blocks_untrusted_paths_and_summary_leaks():
    node = shutil.which("node")
    assert node is not None, "Node is required for the generated github-script harness"
    script = _extract_github_script(WORKFLOW.read_text(encoding="utf-8"))
    harness = r"""
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const generatedScript = fs.readFileSync(0, "utf8");

async function runScenario(options = {}) {
  const calls = { listFiles: 0, oidc: 0, fetch: 0 };
  const output = { warnings: [], headings: [], raw: [], links: [] };
  const summary = {
    addHeading(value) { output.headings.push(value); return this; },
    addRaw(value) { output.raw.push(value); return this; },
    addEOL() { return this; },
    addLink(label, url) { output.links.push({ label, url }); return this; },
    async write() {},
  };
  const baseRepo = { id: 1, full_name: "petralabx/PLX_MC" };
  const sourceRepo = options.fork
    ? { id: 2, full_name: "external/PLX_MC" }
    : baseRepo;
  const login = options.login || "contributor";
  const context = {
    actor: options.actor || login,
    eventName: "pull_request",
    repo: { owner: "petralabx", repo: "PLX_MC" },
    payload: {
      action: "opened",
      repository: baseRepo,
      sender: { login },
      pull_request: {
        number: 42,
        merged: false,
        title: "Private task title",
        body: "private body",
        labels: [{ name: "private-label" }],
        user: { login },
        head: { sha: "head-sha", ref: "feature", repo: sourceRepo },
        base: { ref: "main" },
      },
    },
  };
  const core = {
    summary,
    warning(message) { output.warnings.push(message); },
    async getIDToken() { calls.oidc += 1; return "oidc-token"; },
  };
  const github = {
    rest: { pulls: { listFiles: Symbol("listFiles") } },
    async paginate() {
      calls.listFiles += 1;
      return [{ filename: "src/private.ts" }];
    },
  };
  const response = options.response || {
    ok: true,
    async json() {
      return {
        data: {
          effectiveMode: options.mode || "shadow",
          deepLink: options.deepLink,
          proposalId: "rpp_private",
          candidates: [{ taskId: "TASK-SECRET", score: 99, reasons: ["private"] }],
        },
      };
    },
  };
  const sandbox = {
    URL,
    AbortSignal: { timeout: () => ({}) },
    context,
    core,
    github,
    process: {
      env: {
        MC_BASE_URL: options.baseUrl || "https://mc.plxcustomer.io",
        GITHUB_SHA: "merge-ref-sha",
        GITHUB_WORKFLOW_REF: "petralabx/PLX_MC/.github/workflows/mc-routing-metadata.yml@refs/heads/main",
      },
    },
    fetch: async () => { calls.fetch += 1; return response; },
  };
  await vm.runInNewContext(`(async () => {\n${generatedScript}\n})()`, sandbox);
  return { calls, output };
}

(async () => {
  for (const options of [
    { baseUrl: "https://evil.example" },
    { fork: true },
    { actor: "dependabot[bot]", login: "dependabot[bot]" },
  ]) {
    const state = await runScenario(options);
    assert.deepEqual(state.calls, { listFiles: 0, oidc: 0, fetch: 0 });
    assert.equal(state.output.links.length, 0);
  }

  const invalidLink = await runScenario({
    mode: "suggestion",
    deepLink: "https://evil.example/routing?proposal=rpp_private",
  });
  assert.deepEqual(invalidLink.calls, { listFiles: 1, oidc: 1, fetch: 1 });
  assert.equal(invalidLink.output.links.length, 0);
  assert.ok(invalidLink.output.warnings.length > 0);
  assert.ok(invalidLink.output.raw.some((message) => message.includes("recorded")));
  assert.ok(!JSON.stringify(invalidLink.output).includes("evil.example"));

  const shadow = await runScenario({
    mode: "shadow",
    deepLink: "https://mc.plxcustomer.io/routing?proposal=rpp_private",
  });
  assert.equal(shadow.output.links.length, 0);
  assert.ok(shadow.output.raw.some((message) => message.includes("recorded")));
  assert.ok(!JSON.stringify(shadow.output).includes("TASK-SECRET"));
  assert.ok(!JSON.stringify(shadow.output).includes("Private task title"));

  const validLink = "https://mc.plxcustomer.io/routing?proposal=rpp_repo%3A42";
  const suggestion = await runScenario({
    mode: "suggestion",
    deepLink: validLink,
  });
  assert.deepEqual(suggestion.output.links, [
    { label: "Open Mission Control", url: validLink },
  ]);
  assert.ok(suggestion.output.raw.includes("An MC suggestion is ready."));
  assert.ok(!JSON.stringify(suggestion.output).includes("TASK-SECRET"));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
"""
    result = subprocess.run(
        [node, "-e", harness],
        input=script,
        capture_output=True,
        text=True,
        check=False,
        cwd=REPO_ROOT,
    )

    assert result.returncode == 0, result.stderr


def test_security_contract_rejects_checkout():
    spec = importlib.util.spec_from_file_location("routing_workflow", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    with pytest.raises(ValueError, match="actions/checkout"):
        module.validate_security_contract("steps:\n  - uses: actions/checkout@v4\n")


def test_routing_manifest_registry_metadata_matches_template_digest():
    normalized_manifest = MANIFEST.read_bytes().replace(b"\r\n", b"\n")
    expected_digest = f"sha256:{hashlib.sha256(normalized_manifest).hexdigest()}"
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))

    assert registry["repos"]
    for repo in registry["repos"]:
        manifest = repo["routing_manifest"]
        assert manifest["path"] == ".github/plx-mc-routing-manifest.json"
        assert manifest["schema_version"] == "plx-mc-routing-manifest/v1"
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", manifest["digest"])
        assert manifest["digest"] == expected_digest


def test_routing_manifest_defers_policy_to_central_descriptors():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    assert manifest["schema_version"] == "plx-mc-routing-manifest/v1"
    assert manifest["workflow"]["mode"] == "metadata-only"
    assert manifest["rollout"] == {
        "authoritative": False,
        "authority": "central-pilot-descriptor",
        "descriptor_reference": "config/routing-pilots/<repo>.json",
    }
    assert manifest["kill_switches"] == {
        "authoritative": False,
        "authority": "central-runtime-and-repository-configuration",
    }
    for non_authoritative_policy_key in (
        "fuzzy_auto_link_enabled",
        "default_mode",
        "breach_demotion_mode",
        "metadata",
        "suggest",
        "confirm",
        "fuzzy_auto_link",
    ):
        assert non_authoritative_policy_key not in manifest["rollout"]
        assert non_authoritative_policy_key not in manifest["kill_switches"]


def test_active_registry_and_pilot_descriptors_have_one_authority():
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    active_repos = {
        entry["repo"]: entry
        for entry in registry["repos"]
        if entry["status"] == "active" and entry["tier"] != "sandbox"
    }
    pilot_paths = sorted(PILOTS.glob("*.json"))
    pilots = [json.loads(path.read_text(encoding="utf-8")) for path in pilot_paths]
    enabled_pilots = [pilot for pilot in pilots if pilot["enabled"] is True]

    assert len(active_repos) == 8
    assert len(enabled_pilots) == 8
    assert len({pilot["cohortId"] for pilot in enabled_pilots}) == 8
    assert len({pilot["repo"] for pilot in enabled_pilots}) == 8
    assert {path.stem for path in pilot_paths} == {
        pilot["cohortId"] for pilot in enabled_pilots
    }
    assert set(active_repos) == {pilot["repo"] for pilot in enabled_pilots}

    suggestion = {
        pilot["repo"] for pilot in enabled_pilots if pilot["mode"] == "suggestion"
    }
    shadow = {pilot["repo"] for pilot in enabled_pilots if pilot["mode"] == "shadow"}
    assert suggestion == {
        "petralabx/PLX_MC",
        "petralabx/plx-customer-portal",
        "petralabx/agentic-swarm",
    }
    assert len(shadow) == 5

    for pilot in enabled_pilots:
        registered = active_repos[pilot["repo"]]
        assert pilot["tier"] == registered["tier"]
        assert pilot["defaultBucket"] == registered["default_bucket"]
        assert pilot["fuzzyAutoLinkEnabled"] is False
