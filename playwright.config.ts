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
      testMatch: /ui-(a11y|loop-ledgers-responsive|governance-sops-responsive)\.spec\.ts/,
    },
    {
      // Chromium engine at a phone viewport. G3/G4 test CSS layout width, not
      // touch/UA emulation; isMobile's visual-viewport behavior adds noise that
      // is out of scope for a responsive-width + a11y gate.
      name: "mobile-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 393, height: 851 } },
      testMatch: /ui-(a11y|loop-ledgers-responsive|governance-sops-responsive)\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    // Next dev cold start + first-route compile can exceed the default 60s on
    // a cold cache; give it room without masking a genuine boot failure.
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      // Bind the dev server to the same port the specs target.
      PORT: String(PORT),
      // Keep the in-app sync scheduler OFF (instrumentation.ts kill switch) —
      // no background sweeps during E2E.
      PLX_MC_SYNC_ENABLED: "",
      // Defensive: ensure the auth + DB secrets are absent for THIS server even
      // if the surrounding shell happened to export them, so the open local-dev
      // path + offline fixtures stay deterministic. (Production sets these via
      // the AWS secrets loader; this only scopes the test server.)
      PLX_MC_AUTH_CLIENT_ID: "",
      PLX_MC_AUTH_CLIENT_SECRET: "",
      PLX_MC_STAGING_PASSWORD: "",
      PLX_MC_DATABASE_URL: "",
    },
  },
});
