# Spec Delta

## Purpose

Lets users export a portable, local analysis report whose claims remain bounded by the selected workspace and traceable to accepted RDF statements. Reports clearly separate confirmed structural findings, review suggestions, and analysis that could not be verified.

## ADDED Requirements

### Requirement: Export Markdown and JSON analysis reports

The plugin SHALL provide user-triggered Markdown and JSON report downloads generated locally from the same bounded analysis snapshot; reports MUST NOT require a server or external request.

#### Scenario: Markdown report
- **WHEN** the user exports Markdown
- **THEN** the report contains the selected scope, overview, supported semantic explanations, grouped diagnostics, evidence references, limitations, and completeness state

#### Scenario: JSON report
- **WHEN** the user exports JSON
- **THEN** the report uses a documented stable schema with versioned top-level fields for scope, metrics, explanations, diagnostics, evidence, and truncation/completeness metadata

### Requirement: Report certainty and traceability

Every report SHALL distinguish confirmed structural findings, heuristic suggestions, parser errors, and unverifiable checks, and SHALL preserve source IDs/revisions, statement IDs, graph identity, RDF terms, literal datatype/language, identity reliability, and truncation status where available. Reports MUST NOT imply full input, exact literal equality, or inferred OWL facts when evidence is partial.

#### Scenario: Partial or truncated input
- **WHEN** the report snapshot contains parser truncation, literal truncation, rejected/errored sources, stale sources, or unknown statement identity
- **THEN** the report marks affected sections incomplete or “cannot reliably determine,” includes reasons, and does not render a definitive conclusion from missing data

#### Scenario: Reproducible statement references
- **WHEN** a diagnostic or explanation cites a statement
- **THEN** its source and stable statement identifier resolve to an accepted occurrence in the report snapshot, without fabricated line/column fields

### Requirement: Safe and bounded report serialization

Report generation SHALL apply explicit output-size and diagnostic/evidence limits, escape untrusted RDF content for Markdown/JSON contexts, and disclose omissions; download behavior MUST be described only as initiated when the browser cannot confirm persistence.

#### Scenario: Untrusted RDF strings
- **WHEN** RDF labels or literals contain Markdown/HTML/script-like text
- **THEN** exported content remains inert text and JSON remains valid, correctly escaped JSON

#### Scenario: Report exceeds output budget
- **WHEN** the report reaches its configured size or item budget
- **THEN** it stops or summarizes deterministically, marks omitted content and scope, and does not allocate without bound
