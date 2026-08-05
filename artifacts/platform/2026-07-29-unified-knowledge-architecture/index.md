# Unified PLX Document and Knowledge Architecture

Canonical recovery package for `TASK-477`.

Accountable human: `vince@petrasoap.com`.
Architecture pattern: **Knowledge Ledger with Disposable Projections**.

## Read in this order

1. `REPORT.md` — executive architecture and delivery decision.
2. `REQUIREMENTS.md` — acceptance, security, records, and compliance contract.
3. `RESEARCH.md` — recovered decision evidence, primary sources, alternatives,
   verified constraints, and residual unknowns.
4. `SPEC.md` — detailed ledger, connector, ontology, discovery, governance,
   Part 11 traceability, rollout, and rollback design.
5. `DECISIONS.md` — approved decisions and deliberately unresolved gates.
6. `program.json` — machine-readable milestones, dependencies, tasks, risks,
   gates, owners, and validation.
7. `program.schema.json` — dispatch contract.

`RECOVERY-MANIFEST.md` records the initial remotely verified recovery checkpoint.

## Generated consumers

- `unified-plx-document-knowledge-architecture.pdf`
- `unified-plx-document-knowledge-architecture.docx`

The Markdown and JSON files are canonical and editable through Git review. PDF
and DOCX are generated shareable consumers and must be regenerated when the
executive report changes.

## Validation

```bash
python scripts/check-unified-knowledge-program.py
python scripts/check-unified-knowledge-program.py --print-mc-plan
python -m pytest tests/test_check_unified_knowledge_program.py -q
./scripts/preflight.sh --mode pre-commit
./scripts/preflight.sh --mode pre-push
```

The Mission Control plan mode is a dry-run: it performs no network calls and
creates or changes no tasks.

## Authority notice

This package specifies a system of canonical sources plus a versioned knowledge
ledger. It does not make the PDF, DOCX, a search index, vector database, graph
index, LLM memory, or Second-Brain authoritative. Part 11 applicability and
validation remain subject to the explicit Quality/Legal Phase 0 gate.
