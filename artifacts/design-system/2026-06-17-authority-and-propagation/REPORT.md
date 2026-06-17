# ADR — PLX Design-System Authority & Change Propagation

**Status:** PROPOSED (review before build)
**Date:** 2026-06-17
**Authority repo:** `taylorvalton/plx-customer-portal`
**First consumer:** `taylorvalton/PLX_MC`
**Decision owner:** Vince

> This document is a **design proposal for review**. No changes have been made to
> `plx-customer-portal`. On approval it is formalized as `docs/design-system/decisions/ADR-005-*`
> in the authority repo and built in three phases (below).

---

## 1. Context / problem

PLX wants `plx-customer-portal` to be the **single brand-authority design system** that
other PLX repos (starting with PLX_MC "Mission Control") can adopt **plug-and-play**,
while:
- **Opt-in is a recorded decision at repo-setup time** — internal apps adopt; consumer-facing
  **brands** keep their own identity and explicitly opt out, on the record.
- When the authority's design system changes, adopting repos (and their **agents**) are
  **notified**, shown the **diff**, and choose to **adopt or decline** — with the diff and the
  decision **tracked and recorded** for a full audit trail.

Today the design system already exists in `plx-customer-portal/docs/design-system/`
(`tokens.css` + `tokens.ts`, ADR-001..004, `COMPONENT-INVENTORY.md`, font assets, brand
specs). PLX_MC consumes it as a **runtime mirror** (`src/styles/brand-tokens.css`) with a
provenance line in `HANDOFF-README.md`. Verified 2026-06-17: PLX_MC's tokens + fonts are
**byte-identical** to `plx-customer-portal@staging` (`fb8e065`). What's missing is the
**versioning, the explicit opt-in contract, and the change-propagation automation**.

Constraint: **Next.js 16 / Turbopack refuses to import CSS from outside the project root**
("leaves the filesystem root"). This is why a runtime mirror exists and why any distribution
method still needs a **copy step** into each consumer.

---

## 2. Decision (summary)

A **git-native, versioned, integrity-hashed design-system "release"** in the authority,
consumed by each repo via a **pinned source-sync**, with **push-based** change propagation
that opens an **adopt/decline PR** carrying a **computed diff**, and a **per-consumer ledger**
that records every decision.

Three pillars: **(A) Authority package + versioning**, **(B) Opt-in manifest + registry**,
**(C) Push propagation + decision ledger**.

### Distribution choice — why pinned source-sync over an npm package
Chosen for the stated priorities (flexibility, automation, reliability):
| Criterion | Pinned source-sync (CHOSEN) | npm package (GitHub Packages) |
|---|---|---|
| Reliability | No registry dependency; `sha256`-verified artifacts | Registry + auth can fail/expire |
| Flexibility / decline | Explicit per-consumer pin; decline = pin holds (recorded) | Pin via lockfile; decline = don't bump |
| Diffs | **Computed** (pinned vs new tokens) | Inferred from changelog |
| Turbopack copy-step | Required either way | **Still** required (can't import from node_modules cross-root) |
| Setup cost | Low (git + CI) | Registry + per-consumer auth |
A package adds registry overhead **without removing the sync**, so source-sync is the leaner,
more reliable, equally-automatable first-class path. It upgrades cleanly to a package later.

---

## 3. Pillar A — Authority package + versioning (`plx-customer-portal`)

Promote the design system to a first-class, versioned, distributable bundle:

```
plx-customer-portal/
  design-system/                 # NEW — the canonical distributable
    manifest.json                #   version (semver) + per-artifact sha256 + integrity hash
    CHANGELOG.md                 #   one entry per version (human + machine readable)
    tokens.css                   #   canonical token spec
    tokens.ts                    #   typed token export
    fonts/                       #   brand fonts (Mazius Display, ...)
    README.md                    #   how to consume + the contract
  docs/design-system/            # KEEP — the "why": ADRs, COMPONENT-INVENTORY, specs/
    decisions/ADR-005-*.md       #   this ADR, formalized on approval
  consumers.yaml                 # NEW — registry of adopting/opted-out repos (Pillar B)
  .github/workflows/
    design-system-release.yml    # NEW — release gate + dispatch fan-out (Pillar C)
```

`design-system/manifest.json` (the pin target + integrity source):
```json
{
  "name": "plx-design-system",
  "version": "1.0.0",
  "channel": "staging",
  "sourceCommit": "fb8e065",
  "artifacts": [
    { "path": "tokens.css", "sha256": "<hash>" },
    { "path": "tokens.ts",  "sha256": "<hash>" },
    { "path": "fonts/MaziusDisplay-Regular.woff2", "sha256": "2220486909addce8…" },
    { "path": "fonts/MaziusDisplay-Italic.otf",    "sha256": "d18a599f…" }
  ],
  "integrity": "sha256-<hash over the sorted artifact hashes>"
}
```

**Release gate** (`design-system-release.yml`, on PR touching `design-system/**`): fails unless
(1) `manifest.json.version` is bumped, (2) a matching `CHANGELOG.md` entry exists, (3) the
artifact `sha256`s + `integrity` are regenerated and consistent. This makes every design-system
change an explicit, versioned, hashed **release** — the foundation everything else pins to.

**Baseline:** the current tokens/fonts (`fb8e065`) are tagged **v1.0.0**.

---

## 4. Pillar B — Opt-in manifest + registry (recorded at setup)

**Each repo** declares its decision in a root **`plx-brand.json`** (read by humans, CI, and agents):

```json
// Adopting app (PLX_MC):
{ "designSystem": {
    "adopts": true,
    "authority": "taylorvalton/plx-customer-portal",
    "channel": "staging",
    "pinnedVersion": "1.0.0",
    "pinnedIntegrity": "sha256-…",
    "decidedBy": "vince", "decidedAt": "2026-06-17",
    "rationale": "Mission Control is a 4th portal surface sharing the brand token layer (ADR-003)."
} }
```
```json
// A brand site that opts out — recorded, so it's understood:
{ "designSystem": {
    "adopts": false,
    "decidedBy": "vince", "decidedAt": "2026-06-17",
    "rationale": "Consumer-facing brand with its own visual identity; intentionally NOT on the PLX portal brand."
} }
```

**Authority registry** `consumers.yaml` — the fan-out list + the recorded opt-outs:
```yaml
adopting:
  - repo: taylorvalton/PLX_MC
    pinnedVersion: "1.0.0"
optedOut:
  - repo: taylorvalton/<brand-site>
    decidedAt: "2026-06-17"
    rationale: "Own brand identity"
```
A repo-setup checklist (template) makes recording the decision a required step.

---

## 5. Pillar C — Push propagation + decision ledger

```
                 plx-customer-portal                         PLX_MC (each adopting consumer)
  ┌───────────────────────────────────────┐     ┌──────────────────────────────────────────────┐
  │ design-system/** change merged         │     │ .github/workflows/design-system-adopt.yml      │
  │   → release gate (version+changelog+   │     │   on: repository_dispatch[plx-ds-update]       │
  │     hashes)                            │     │   → plx-ds-sync --check (fetch authority@vNEW, │
  │   → on new version on `channel`:       │     │     sha256-verify, compute diff vs pin)        │
  │       read consumers.yaml              │ ──▶ │   → open ADOPT/DECLINE PR:                      │
  │       repository_dispatch to each      │ GH  │       • diff (token/font changes)              │
  │       adopting repo (GitHub App token) │ App │       • CHANGELOG excerpt                       │
  └───────────────────────────────────────┘     │       • decision checklist + label             │
                                                 │       • branch already carries synced files    │
                                                 └──────────────────────────────────────────────┘
```

**The decision (human or agent):**
- **ADOPT** → merge the PR → updates the runtime mirror + bumps `plx-brand.json.pinnedVersion`
  + appends a `SYNC-LOG.md` entry.
- **DECLINE** → close the PR with a rationale → a one-line commit appends
  `declined vNEW — <reason>` to `SYNC-LOG.md`; the **pin holds** (consumer stays on its version,
  decision recorded).
- **Decline the whole system** → set `plx-brand.json.adopts:false` (recorded) → authority moves
  the repo to `consumers.yaml: optedOut`; no further dispatches.

**Ledger** `design-system/SYNC-LOG.md` (per consumer) — the audit trail:
```
## v1.0.0 → v1.1.0   (2026-07-02)
- diff: --p-accent #244A39→#1F4233; +--p-space-8; fonts unchanged
- decision: ADOPTED by @agent-x (low-risk: color refinement, no breaking token removed)  PR #57
## v1.1.0 → v2.0.0   (2026-08-10)
- diff: BREAKING — removed --p-card (already deprecated)
- decision: DECLINED by vince — "defer until Q4 surface audit"  (pin holds at 1.1.0)
```

**Agent integration:** the adopt/decline PR is machine-readable (computed diff + a decision
template + a `design-system-update` label), so a Claude Code agent can evaluate the diff against
the consumer's constraints and **auto-adopt low-risk (patch/minor)** changes while **flagging
breaking (major)** changes for a human — policy configurable per consumer.

**Security:** cross-repo dispatch uses a **least-privilege GitHub App** (not a broad PAT),
scoped to the adopting repos; kill-switch = disable the release workflow or the App.

---

## 6. Open sub-decisions (need your call before/at build)

1. **Release channel** — is `staging` the "published" ref consumers pin to, or `main`? (Today
   PLX_MC's provenance points at `staging`.)
2. **Cross-repo auth** — GitHub App (recommended) vs a fine-grained PAT.
3. **Semver policy for tokens** — what's *major* (token removed/renamed), *minor* (token added),
   *patch* (value tweak)? Drives the agent auto-adopt policy.
4. **Agent auto-adopt policy** — auto-adopt patch/minor + human-gate major? Or human-gate all
   initially, relax later?

---

## 7. Rollout (phased; one PR per phase per repo)

- **P1 — Authority** (`plx-customer-portal`): `design-system/` package + `manifest.json` +
  `CHANGELOG.md` + `design-system-release.yml` gate; baseline **v1.0.0** (`sourceCommit fb8e065`);
  formalize this as `ADR-005`.
- **P2 — Consumer** (`PLX_MC`): `plx-brand.json` (pinned v1.0.0, integrity-verified against the
  proven byte-identical state), `scripts/plx-ds-sync.mjs`, `design-system/SYNC-LOG.md` seeded,
  preflight check that the mirror matches the pin.
- **P3 — Automation**: `design-system-release.yml` dispatch fan-out (authority) +
  `design-system-adopt.yml` (consumer) + the GitHub App; validated by cutting a **v1.0.1** and
  watching the adopt PR open in PLX_MC.

---

## 8. Consequences

- **+** One versioned source of truth; adoption is explicit + recorded; changes propagate with a
  human/agent decision gate; every diff + decision is auditable; no registry dependency.
- **−** Two CI workflows + a GitHub App to maintain; each consumer carries a small sync script +
  ledger; the Turbopack copy-step remains (unavoidable).
- **Reversible:** a consumer can decline any update or the whole system at any time (recorded);
  the authority structure is additive to today's `docs/design-system/`.
