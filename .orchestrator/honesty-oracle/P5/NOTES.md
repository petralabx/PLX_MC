# P5 NOTES — Shared checkout core proof + door audit

## Change
- Both doors already called `checkout()` in `src/lib/compliance/service.ts`; no redesign.
- `CheckoutInput.door` (`mcp` | `compliance`) recorded on the checkout audit payload.
- `/api/cursor/checkout` (via `actionCheckout`) sets `door: "mcp"`; `/api/compliance/checkout` sets `door: "compliance"`.
- `latestCheckoutDoor()` on compliance repo; self-check honesty exposes `lastCheckoutDoor` (cheap, DB-bound, fail-open).
- `scripts/compliance-checkout.mjs` prints one-line banner when enabled: `fallback path — prefer MCP checkout`.
- Proof test: `tests/checkout-shared-core.test.ts`.

## Acceptance
```
npx vitest run tests/checkout-shared-core.test.ts  → exit 0 (2 tests)
git diff --check → clean
```

## MC
TASK-490 · MC-Checkout: dsp_mrnrxfuu6eu8lh · owner Vince
