# LESSONS.md

<!-- The institutional memory file. Every correction, incident, or surprising
     failure becomes a dated entry here. Agents read this at session start and
     must not repeat documented mistakes. Recurring lessons get promoted into
     .cursor/rules/ so they are enforced, not just remembered. -->

## How to write an entry

- Date it (YYYY-MM-DD, with timezone if relevant).
- State what went wrong in one line.
- State the root cause in one line.
- State the rule going forward — actionable, checkable, present tense.
- If the lesson recurs 3+ times, promote it to a rule in `.cursor/rules/`
  and/or a gate in `scripts/preflight.sh`, then note the promotion here.

## Lessons

### 2026-07-23 (UTC) — Edge middleware bundle rejects Node APIs in reachable modules

- **What happened:** Adding an fs-read of the vendored RDS CA bundle to
  `src/lib/db/tls.ts` broke the production build (CI + Vercel): the Edge
  Middleware bundle reaches `db/` through
  `permissions/repository → auth → middleware`, and Turbopack rejects
  `process.cwd()`/`node:fs` usage anywhere in an edge-bundled module — even
  inside function bodies the middleware never calls, and even when the module
  only enters the graph via a lazy `await import`.
- **Root cause:** Assumed "Node API not invoked at module scope" was enough;
  the edge compiler checks usage sites, not execution reachability.
- **Rule going forward:** Assets a server module needs at runtime ship as
  JSON modules (bundler-native, edge-safe), not fs reads — see
  `config/certs/aws-rds-global-bundle.json`. Anything importable from
  `src/lib/auth`, `src/lib/permissions`, or `src/lib/db` must stay free of
  Node-API usage; verify with `npm run build`, not just typecheck/tests.

### 2026-07-20 (ET) — User-level PLX-MC MCP pinned portal while editing the hub

- **What happened:** PR #152 compliance blocked because checkout
  `dsp_mrtfq9vcdskmn8` was minted with `MC_REPO=petralabx/plx-customer-portal`
  while the PR targeted `petralabx/PLX_MC`.
- **Root cause:** `~/.cursor/mcp.json` had a single `PLX-MC` server hard-pinned
  to the portal slug; it overrode the repo-local hub `MC_REPO` for agent tools.
- **Rule going forward:** Keep distinct MCP entries — `PLX-MC-Hub`
  (`petralabx/PLX_MC`) and `PLX-MC-Portal` (`petralabx/plx-customer-portal`).
  Before first checkout, confirm `mc_self_check` / tool `meta.actor.repo` matches
  the repo under edit; if not, use `scripts/compliance-checkout.mjs` with an
  explicit `MC_REPO`.

### 2026-07-16 (ET) — Checkout success hid the wrong repository scope

- **What happened:** A checkout returned success for `petralabx/PLX_MC` while
  the work targeted `petralabx/plx-customer-portal`; the portal compliance gate
  later rejected the stamped PR.
- **Root cause:** The agent trusted tool success without comparing the returned
  Task and repository metadata to the intended work.
- **Rule going forward:** Before first push, validate the expected Task ID,
  exact full repository slug, and exact returned `MC-Checkout` line. If metadata
  is missing or mismatched, stop and use the explicit-`MC_REPO` capture/HTTP
  path. Promoted to `docs/AGENT-PR-SOP.md` and enforced in
  `scripts/compliance-checkout.mjs`.

### 2026-07-15 (ET) — Governed sessions could checkout tasks but could not create them

- **What happened:** The PLX MC MCP authenticated successfully but both its
  create tool and compliance fallback returned `capability_not_granted`.
- **Root cause:** `sp_mcp_cursor` exposed `mc_create_task` while its reviewed
  service grant bundle deliberately omitted `task.create`.
- **Rule going forward:** Keep exposed MCP mutation tools and reviewed service
  grants aligned through policy-versioned contract tests before production
  activation.

### 2026-07-15 (ET) — Checkout recorded accountability without assigning the task owner

- **What happened:** Agent checkout persisted `accountableHuman` on the dispatch,
  but a task with `accountableOwner: null` stayed ownerless and the compliance
  gate blocked the stamped PR.
- **Root cause:** The checkout handshake and task mutation were implemented as
  separate concerns, and the MCP stdio completion schema also lagged the REST
  evidence contract.
- **Rule going forward:** Checkout idempotently backfills only a missing owner
  through the canonical human directory, maps operator/service aliases to the
  PLX human default, and keeps MCP tool schemas in parity with their REST routes
  through focused contract tests.

### 2026-07-14 (ET) — Playwright finished every test but never released Next on Windows

- **What happened:** The pre-push gate reached all 195 Playwright cases twice,
  but `playwright test` never emitted its summary or exited until the stale
  Next listener was terminated manually.
- **Root cause:** Playwright owned a Windows `npm`/shell/Next web-server process
  tree that it did not tear down after the final test. Per-test success did not
  imply runner/process success.
- **Rule going forward:** The canonical E2E command uses a bounded Node runner
  that owns Next directly, runs Playwright against the existing server, and
  terminates Next in `finally`. A test gate is green only when the runner exits
  0; reaching the final test is not completion evidence.

### 2026-07-11 (ET) — Merged redesign was mistaken for a production deployment

- **What happened:** PRs #116 and #117 merged with green PR and `main` CI, but
  `mc.plxcustomer.io` still served an older Vercel deployment from before the
  redesign. The stale UI was discovered only after the operator checked the
  live custom domain.
- **Root cause:** Merge/CI evidence was treated as deployment evidence without
  checking the Vercel project link, production deployment SHA/ref, alias, or
  hydrated live DOM. The Vercel Git link was null, so `main` could not
  auto-deploy.
- **Rule going forward:** Never claim production delivery from GitHub state
  alone. Verify and record the provider deployment ID, Ready state, deployed
  SHA/ref, custom-domain alias, live smoke result, and rollback deployment.
  Promoted to `.cursor/rules/deployment-verification.mdc`.

### 2026-07-09 (ET) — OIDC cutover follow-ups lived only in chat until asked

- **What happened:** Path B OIDC dual-auth shipped (PR #112) with explicit
  deferred work (retire `COMPLIANCE_CI_TOKEN` happy-path; fleet Phase 2 for
  swarm/portal), but those follow-ups were not MC tasks until the operator
  asked.
- **Root cause:** Agents treated “document in PR / evidence bundle” as enough
  for deferred work and skipped creating bucket-scoped MC tasks.
- **Rule going forward:** On every PR commit, review project/bucket/tasks and
  **add follow-up MC tasks** for deferred work in the right bucket before
  calling the primary task done. Enforced by
  `.cursor/rules/mc-plan-hygiene-on-pr.mdc`.

### 2026-07-09 (ET) — Vendor-spend migration collided with main's 014 after a clean rebase

- **What happened:** `feat/ai-spend-observatory` rebased cleanly onto `origin/main`
  at `a1317bf` with `014_vendor_spend.sql`, then `#108` landed
  `014_bucket_dirty_fields.sql` on main. A second rebase produced a duplicate
  `014` prefix; the migration gate failed, and staging briefly recorded both
  filenames in `schema_migrations`.
- **Root cause:** Migration prefixes are globally serialized across the whole
  repo, not per-feature. A clean rebase onto yesterday's main is not proof the
  next number is still free at ship time.
- **Rule going forward:** Immediately before opening a PR that adds a numbered
  migration, `git fetch origin main` and re-check
  `python scripts/check-migrations.py` against the rebased tree. If main took
  the prefix, renumber (and update module README + rollback) before push. If
  staging already applied the old filename via `CREATE IF NOT EXISTS`, apply
  the new filename then delete only the orphan `schema_migrations` row — never
  drop the live tables.

### 2026-07-02 (ET) — Six agent PRs merged without MC task checkout; work was invisible in Mission Control

- **What happened:** PRs #89–#95 (brand parity, ui-ux loops, token migration,
  AA contrast, font fix) merged with no MC tasks, no `MC-Checkout` stamps, and
  nothing visible in the Mission Control buckets. The operator had to ask
  where the work went. Retro-captured as TASK-249…254 (created, checked out,
  completed with evidence, PR bodies stamped after the fact).
- **Root cause:** The PLX-MC MCP server and capture hook ship disabled by
  default per the External Integrations contract (`PLX_MC_MCP_ENABLED=0`,
  `COMPLIANCE_CAPTURE` unset), and the agent treated "integration disabled"
  as "workflow does not apply" instead of running the documented manual
  fallback (`scripts/compliance-checkout.mjs` with `MC_MCP_API_KEY` from
  `prod/ec2-secrets` — key and API were available and working the whole time).
- **Rule going forward:** Disabled tooling never waives the task discipline.
  Before the first commit of any session that will change this repo, resolve
  the work to an MC task: run the capture hook manually
  (`COMPLIANCE_CAPTURE=1 node scripts/compliance-checkout.mjs` with
  `MC_MCP_API_KEY` from `prod/ec2-secrets`, bucket
  `BKT-MISSION-CONTROL-OPS` unless the work belongs elsewhere), carry the
  `MC-Checkout` stamp in the PR body, and complete the task with evidence at
  merge. If MC is unreachable, say so in the PR body instead of skipping.

### 2026-06-24 (ET) — A PowerShell helper named its parameter `$Args`, silently dropping every splatted argument

- **What happened:** A cross-repo worktree-bootstrap helper (`Invoke-Native`)
  declared `param([string]$Exe, [string[]]$Args, ...)` and called `& $Exe @Args`.
  Bootstrap "failed" with no clear cause — `npm` printed its usage banner and
  exited 1, even though the script logged `[run] npm ci` immediately before.
- **Root cause:** `$Args` is a PowerShell **automatic variable**. The reserved
  automatic shadows the parameter when splatting (`@Args`), so the native command
  received **zero** arguments — `npm` ran bare, not `npm ci`.
- **Rule going forward:** Never name a PowerShell variable or parameter after a
  reserved automatic (`$Args`, `$Input`, `$_`, `$PSItem`, `$this`, `$Host`,
  `$Error`, `$Matches`, `$Foreach`, `$Switch`). Use an explicit name such as
  `$Arguments`. Promoted to an enforced rule in
  `config/governance-contract.yaml` (`code_standards.powershell`) so it renders
  into every agent surface.

### 2026-06-21 (ET) — ESLint was outside preflight, so lint regressions could sit undetected

- **What happened:** A React Hooks lint issue surfaced only when `npm run lint`
  was run directly; the canonical `scripts/preflight.sh --mode pre-commit` gate
  had been green because it only ran TypeScript typecheck for Node quick checks.
- **Root cause:** ESLint was defined in `package.json` but not included in
  `run_quick`, so neither local pre-commit/pre-push nor CI mode treated lint as
  part of the single definition of "passing."
- **Rule going forward:** `scripts/preflight.sh` runs `npm run lint` in
  `run_quick`, so lint executes in every preflight mode. Fix legitimate lint
  failures in code; only suppress a rule with a narrow, documented reason.

### 2026-06-19 (ET) — Called a long-lived integration branch "promotable" without diffing it against main

- **What happened:** After merging EN-005 into `feat/enhancements-integration`,
  I told the operator we were "done — just promote," and ran `npm run migrate`
  from the integration tree against the **shared** staging `plx_mc` DB. A later
  check showed integration had **diverged from main at EN-003** (ahead 20, behind
  27): main had independently shipped EN-001/002/004 + an EN-006 sync increment +
  a *different* "EN-005" (flexible buckets) + its **own** repo-registry
  persistence (`repos`/`repo_requests`, `005_repo_registry.sql`), while
  integration carried EN-006/007 compliance + EN-005 agent/repo (`mc_repos`,
  `008_repo_registry.sql`). Promotion is blocked: duplicate migration prefixes
  (`005`/`006`/`007` on both branches, different content) and two parallel
  repo-registry implementations.
- **Root cause:** Treated the integration branch as a clean fast-forward ahead of
  main without `git fetch` + a compare. Ran a DB migration from a stale branch's
  tree against a DB shared with main's deployed app, so the shared DB accumulated
  both branches' prefix-colliding migrations.
- **Rule going forward:** Before calling any branch promotable — or running its
  migrations against a shared environment — `git fetch` and compare to the deploy
  target: `gh api repos/<o>/<r>/compare/<base>...<head>` and require `behind_by==0`
  for a clean promote, else plan a reconciliation. Never `npm run migrate` from a
  feature/integration branch against a DB shared with another branch's deployed
  app; migrations are globally serialized, so a stale tree introduces prefix
  collisions. Confirm the migration set matches the deploy target's tree first.

### 2026-06-19 (ET) — `gh pr merge --delete-branch` fails when the base is in a sibling worktree

- **What happened:** `gh pr merge 44 --merge --delete-branch` merged the PR on
  GitHub but exited 1 on the local post-merge step (`'feat/enhancements-integration'
  is already used by worktree at ...`), leaving the remote head branch undeleted.
- **Root cause:** `--delete-branch` tries to check out the base branch locally and
  delete the head; the base was checked out in another git worktree, so the local
  switch failed *after* the API merge had already succeeded.
- **Rule going forward:** In multi-worktree setups, confirm the merge landed with
  `gh pr view <n> --json state,mergeCommit` regardless of the command's exit code,
  and delete the remote branch explicitly (`git push origin --delete <branch>`)
  instead of relying on `--delete-branch`. (Second distinct `--delete-branch`
  failure mode — see 2026-06-17; promote to a rule if it recurs once more.)

### 2026-06-19 (ET) — A `/tmp` Node script can't resolve repo `node_modules`

- **What happened:** `node /tmp/verify.cjs` failed with `Cannot find module 'pg'`
  even when run from the repo directory.
- **Root cause:** Node resolves `require()` relative to the **script's** location,
  not the CWD; a script under `/tmp` has no `node_modules` on its resolution path.
- **Rule going forward:** For one-off DB/verification scripts kept outside the
  repo, set `NODE_PATH="$(pwd)/node_modules"` (or place the script inside the repo
  and delete it after). Keep such scripts read-only (SELECT) and remove them when
  done.

### 2026-06-17 (ET) — `--delete-branch` mid-stack closed the next stacked PR

- **What happened:** Merging the bottom of the Cycle-2 stack (#30) with
  `gh pr merge --merge --delete-branch` deleted its head branch, which **closed**
  the next PR in the stack (#27) instead of retargeting it to `main`. A closed PR
  whose base branch no longer exists then deadlocks: "cannot change the base
  branch of a closed pull request" *and* "state cannot be changed, the branch has
  been deleted."
- **Root cause:** GitHub's auto-retarget-on-base-deletion is unreliable for
  stacked PRs; deleting a base branch that still has dependent open PRs can close
  them rather than reparent them.
- **Rule going forward:** When merging a stacked chain bottom-up, do **not** pass
  `--delete-branch` mid-stack. Merge each PR with `--merge` only, retarget the next
  child to `main` first (`gh api repos/<o>/<r>/pulls/<n> -X PATCH -f base=main`),
  then merge it; delete all head branches at the very end. To recover a
  wrongly-closed stacked PR, recreate its deleted base at the old SHA
  (`git push origin <sha>:refs/heads/<branch>`), reopen via REST
  (`gh api .../pulls/<n> -X PATCH -f state=open`), then retarget to `main`.

### 2026-06-17 (ET) — ⌘K command-palette E2E flakes on hydration timing

- **What happened:** An intermediate `push: main` CI run failed on
  `e2e/my-tasks.spec.ts:33` ("reachable via the ⌘K command palette"):
  `.mc-cmdk` not visible within 10s after `keyboard.press("ControlOrMeta+k")`.
  The identical test passed in three other runs — the later CI on a superset
  commit, the final `main` CI, and the local full `pre-push`.
- **Root cause:** `waitForHydration` anchored on the topbar sync-pill label,
  which is **server-rendered** (`"Synced"` from default store state) and so
  present in the SSR HTML. The wait resolved before React hydrated and before
  the shell's global keydown listener attached; `page.keyboard.press` has no
  actionability delay (unlike `.click()`, which is why only the keyboard test
  flaked), so it raced the handler and the keypress was dropped under CI load.
- **Rule going forward:** A hydration-readiness wait must anchor on a signal
  that only exists *after* client effects run — never on SSR-present DOM. Treat a
  lone 10s "element not found" after a key shortcut as a hydration flake: confirm
  with a re-run and harden the wait, don't chase a non-existent logic bug.
  **Fixed in #31:** the shell exposes a post-mount `data-mc-ready` marker
  (flipped only after the keydown effect attaches) and `waitForHydration` now
  waits on `[data-mc-ready='true']` (`toBeAttached`) — deterministic, no
  retries/sleeps, and it hardens every spec that waits for hydration.

### 2026-06-16 (ET) — Static asset imports fail CI typecheck (gitignored next-env.d.ts)

- **What happened:** Adding `import logo from "../../../public/brand/logo-horizontal-ink.png"`
  for the branded `/signin` page passed `npm run typecheck` locally but failed
  CI with `TS2307: Cannot find module ... .png`. The full pre-push gate had even
  run green locally, so it looked safe to push.
- **Root cause:** The `*.png` (and other static asset) module declaration ships
  via `next/image-types/global`, referenced only from `next-env.d.ts` — which is
  gitignored and generated by `next dev`/`next build`. `preflight --mode ci` runs
  `tsc` *before* any build, so in CI the file is absent and `tsc` cannot resolve
  the import. Locally it passed only because a prior build had left a stale
  `next-env.d.ts` in the tree.
- **Rule going forward:** Do not rely on static asset module imports for type
  resolution. Load `public/` assets with `next/image` using a string `src`
  (e.g. `src="/brand/x.png"`) plus explicit `width`/`height` — no ambient `*.png`
  type needed. To reproduce the CI condition before pushing, run
  `rm -f next-env.d.ts && npm run typecheck` so a stale generated file cannot mask
  the failure. Fixed on PR #24.

### 2026-06-11 (ET) — PowerShell 7 round-trip de-escaped prod/ec2-secrets unicode

- **What happened:** Merging `PLX_MC_DATABASE_URL` into `prod/ec2-secrets` via
  `ConvertFrom-Json | ConvertTo-Json` re-stored a `\uE10D` escape as a raw
  UTF-8 char; the AWS CLI's cp1252 output path then failed on every
  `get-secret-value`, breaking `~/load-secrets.ps1` until the secret was
  re-stored with `json.dumps(..., ensure_ascii=True)` via boto3.
- **Root cause:** PowerShell 7's `ConvertTo-Json` emits raw non-ASCII; the
  secret's loader-safety depends on the stored JSON staying ASCII-escaped.
- **Rule going forward:** Never round-trip `prod/ec2-secrets` through
  PowerShell JSON cmdlets. Mutate it with a tool that guarantees
  `ensure_ascii` output, and verify the loader fetch path immediately after
  any write.

### 2026-06-11 (ET) — IDE-browser snapshots fake React hydration errors

- **What happened:** The dev overlay reported hydration text mismatches
  (first in `Topbar`, later in `InboxView`), suggesting an SSR/client bug in
  the store's API hydration. The overlay's actual diff was
  `- data-cursor-ref="e37"` — an attribute the Cursor IDE browser's
  accessibility-snapshot tooling injects into the live DOM, tripping React's
  hydration comparison (the documented "extension messes with the HTML
  before React loads" case). Time was spent chasing an app bug that did not
  exist.
- **Root cause:** Snapshot instrumentation mutates the DOM while React is
  hydrating; React attributes the mismatch to the nearest component.
- **Rule going forward:** Before chasing a hydration error seen in the IDE
  browser, read the overlay's +/- diff first; if it names `data-cursor-ref`
  (or any non-app attribute), it is tooling noise — verify in a plain
  browser only if doubt remains.

### 2026-06-11 (ET) — Idle RDS pool connections hang requests without timeouts

- **What happened:** After ~80 idle minutes, the dev server's pooled Postgres
  connections had been silently dropped; the next `/api/state` request checked
  out a dead socket and hung forever (no error, no timeout) — burning two
  long waits before the root cause was found. A fresh connection to the same
  database worked instantly.
- **Root cause:** `pg.Pool` was created with no `connectionTimeoutMillis`,
  `query_timeout`, `idleTimeoutMillis`, or `keepAlive`; defaults wait
  indefinitely on dead sockets.
- **Rule going forward:** Every outbound network client gets explicit
  timeouts at creation time — pools (`connectionTimeoutMillis`,
  `query_timeout`, `idleTimeoutMillis` below the path's idle-kill window,
  `keepAlive`) and HTTP fetches (`AbortSignal.timeout`). A hanging request is
  worse than a failing one. Fixed in `src/lib/db` and `src/lib/sync/graph.ts`.

### 2026-06-10 (ET) — Killed an unrelated dev server with a too-broad process filter

- **What happened:** While clearing stray Next dev servers for this repo, a
  `node.exe` CommandLine filter of `next|PLX_MC` also matched and killed the
  operator's separate `vmc-web` dev server (port 3100). It was restarted to
  restore prior state.
- **Root cause:** The kill filter matched any process mentioning the framework
  name, not just this repository.
- **Rule going forward:** Scope process kills to this repo's full path
  (`C:\Users\agentic-winrm\PLX_MC`), never a bare framework name; print and
  eyeball the match list before issuing `Stop-Process`.

### 2026-06-10 (ET) — `localhost` in the IDE browser is not this box

- **What happened:** The IDE browser showed a different app at
  `http://localhost:3000` than this box's dev server; the browser runs on the
  operator's machine, so `localhost` resolved there.
- **Root cause:** Browser and dev server are on different hosts; the dev server
  is reachable only via this box's Tailscale IP, and Next blocks cross-origin
  `_next` dev assets by default (so the page renders but never hydrates).
- **Rule going forward:** View this box's dev server via its Network/Tailscale
  URL (printed by `next dev`) and add that origin to `allowedDevOrigins` in
  `next.config.ts` so client chunks load and hydration works.

### 2026-06-10 (ET) — Reported files missing without fetching first

- **What happened:** The founding session reported `starter-kit/` absent and
  asked the operator how to obtain it; it had been pushed after the clone and
  a plain `git pull` delivered it.
- **Root cause:** Concluded repo state from the working tree without checking
  the remote first.
- **Rule going forward:** Before reporting anything missing from the repo, run
  `git fetch` and inspect `origin/*` branches; ask only after the remote is
  ruled out.

### 2026-06-10 (ET) — Box credentials live in AWS Secrets Manager, not local config

- **What happened:** A machine-wide hunt for Microsoft Graph credentials
  (CLIs, PS modules, credential manager, env vars) found nothing; the intended
  path was the "AWS Secrets Runtime" provisioning doc — load `prod/ec2-secrets`
  (us-east-1) into the session via `~/load-secrets.ps1`.
- **Root cause:** Provisioning convention was documented in SharePoint, not on
  the box.
- **Rule going forward:** On this project, secrets always come from AWS
  Secrets Manager `prod/ec2-secrets` through the loader; check there first.
  Codified in `TOOLS.md` (Secrets Source of Truth).

### 2026-06-10 (ET) — Windows default encoding corrupted generated surfaces

- **What happened:** The governance generator wrote surfaces with the locale
  encoding (cp1252) on Windows; UTF-8 readers (and Linux CI) would fail on the
  em-dashes.
- **Root cause:** `Path.read_text()`/`write_text()` without an explicit
  encoding.
- **Rule going forward:** All repo tooling I/O pins `encoding="utf-8"` (and
  `newline="\n"` on writes). Fixed in
  `scripts/generate-governance-surfaces.py`.
