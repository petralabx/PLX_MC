# Bundle Index — PLX Design-System Authority & Propagation (ADR proposal, 2026-06-17)

| File | Description |
| --- | --- |
| REPORT.md | ADR proposal: brand-authority design-system structure + versioning, opt-in manifest + registry, and push-based change propagation with an adopt/decline decision ledger. PROPOSED — review before build. |

Decisions locked with the user: push-based notification (authority dispatches); design/ADR first (no changes to plx-customer-portal until approved); distribution = git-native versioned, hash-verified releases consumed via a pinned source-sync (recommended over an npm package for reliability + flexibility + diff/decline tracking).
