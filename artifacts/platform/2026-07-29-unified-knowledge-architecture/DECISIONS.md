# Decisions — Unified PLX Document and Knowledge Architecture

These decisions reconstruct the approved `TASK-477` architecture. "Approved"
means approved for specification and phased implementation planning; each
Phase 0 control owner must still approve implementation in their domain.

## D-01 — Adopt Knowledge Ledger with Disposable Projections

**Decision:** A versioned knowledge ledger stores assertions, provenance,
ontology releases, ingestion/projection receipts, and tombstones. Graph, vector,
full-text, cache, summary, and Second-Brain surfaces are disposable.

**Why:** This preserves source authority while enabling cross-system history,
explanation, ontology evolution, and complete rebuilds.

**Rejected:** SharePoint-only, vector/graph-as-authority, Second-Brain-as-authority,
and unversioned federated search.

## D-02 — Keep documents and workflow state in their owning systems

**Decision:** SharePoint/Purview remains document/records authority; Portal gold
tables remain workflow authority; Git remains technical-content authority;
Mission Control remains execution authority; DocuSign remains envelope execution
authority; registries remain identity/package authority.

**Why:** A unified discovery layer must not create multiple write paths.

**Consequence:** Every result needs a canonical link and authoring return path.

## D-03 — Bound ledger authority narrowly

**Decision:** The ledger is canonical for its own versioned assertions,
provenance relationships, ontology versions, and processing receipts—not for an
editable copy of source documents.

**Why:** "Ledger" must not become a disguised enterprise content-management
replacement.

**Guard:** A user cannot correct a source-owned record only in the ledger.

## D-04 — Use a Postgres-first bitemporal model, gated by deployment review

**Decision:** Design around valid time plus transaction time, append/supersede
semantics, timestamp ranges, and non-overlap constraints.

**Why:** PLX already operates Postgres, and native range/index/constraint
primitives support clear temporal invariants without a new specialist database.

**Open before build:** deployment owner, schema, immutable audit mechanism,
encryption, region, backups, recovery objectives, and validation scope.

## D-05 — Align provenance to W3C PROV

**Decision:** Represent source and derived objects as entities, ingestion and
projection runs as activities, and humans/services/agents as responsible agents.
Preserve derivation, attribution, revision, invalidation, and delegation.

**Why:** An open interchange model is more durable and explainable than opaque
lineage fields tied to one search or model vendor.

## D-06 — Use SKOS as the ontology baseline

**Decision:** Use stable concepts, concept schemes, preferred/alternate labels,
hierarchy, related links, and exact/close mappings. Add narrow PLX validation and
governance fields.

**Why:** SKOS fits controlled vocabularies and mappings while remaining
understandable to administrators and interoperable with Microsoft managed
metadata.

**Deferred:** OWL reasoning beyond concrete, approved use cases.

## D-07 — Put the ontology workbench in Portal

**Decision:** Portal provides proposals, diffs, impact previews, reviews,
publication, deprecation, and rollback for administrators and department
stewards.

**Why:** Ontology evolution is a business workflow requiring usable previews,
ownership, approvals, and audit—not direct RDF or database editing.

**Guard:** Publication creates an immutable version and triggers validated
rebuilds; high-impact authors cannot self-approve.

## D-08 — Reuse source-native Microsoft controls

**Decision:** Use SharePoint content types/managed metadata and Purview
retention, records, hold, disposition, audit, and residency capabilities where
the live tenant/license evidence supports them.

**Why:** Reimplementing these controls in the ledger would weaken authority and
increase compliance risk.

**Guard:** No capability is claimed from documentation alone; tenant, SKU,
configuration, role, geography, and retention evidence is required.

## D-09 — Treat Graph notifications as acceleration

**Decision:** Change notifications may reduce latency, but opaque delta cursors
plus periodic reconciliation remain correctness paths.

**Why:** Subscriptions expire, notifications can be missed, and tracked
properties vary by resource. This also matches current PLX sync doctrine.

## D-10 — Enforce authorization before retrieval and generation

**Decision:** Apply tenant, actor, source ACL, classification, purpose,
retention, and policy predicates before candidate retrieval/ranking/cache use.

**Why:** Filtering a generated answer is too late; restricted information can
leak through text, citations, counts, embeddings, rankings, or shared caches.

**Guard:** Uncertain or stale authorization fails closed.

## D-11 — Keep duplicate and stale handling non-destructive

**Decision:** Detectors create candidates and evidence. Accountable owners
decide link, supersede, migrate, retain, or reject.

**Why:** Copies, revisions, templates, translations, and genuinely duplicated
records can look similar. Automatic deletion would violate source authority and
records controls.

## D-12 — Keep Second-Brain derived and optional

**Decision:** PLX Second-Brain consumes ledger/canonical events and may provide
confidence-weighted memory and retrieval context, but canonical reads and basic
discovery work without it.

**Why:** Memory relationships are valuable but cannot become sole evidence or a
single point of failure.

**Guard:** The complete Second-Brain repository/runtime contract must be
verified before integration.

## D-13 — Reuse the Portal document stack after pinned verification

**Decision:** Do not create a parallel Portal document/DocuSign subsystem. Reuse
Ricardo's existing stack if the pinned implementation confirms the recorded
claim.

**Why:** Reuse before create and one source-authoring path.

**Current evidence:** The PLX_MC design handoff references a Portal DocuSign
integration, but this Cloud Agent could not read the private Portal repository.
The reuse decision is preserved; implementation readiness remains blocked.

## D-14 — Make Part 11 applicability a Quality/Legal gate

**Decision:** The architecture provides traceability for validation, record
copies/protection/retrieval, access, audit trails, operational/authority checks,
training, signatures, and signature-record linkage. Quality and Legal decide
where those controls apply.

**Why:** Part 11 applicability depends on intended use, electronic records,
predicate rules, and signature use. Architecture cannot certify compliance.

**Guard:** No regulated implementation proceeds without an approved intended-use
and validated-system boundary.

## D-15 — Preserve human accountability with bounded autonomy

**Decision:** Every milestone, task, risk, gate, ontology domain, and control has
a human owner. Agents and teams may execute evidence-producing work inside
registered, revocable capabilities.

**Human-only:** regulatory applicability, risk acceptance, retention/residency
policy, ontology publication where required, signature, validation deviation
approval, and live cutover.

## D-16 — Use Mission Control as the zero-drift execution plane

**Decision:** Create `PRJ-UNIFIED-KNOWLEDGE`, re-home `TASK-477` without
duplication, and use seven delivery buckets. Import only from validated
`program.json`.

**Why:** Machine-readable dependencies, requirements, risks, gates, owners, and
done-when evidence prevent prose from diverging from execution.

**Guard:** The validator's MC plan is dry-run only; record creation/re-homing is
a separately approved mutation.

## D-17 — Pilot the existing architecture collection first

**Decision:** Use `docs/architecture/knowledge-entry.json` and its Git authority,
provenance, generated-consumer disclosure, authoring return path, and degraded
behavior as the first collection.

**Why:** It exercises the architecture without placing customer, vendor, or
regulated records at risk.

## D-18 — Keep program files canonical in Git

**Decision:** Markdown sources, `program.json`, schema, validator, tests, PDF,
and DOCX are committed together. The external ZIP is produced only after the
source/export commits are pushed.

**Why:** Review, provenance, parity, and recovery require one canonical package.
The PDF/DOCX are generated consumers; Markdown/JSON remain editable authority.

## Unresolved decisions

These are deliberately not guessed:

- live Microsoft tenant, license, Purview, Term Store, region, and Graph scope;
- Portal/Second-Brain repositories and exact contracts;
- ledger/audit-store hosting and immutability;
- regulated-record and predicate-rule inventory;
- privacy classes, retention schedule, legal holds, and approved regions;
- model/embedding provider and whether source text may leave each region;
- quality, freshness, duplicate, contradiction, and leakage thresholds;
- operational SLOs, recovery objectives, and control-review cadence.
