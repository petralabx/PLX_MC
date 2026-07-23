import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config for the Cycle-1 Planner browser behaviors (SPEC §6
// "Browser E2E checklist" #1..#5a). Specs live in `e2e/` — deliberately OUTSIDE
// vitest's `tests/**/*.test.ts` include, so the unit suite never picks them up.
//
// ── Auth / data approach (prod-safe; documented in the harden report) ─────────
// The dev server is booted with NEITHER the Entra OIDC secrets (PLX_MC_AUTH_*)
// NOR the Basic break-glass password (PLX_MC_STAGING_PASSWORD). With both
// absent, `authorized()` (src/lib/auth) returns `true` — the EXISTING, already
// env-gated local-dev/test open path documented in src/middleware.ts. We do NOT
// add or weaken any auth code: production (where those secrets ARE set) is
// untouched. PLX_MC_DATABASE_URL is likewise unset, so `GET /api/state` returns
// 500 and the store stays on its deterministic in-memory fixtures (data.ts) —
// the store's documented offline fallback ("degrades to read-only of
// last-synced state when the server is unreachable", store.ts:6-8). Every
// Cycle-1 board/group-by/filter/drag/my-tasks behavior renders from those
// fixtures, so the suite is fully deterministic with no Postgres dependency.
// (The single assertion that needs a live Postgres-backed /api/state — drag →
// reload → STILL persisted, SPEC #3 — is implemented and test.skip()'d with an
// annotated reason in drag.spec.ts; the optimistic move + rollback paths run
// for real.)

const PORT = Number(process.env.PLX_MC_E2E_PORT ?? 3931);
// Use `localhost` (not 127.0.0.1): Next 16's Turbopack dev server blocks
// cross-origin access to its /_next/* dev resources (HMR, the dev-error
// overlay) for any host not in `allowedDevOrigins`, and its bound dev origin is
// `localhost`. Targeting `localhost` keeps the test host == the dev origin, so
// no app-side `allowedDevOrigins` change is needed and no overlay intercepts.
const HOST = process.env.PLX_MC_E2E_HOST ?? "localhost";
const BASE_URL = `http://${HOST}:${PORT}`;
const EXTERNAL_SERVER = process.env.PLX_MC_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "e2e",
  // Fail the run if a spec is accidentally left focused (.only) — CI hygiene.
  forbidOnly: !!process.env.CI,
  // Native HTML5 DnD + dev-server compiles can be momentarily slow; keep the
  // budgets generous but bounded. No arbitrary sleeps live in the specs — these
  // are ceilings for web-first auto-retrying assertions only.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // One shared Next server; parallel workers on Windows starve navigation/clicks
  // under Turbopack compile load (goto/action timeouts that pass in isolation).
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // The ui-ux-design-loop G3/G4 gates run across a desktop/tablet/mobile matrix.
  // Only the UI-loop specs run on the tablet/mobile projects — the existing
  // Cycle-1 specs assume a desktop layout and stay chromium-only (so the full
  // `npx playwright test` does not run desktop specs at mobile widths).
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Chromium engine at a tablet viewport (the iPad descriptor defaults to
      // webkit, which is not installed in CI; we only need the width for G3).
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 } },
      testMatch: /ui-(a11y|signin-responsive|inbox-responsive|signin-a11y|inbox-a11y|loop-ledgers-responsive|governance-sops-responsive|board-responsive|board-a11y|task-detail-responsive|task-detail-a11y|sync-console-responsive|sync-console-a11y|repos-responsive|repos-a11y|skills-responsive|skills-a11y|insights-responsive|insights-a11y|ai-spend-responsive|ai-spend-a11y|cmdk-responsive|cmdk-a11y|project-responsive|project-a11y|routing-inbox|architecture|ui-architecture)\.spec\.ts/,
    },
    {
      // Chromium engine at a phone viewport. G3/G4 test CSS layout width, not
      // touch/UA emulation; isMobile's visual-viewport behavior adds noise that
      // is out of scope for a responsive-width + a11y gate.
      name: "mobile-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 851 } },
      testMatch: /ui-(a11y|signin-responsive|inbox-responsive|signin-a11y|inbox-a11y|loop-ledgers-responsive|governance-sops-responsive|board-responsive|board-a11y|task-detail-responsive|task-detail-a11y|sync-console-responsive|sync-console-a11y|repos-responsive|repos-a11y|skills-responsive|skills-a11y|insights-responsive|insights-a11y|ai-spend-responsive|ai-spend-a11y|cmdk-responsive|cmdk-a11y|project-responsive|project-a11y|routing-inbox|architecture|ui-architecture)\.spec\.ts/,
    },
  ],
  webServer: EXTERNAL_SERVER
    ? undefined
    : {
        // Production server: Next 16 `dev` fails to externalize `pg` through the
        // client permissions→db import graph (pre-existing on this branch).
        // Build with inbox NEXT_PUBLIC baked, then `next start`.
        // On Windows, prefer PLX_MC_E2E_EXTERNAL_SERVER=1 + pre-started
        // `next start` if webServer teardown hangs.
        command:
          "npm run build && node ./node_modules/next/dist/bin/next start",
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 300_000,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PORT: String(PORT),
          PLX_MC_SYNC_ENABLED: "",
          PLX_MC_AUTH_CLIENT_ID: "",
          PLX_MC_AUTH_CLIENT_SECRET: "",
          PLX_MC_STAGING_PASSWORD: "",
          PLX_MC_DATABASE_URL: "",
          PLX_MC_ROUTING_INBOX_ENABLED: "1",
          NEXT_PUBLIC_PLX_MC_ROUTING_INBOX_ENABLED: "1",
        },
      },
});
