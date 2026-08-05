# Requirements — Unified PLX Document and Knowledge Architecture

Status: approved architecture requirements; implementation remains gated.
Accountable human: `vince@petrasoap.com`.
Machine-readable authority: `program.json`.

## Success criteria

The program succeeds when PLX can discover and explain authorized knowledge
across its operating systems without creating an ambiguous second source of
truth. Every result must identify where it came from, what revision was used,
how it was derived, who owns it, and where it must be edited. Search and memory
indexes must be disposable; the versioned ledger and canonical systems must be
able to rebuild them.

## Architectural requirements

| ID | Requirement | Priority | Primary proof |
|---|---|---:|---|
| REQ-01 | Every knowledge object declares one canonical system and an authoring return path. | Must | Authority matrix and sample-object trace |
| REQ-02 | The ledger preserves immutable assertion versions with valid time and transaction time. | Must | Correction and historical as-of tests |
| REQ-03 | Graph, vector, full-text, cache, and Second-Brain projections rebuild from versioned sources. | Must | Empty-index rebuild drill |
| REQ-04 | Assertions and chunks carry source identity, source revision, extractor version, and ingestion receipt. | Must | Provenance completeness query |
| REQ-05 | Portal administrators can propose, preview, review, publish, deprecate, and roll back ontology changes. | Must | Workbench approval and rollback scenarios |
| REQ-06 | Ontology versions preserve stable identifiers, labels, synonyms, mappings, owners, and effective dates. | Must | Version-diff and stable-ID tests |

## Discovery and quality requirements

| ID | Requirement | Priority | Primary proof |
|---|---|---:|---|
| REQ-07 | Authorized users can combine lexical and semantic discovery with source filters. | Must | Golden-query suite |
| REQ-08 | Answers expose citations, revision time, confidence, derivation, and contradiction state. | Must | Explainability and refusal tests |
| REQ-09 | Exact, near, and semantic duplicate candidates are flagged without destructive deduplication. | Must | Labeled duplicate benchmark |
| REQ-10 | Stale and contradictory content is flagged using source-aware rules and owner review. | Must | Staleness and contradiction scenarios |
| REQ-24 | Customer and vendor knowledge is isolated before retrieval and generation. | Must | Adversarial tenant-leakage suite |

## Security, privacy, and records requirements

| ID | Requirement | Priority | Primary proof |
|---|---|---:|---|
| REQ-11 | Connectors and retrieval enforce least privilege, deny by default, and preserve source ACL semantics. | Must | Revocation and cross-tenant tests |
| REQ-12 | Agent, MCP, tool, and skill actions use registered identities, versioned capabilities, and auditable invocation. | Must | Unregistered-agent denial and audit trace |
| REQ-13 | Classification, minimization, purpose limitation, residency, and subject-right handling are source aware. | Must | Approved data-flow and residency evidence |
| REQ-14 | Retention, disposition, legal hold, and records declaration remain governed by approved source policies. | Must | Purview mapping and hold/disposition tests |
| REQ-25 | Source deletion and permission changes produce tombstones and projection removal without erasing audit history. | Must | Deletion and ACL replay |

## Part 11 requirements

These controls are requirements only for records and uses that Quality and Legal
place inside the validated-system boundary. The specification does not assert
that every PLX document or knowledge workflow is regulated.

| ID | Requirement | Priority | Primary proof |
|---|---|---:|---|
| REQ-15 | Regulated records support accurate and complete copies, protection, retrieval, and approved retention. | Must | Record export and retrieval qualification |
| REQ-16 | Regulated actions create secure, computer-generated, time-stamped audit trails attributable to an authorized actor. | Must | Audit-trail qualification |
| REQ-17 | Electronic signatures are unique, verified, linked to their records, and display required signature meaning. | Must | DocuSign linkage and manifestation review |
| REQ-28 | Quality and Legal classify every regulated workflow as a closed or open system and approve the corresponding controls. | Must | Intended-use decision and open-system assessment |
| REQ-29 | When 21 CFR 11.100(c) applies, PLX retains evidence of the FDA electronic-signature certification process and scope. | Must | Applicability decision and certification evidence |
| REQ-30 | Non-biometric signatures enforce approved identification components, signing-session behavior, and genuine-owner controls. | Must | Signature protocol and unauthorized-use tests |

## Governance and operations requirements

| ID | Requirement | Priority | Primary proof |
|---|---|---:|---|
| REQ-18 | Every milestone, task, risk, and gate has a named human accountable owner. | Must | Program validator |
| REQ-19 | Teams and agents execute only within approved, revocable, evidence-producing autonomy bounds. | Must | Capability and human-approval scenarios |
| REQ-20 | Connectors are idempotent, cursor based, observable, replayable, and independently degradable. | Must | Replay and partial-outage tests |
| REQ-21 | Canonical content remains readable when the ledger, Second-Brain, or any projection is unavailable. | Must | Projection-outage drill |
| REQ-22 | Projection receipts identify ledger watermark, ontology version, model version, and build receipt. | Must | Receipt inspection |
| REQ-23 | Mission Control execution remains linked to delivery evidence and canonical project artifacts. | Must | Task-to-evidence trace |
| REQ-26 | Program state is schema validated with acyclic dependencies and complete requirement coverage before dispatch. | Must | Validator and MC import dry-run |
| REQ-27 | Ontology, discovery, and other new knowledge planes start only while Mission Control's mirror-is-boring gate is met. | Must | `mc_self_check` evidence and architecture parity gate |

## Non-functional quality bars

- **Freshness:** source-specific service levels are agreed during Phase 0.
  Stale authorization state fails closed; stale non-sensitive content is marked.
- **Explainability:** no generated answer is accepted without at least one
  authorized canonical citation or an explicit insufficient-evidence result.
- **Recoverability:** deleting every disposable projection is a supported,
  rehearsed operation.
- **Availability:** a projection outage cannot remove canonical deep links.
- **Security:** authorization is evaluated before ranking, synthesis, or cache
  reuse, not filtered from an already generated answer.
- **Auditability:** writes, policy decisions, ontology publication, connector
  receipts, and agent/tool invocations are attributable and reviewable.
- **Portability:** source identifiers and provenance use open, versioned
  contracts; no model vendor owns the only representation of knowledge.

## Phase 0 hard stops

Implementation cannot start until the five domain decisions are evidenced, and
new-plane milestones cannot start unless the recurring mirror gate is green:

1. Microsoft 365 estate, licenses, regions, administrators, and Graph permissions.
2. Accessible, pinned Portal and Second-Brain repositories and runtime contracts.
3. Quality/Legal Part 11 intended-use and validated-system boundary.
4. Approved identity, tenant isolation, privacy, and authorization model.
5. Approved Postgres ledger, audit-store, backup, encryption, and residency
   deployment.
6. Mission Control self-check reports live, fresh data with `boringGateMet`
   true, and architecture parity passes.

## Explicit non-goals

- Replacing SharePoint, Git, Portal gold tables, Mission Control, DocuSign, or
  source-specific records controls.
- A wiki that permits edits detached from the owning source.
- Treating a vector database, graph index, search index, LLM memory, or
  Second-Brain as canonical.
- Automatically deleting duplicate or stale documents.
- Claiming Part 11 compliance from architecture alone.
- Granting broad application permissions merely to simplify ingestion.
