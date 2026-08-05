# Research — Unified PLX Document and Knowledge Architecture

Research date: 2026-08-04. This recovery preserves the decisions recorded on
`TASK-477` while independently checking repository evidence and primary
technical sources. Product, legal, licensing, and tenant-specific claims remain
unverified until their named Phase 0 gates pass.

## Recovered decision record

Mission Control records that the approved design is:

- SharePoint/Purview remains document and records authority and the system of
  record for Mission Control planning records.
- Portal gold tables remain customer, product, and vendor workflow authority.
- Mission Control governs execution, routing, and evidence policy.
- A Postgres-first bitemporal knowledge ledger stores versioned assertions,
  provenance, ontology versions, and receipts.
- Graph, vector, text, cache, and PLX Second-Brain are derived projections.
- Portal hosts the ontology and evidence workbench.
- The existing Portal document stack is reused after its implementation is
  accessible and pinned.

The prior commit `2d429b03c3e3be7e3d1d07f24d0b3eebf6bce538` was never pushed:
the current clone has no object for it, GitHub returns `404`, and no prior PR
exists. This package therefore reconstructs the decision from the MC evidence
and re-verifies claims instead of representing the missing commit as recovered
source.

## Repository evidence

| Evidence | Verified fact | Consequence |
|---|---|---|
| `AGENTS.md`, `SOUL.md`, `docs/modules/sync/README.md` | SharePoint is the canonical system of record for Mission Control human planning data; the current correctness path is Graph delta sync. | Reuse source authority and mirror discipline; do not make the knowledge layer a planning-data authority. |
| `src/lib/sync/documents.ts` | Project Documents mapping is inbound-only; SharePoint remains authoritative and deletions are audited and skipped in this increment. | The unified connector must add explicit tombstone/reconciliation behavior without changing current source ownership. |
| `config/sharepoint-schema.json` | Project Documents already classifies PRD, Evidence, Deed, Report, Spec, and Export and names Vince as site owner. | Extend content types/metadata only after estate review; do not create a parallel library by default. |
| `AGENTS.md` plus `mc_self_check` on 2026-08-04 18:40 UTC | Repository doctrine blocks new planes until the mirror-is-boring gate is met; the observed live self-check reported fresh data, `boringTickStreak: 4158`, threshold 7, and `boringGateMet: true`. | Encode a recurring gate for ontology/discovery milestones; do not treat one historical pass as perpetual authorization. |
| `docs/architecture/knowledge-entry.json` | The existing architecture collection is a derived, generated consumer with Git authoring return paths and visible degradation when Second-Brain is unavailable. | Use this collection as the first pilot and preserve its authority contract. |
| `docs/modules/loop-ledgers/README.md` | Mission Control already uses validated, read-only, degraded-visible cross-repo projections without writing back to source ledgers. | Reuse registry, validator, source-adapter, and degraded-state patterns. |
| `docs/modules/permissions/README.md` | Mission Control has a deny-by-default typed authorization kernel and durable service-principal capabilities. | Extend central capabilities; do not invent route-local or prompt-only authorization. |
| `docs/modules/mcp/README.md` | MCP checkout/completion links agent execution to a human owner, repository, task, evidence, and audit event. | Knowledge actions by agents must use the same identity and evidence boundary. |
| `config/skills-catalog.json` | Skills have a canonical repository and immutable release pin. | Index skill releases by canonical pin; never treat an installed copy as authority. |

The private Portal repository was not readable through this Cloud Agent's
configured GitHub identity on 2026-08-04. Claims that `portal/src/lib/docusign.ts`
or Ricardo's broader document stack are go-live-ready remain a Phase 0
verification item, not a fact asserted by this package.

## Primary-source evidence

### Provenance and ontology

| Source | Verified claim | Design implication |
|---|---|---|
| [W3C PROV-O Recommendation](https://www.w3.org/TR/prov-o/) | PROV-O defines interoperable provenance around `Entity`, `Activity`, and `Agent`, with derivation, attribution, revision, invalidation, usage, and delegation relationships. | Model source objects/assertions as entities, connector and projection runs as activities, and humans/services/agents as attributable agents. Specialize the vocabulary rather than inventing opaque lineage fields. |
| [W3C SKOS Reference](https://www.w3.org/TR/skos-reference/) | SKOS supports concept schemes, preferred/alternate labels, broader/narrower/related relations, and exact/close mappings between schemes. | Use stable concept IDs, governed labels/synonyms, explicit hierarchy, and mappings. SKOS logical inference is not a complete data-quality constraint system, so publication still needs deterministic validation. |
| [W3C OWL 2 Overview](https://www.w3.org/TR/owl2-overview/) | OWL 2 provides formal ontology semantics and profiles with different expressivity/complexity trade-offs. | Start with SKOS plus narrow PLX constraints; adopt OWL reasoning only for approved use cases that justify operational complexity. |

### Microsoft 365, SharePoint, Graph, and Purview

| Source | Verified claim | Design implication |
|---|---|---|
| [SharePoint managed metadata](https://learn.microsoft.com/en-us/sharepoint/managed-metadata) | Managed terms have unique IDs, labels/synonyms, global or local scope, open/closed contribution, and role-governed administration. Microsoft states consistent metadata improves discovery and refinement. | Map approved ontology releases to managed metadata where appropriate; keep the Portal workbench as the governed proposal/impact experience, not an untracked replacement for the Term Store. |
| [Microsoft Graph delta query](https://learn.microsoft.com/en-us/graph/delta-query-overview) | Delta query tracks created, updated, and deleted entities using opaque state tokens, but support and tracked properties vary by resource and old tokens may expire. | Persist opaque cursors, replay idempotently, support token reset/full reconciliation, and never assume all relationship or ACL changes appear in every resource delta. |
| [Microsoft Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview) | Notifications are subscription based, require lifecycle management, and may contain only an object ID; Microsoft documents lifecycle notifications for missed-notification risk. | Notifications are an acceleration path. Delta/full reconciliation remains the correctness backbone, matching current PLX sync doctrine. |
| [Microsoft Search API overview](https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview?view=graph-rest-1.0) | Delegated search runs in the signed-in user's context. Application permissions expose different, broader behavior and have region/private-content considerations. | Prefer delegated/source-context search where possible. Broad application search requires explicit estate, residency, privacy, and least-privilege approval. |
| [Graph duplicate trimming](https://learn.microsoft.com/en-us/graph/search-concept-trim-duplicate) | SharePoint file search can trim duplicate results, with documented resource and pagination limitations. | Treat Graph's duplicate trimming as one signal, not an enterprise duplicate registry or destructive dedupe mechanism. |
| [Purview retention policies and labels](https://learn.microsoft.com/en-us/purview/retention) | Policies and item-level labels can retain/delete content; labels can travel with moved content, mark records, drive disposition review, and provide proof of disposition. Capabilities and restrictions differ by label type. | Source retention remains in Purview. The ledger records policy references and receipts but must not simulate or override Purview disposition. |
| [Purview audit overview](https://learn.microsoft.com/en-us/purview/audit-solutions-overview) | Audit retention differs by license; Standard defaults to 180 days, Premium can provide one year for covered workloads/users, and 10-year retention needs an add-on and is not retroactive. | Tenant and user licensing is a hard gate. A design cannot infer audit-retention sufficiency from "Purview enabled." |
| [Microsoft 365 data residency](https://learn.microsoft.com/en-us/microsoft-365/enterprise/m365-dr-overview?view=o365-worldwide) | Product Terms, Multi-Geo, and Advanced Data Residency provide different commitments by service and tenant eligibility. | Inventory actual tenant geography and licenses. Every derived store and model endpoint needs a separately approved residency decision. |

### Versioned ledger implementation

| Source | Verified claim | Design implication |
|---|---|---|
| [PostgreSQL range types](https://www.postgresql.org/docs/current/rangetypes.html) | PostgreSQL provides timestamp ranges, overlap/containment operators, GiST indexes, and exclusion constraints that can prevent overlapping ranges. | A Postgres ledger can represent valid-time ranges and constrain overlapping current assertions. Transaction time still requires append/supersede discipline and tests; range types alone do not create a bitemporal system. |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | JSON Schema defines a machine-checkable contract for JSON instances. | The program schema freezes dispatch shape; custom validation handles cross-reference, DAG, and coverage invariants outside JSON Schema's practical scope. |

### 21 CFR Part 11

| Source | Verified requirement | Design implication |
|---|---|---|
| [21 CFR Part 11, FDA-access copy](https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfcfr/CFRSearch.cfm?CFRPart=11&showFR=1) | Sections 11.10 and 11.30 require controls appropriate to closed/open systems, including validation, accurate/complete copies, record protection/retrieval, access limitation, secure time-stamped audit trails, operational/authority/device checks, training, accountability, and documentation controls. Sections 11.50–11.300 govern signature manifestations, record linkage, uniqueness, identity verification, certification under 11.100(c), non-biometric signature components and sessions under 11.200, and identification-code/password controls. | Translate only the controls inside an approved intended-use and predicate-rule boundary into validation requirements. Architecture is not a compliance determination. |
| [FDA 2003 Part 11 Scope and Application guidance](https://www.fda.gov/media/75414/download) | FDA describes enforcement discretion for some Part 11 provisions while expecting continued compliance with predicate rules and recommending justified, documented risk-based decisions. | Do not read enforcement discretion as removal of predicate-rule obligations. Quality and Legal own applicability and validation depth. |
| [FDA electronic systems guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/electronic-systems-electronic-records-and-electronic-signatures-clinical-investigations-questions) | FDA explains that audit trails support reconstruction and should capture attributable creation/modification/deletion without obscuring prior data. This guidance targets clinical investigations. | Use it as supporting control rationale, not as proof that PLX's cosmetics workflows are clinical-investigation systems. |

## Divergence pass

Five materially different approaches were considered before carrying forward the
approved design.

| Approach | Rough probability of best fit | Why it could win | Why it fails or is insufficient | Preserved insight |
|---|---:|---|---|---|
| SharePoint/Purview only | 15% | Maximum reuse of Microsoft records, metadata, search, ACL, and retention. | Cannot represent cross-system assertion lineage, bitemporal corrections, Git/agent/tool provenance, or disposable non-M365 projections cleanly. | Keep documents and records controls in M365. |
| Graph/vector database as the hub | 8% | Fast semantic and relationship queries. | Makes a projection look authoritative, complicates retention and correction, and creates vendor/model lock-in. | Use graph/vector as disposable indexes. |
| PLX Second-Brain as authority | 5% | Reuses memory and relationship capabilities. | Its implementation and repository are unverified; memory confidence is not document authority, and outage would become existential. | Keep it as an optional derived consumer. |
| Federated search with no ledger | 22% | Lowest initial data duplication; source-native authorization. | Weak durable provenance, ontology versioning, cross-source contradiction handling, projection receipts, and historical as-of explanation. | Preserve canonical deep links and source-native search adapters. |
| Knowledge Ledger with Disposable Projections | 50% | Separates source authority from versioned assertions and replaceable retrieval surfaces; supports provenance, ontology evolution, and rebuild drills. | Requires disciplined source mapping, connector operations, and a carefully bounded ledger to avoid becoming another document store. | Selected; bounded by authority and authoring-return contracts. |

## Findings that changed or constrained the design

1. **"SharePoint is canonical" needs scope.** It is canonical for Mission
   Control planning and business-owned documents, not automatically for Git
   contracts, Portal gold records, DocuSign envelope evidence, or ledger-native
   assertions.
2. **Notifications are not correctness.** Graph notifications accelerate
   freshness; delta and reconciliation must recover missed events.
3. **Security trimming must precede semantic ranking.** Post-generation
   filtering can leak restricted facts through answer text, embeddings, caches,
   counts, or citations.
4. **Purview capability is license- and tenant-specific.** Retention, audit, and
   residency claims remain blocked until live inventory.
5. **SKOS is an interoperability vocabulary, not the whole workbench.** PLX
   still needs publication validation, impact previews, ownership, approvals,
   effective dates, and rollback.
6. **Part 11 is an intended-use decision.** The package defines traceable
   controls and gates but does not declare PLX compliant.
7. **The Portal reuse claim is not yet independently verified.** Inaccessible
   source is recorded as a hard gate instead of being replaced by speculation.

## Research residuals

- Exact M365 tenant SKUs, regions, Purview configuration, records schedules,
  audit policies, and Graph application permissions.
- Exact Portal document, DocuSign, customer, vendor, and gold-table contracts.
- Exact PLX Second-Brain repository, schema, model providers, retention, and
  deletion behavior.
- Final audit-store immutability mechanism and recovery objectives.
- Quality/Legal regulated-record inventory, predicate rules, signature meaning,
  audit-review procedure, training records, and validation deliverables.
- Approved thresholds for retrieval quality, duplicate detection, staleness,
  contradiction, freshness, deletion propagation, and tenant leakage.
