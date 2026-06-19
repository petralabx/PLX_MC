# Module Contracts

<!-- The index of every module in the system. Each module has exactly one
     contract README defining What, Why, How, Dependencies, Owner. Agents
     consult this index before creating anything new (Pillar 3: Reuse
     Before Create). -->

Every module in the codebase has a contract README at
`docs/modules/<module>/README.md`. Use `_template/README.md` when creating one.

A new module without a contract README is a hygiene violation. When a module's
key files change, update its contract in the same PR.

## Module Index

| Module | Owner | Criticality | Contract |
|---|---|---|---|
| governance | Vince | High | `docs/modules/governance/README.md` |
| design-system | Vince | High | `docs/modules/design-system/README.md` |
| web | Vince | Critical | `docs/modules/web/README.md` |
| sync | Vince | Critical | `docs/modules/sync/README.md` |
| meeting-intake | Vince | Medium | `docs/modules/meeting-intake/README.md` |
| compliance | Vince | Critical | `docs/modules/compliance/README.md` |
