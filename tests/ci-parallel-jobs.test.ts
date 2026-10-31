import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// TASK-4346: CI runs each step of the pre-push full suite in its own parallel
// job. These invariants keep CI and `preflight.sh --mode pre-push` running the
// same checks, and keep the required check names the rulesets look for.

interface Step {
  uses?: string;
  run?: string;
}
interface Job {
  name?: string;
  needs?: string[] | string;
  if?: string;
  steps?: Step[];
}

function loadCiJobs(): Record<string, Job> {
  // The tests already parse workflows with python3 + PyYAML (db-migrate.test.ts).
  const parsed = spawnSync(
    "python3",
    ["-c", "import yaml,json; print(json.dumps(yaml.safe_load(open('.github/workflows/ci.yml'))['jobs']))"],
    { encoding: "utf8" }
  );
  if (parsed.status !== 0) throw new Error(parsed.stderr);
  return JSON.parse(parsed.stdout) as Record<string, Job>;
}

function preflightRuns(job: Job): string[] {
  return (job.steps ?? []).map((s) => s.run ?? "").filter((r) => r.includes("scripts/preflight.sh"));
}

const jobs = loadCiJobs();
const preflight = readFileSync("scripts/preflight.sh", "utf8");
const preflightJobs = Object.entries(jobs).filter(([, job]) => preflightRuns(job).length > 0);

describe("CI runs the pre-push full suite as parallel jobs", () => {
  it("covers every step pre-push runs, through the steps preflight.sh accepts", () => {
    const fullBody = /run_full\(\) \{([\s\S]*?)\n\}/.exec(preflight)?.[1] ?? "";
    const fullSteps = [...fullBody.matchAll(/^\s*run_([a-z0-9_]+)\s*$/gm)].map((m) => m[1].replace(/_/g, "-"));
    expect(fullSteps).toEqual(["python-tests", "node-tests", "build", "e2e"]);

    const onlyArms = [...(/case "\$ONLY" in([\s\S]*?)esac/.exec(preflight)?.[1] ?? "").matchAll(/^\s*([a-z0-9-]+)\)/gm)].map(
      (m) => m[1]
    );
    expect(onlyArms.sort()).toEqual([...fullSteps].sort());

    const ciSteps = preflightJobs.flatMap(([, job]) =>
      preflightRuns(job).flatMap((r) => [...r.matchAll(/--only ([a-z0-9-]+)/g)].map((m) => m[1]))
    );
    expect([...new Set(ciSteps)].sort()).toEqual([...fullSteps].sort());
  });

  it("runs the policy and quick checks once, never the whole pre-push sequence", () => {
    const runs = preflightJobs.flatMap(([, job]) => preflightRuns(job));
    expect(runs.filter((r) => r.includes("--mode ci"))).toHaveLength(1);
    expect(runs.some((r) => r.includes("--mode pre-push"))).toBe(false);
  });

  it("keeps the required check names and makes them wait for every preflight job", () => {
    const aggregate = jobs.test;
    expect(aggregate.name).toBe("Preflight + full suite");
    expect(aggregate.if).toBe("always()");
    expect([...(aggregate.needs as string[])].sort()).toEqual(preflightJobs.map(([id]) => id).sort());
    // The aggregate fails on anything but success: a skipped or cancelled job is not a pass.
    expect(aggregate.steps?.map((s) => s.run ?? "").join("\n")).toContain(`all(.[]; . == "success")`);
    expect(jobs.ci.needs).toEqual(["test"]);
  });

  it("pre-push checks the changed files, and full mode keeps the whole suite (TASK-4389)", () => {
    const arm = (mode: string) => new RegExp(`^\\s*${mode}\\)\\n([\\s\\S]*?);;`, "m").exec(preflight)?.[1] ?? "";
    const calls = (body: string) => [...body.matchAll(/^\s*(run_[a-z_]+)\s*$/gm)].map((m) => m[1]);
    expect(calls(arm("pre-push\\|push"))).toEqual(["run_policy", "run_changed"]);
    expect(calls(arm("full"))).toEqual(["run_policy", "run_quick", "run_full"]);
    const changed = /run_changed\(\) \{([\s\S]*?)\n\}/.exec(preflight)?.[1] ?? "";
    expect(changed).toContain("npx vitest related --run");
    expect(changed).not.toMatch(/run_full|npm run build|test:e2e/);
  });

  it("gives every preflight job the one shared setup", () => {
    for (const [, job] of preflightJobs) {
      expect(job.steps?.some((s) => s.uses === "./.github/actions/plx-mc-setup")).toBe(true);
    }
  });

  it("splits Playwright into shards that together run every test", () => {
    const e2eRun = preflightRuns(jobs.e2e).join("\n");
    expect(e2eRun).toContain("--only e2e -- --shard=${{ matrix.shard }}/4");
    const matrix = (jobs.e2e as Job & { strategy?: { matrix?: { shard?: number[] } } }).strategy?.matrix?.shard;
    expect(matrix).toEqual([1, 2, 3, 4]);
  });
});
