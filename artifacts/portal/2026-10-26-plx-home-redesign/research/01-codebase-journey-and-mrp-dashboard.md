# Codebase findings: staff journey and the MRP Dashboard (as found 2026-10-25)

Read from `petralabx/plx-customer-portal` staging on 2026-10-25, before any change in this programme.
Line numbers are from that date and will drift.

## Where staff landed after sign-in

- `portal/src/app/(auth)/login/page.tsx:23` set `DEFAULT_CALLBACK_URL = "/dashboard"` for every role.
- `portal/src/lib/auth/auth.ts` had no NextAuth `redirect` callback.
- `portal/src/app/page.tsx:7-11` redirected every signed-in visit to `/dashboard`.
- `/dashboard` is the customer dashboard. It reads `db.customer.findUnique({ userId })`. Staff have no Customer
  record, so their cards rendered empty.
- Staff reached `/mrp` only through a footer link shown to `isStaff()` (`components/layout/sidebar.tsx:99-121`).
- Docs already named `/mrp` the canonical staff home (`docs/runbooks/OPERATIONS-DEPRECATION.md:49`). No code enforced it.
- No 2FA page in the portal: staff MFA is Entra Conditional Access. Staff must use Microsoft sign-in.

**Fixed by TASK-3890 (PR #3012).**

## Roles and grants available to drive role views

- Legacy RBAC roles: CUSTOMER, SUPPLIER (level 0), STAFF, MANAGER, ADMIN, SUPER_ADMIN (`lib/auth/roles.ts`).
  Access levels L1 to L5 (`lib/auth/rbac-policy.ts`); `evaluateCoarseAccess` picks shadow or enforce.
- MRP module grants: `mrpWarehouse`, `mrpProduction`, `mrpRnD` on the user (`lib/auth/mrp-access.ts`).
- Gold `Department` table with membership (QC and QA under QUALITY parent; PROD, PROC, WH and others),
  exposed as `session.user.departmentIds`. Managed in Admin › Users.
- `departmentRoles` tags: SOURCING, PURCHASING, DOCUMENTS (`lib/auth/department-roles.ts`).

## `/mrp` "MRP Dashboard" before the redesign (`portal/src/app/mrp/page.tsx`)

Render order: OpStrip (Site and Compliance hard-coded, Open flags always 0), hero with Export CSV,
Awaiting you preview (artwork proof reviews only, 3 rows), six KPI tiles of catalogue size (Raw materials,
Packaging, Total parts, Formulas, Projects, Receipts), stability samples queue, My active projects (not
scoped to the user), Recent phase activity (phases only), Sourcing inbox (Sourcing/Purchasing/Admin),
eight module tiles each with a fixed "Live" dot.

Problems found:

- `fetchStats()` returned all zeros on any error, so 0 meant empty or failed.
- "My active projects" was everyone's, not the viewer's.
- No `loading.tsx`; the sourcing inbox fetched after the parallel batch.
- `router.refresh()` every 60 s re-ran every query on the page.
- Raw hex in `mrp-design.css` for inbox states; inconsistent styling across MRP pages.
- Training doc defined Awaiting you as "phases last advanced by you"; code counted artwork-proof WorkItems.

**Addressed by TASK-3895 (cues, flagged), TASK-3896 (Awaiting you panel), TASK-3897 (lower half),
TASK-3900 (training doc), TASK-3908 (footer sync time).**

## Signals that already existed and now feed Home

| Signal | Source |
|---|---|
| Work items routed to departments | `lib/work-routing/inbox.ts` `readAwaitingYou` |
| Open sourcing requests | `lib/sourcing/requests.ts` `loadSourcingInbox` |
| Stability pulls due/overdue | `lib/quality/stability.ts` `readStabilitySamplesQueue` |
| Short / contested batches, tank and line load | `/mrp/planning` data path (`planning-board-read.ts`, `getScheduleConflicts`) |
| Reorder demand | `api/mrp/generate-po/reorder-items`, `lib/mrp/packaging-reorder-demand.ts` |
| Activity | `ActivityEvent` (`/api/activity`), `ProjectPhaseEvent` |

No Prisma model for shortages, planned orders or MRP runs: shortages and demand are computed on the fly.
