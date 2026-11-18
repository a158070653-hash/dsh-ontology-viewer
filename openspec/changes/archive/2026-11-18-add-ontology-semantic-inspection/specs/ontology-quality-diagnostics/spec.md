# Spec Delta

## Purpose

Provides a bounded, extensible set of explainable checks over accepted ontology statements. Findings distinguish parser errors, definite RDF structure defects, heuristic modeling suggestions, and conditions that cannot be verified from the selected input.

## ADDED Requirements

### Requirement: Stable diagnostic contract

Each analysis diagnostic SHALL include a stable rule ID, category, severity, localized explanation key, evidence statement IDs, source IDs/revisions, affected entity IDs when resolvable, confidence/completeness status, and whether it is navigable. Evidence MUST refer only to accepted data and MUST NOT invent source line/column positions.

#### Scenario: Traceable finding
- **WHEN** a diagnostic is emitted for an accepted statement structure
- **THEN** users can inspect its rule, category, explanation, source and statement evidence, and locate a real affected graph entity when one exists

#### Scenario: No fabricated position
- **WHEN** a finding is exported or displayed
- **THEN** absent location remains absent and the UI does not invent a line or column from statement order

### Requirement: Separate errors, structural findings, suggestions, and unknowns

Diagnostics SHALL distinguish parse errors, definite violations of checks explicitly implemented by this tool, heuristic suggestions requiring human review, and unverifiable/incomplete analysis. The tool MUST NOT claim complete OWL consistency or complete SHACL validation.

#### Scenario: Heuristic is not an error
- **WHEN** an entity appears unused or has a suspicious label pattern
- **THEN** the result is a suggestion requiring review, not a confirmed error

#### Scenario: External or undefined reference
- **WHEN** a resource is referenced but has no local explicit definition
- **THEN** it is not classified as erroneous solely for that reason; it may be reported as external or unverifiable

### Requirement: Bounded RDF List and reference checks

The analyzer SHALL check bounded RDF List shape (missing/multiple first/rest, invalid terminator, cycles, unreachable/ambiguous links), dangling local structure references, and repeated/conflicting definitions using stable deterministic checks and explicit traversal budgets.

#### Scenario: Malformed list
- **WHEN** an OWL expression's list has a definite structural defect within the inspected accepted statements
- **THEN** a structural diagnostic identifies the list cells and source statements that establish the defect

#### Scenario: Cyclic or over-budget list
- **WHEN** traversal finds a cycle or reaches its budget
- **THEN** the finding identifies the cycle or reports analysis incomplete; the unvisited remainder is not treated as valid or invalid

#### Scenario: Unresolved external reference
- **WHEN** a reference target is not explicitly defined in accepted local data
- **THEN** the analyzer does not call it a dangling error unless a bounded, local structural rule proves invalidity

### Requirement: Human-review modeling diagnostics

The analyzer SHALL identify explicit subclass cycles, possibly unused entities, duplicate/conflicting declarations, and label concerns as separate reviewable diagnostics with evidence and deterministic rule IDs.

#### Scenario: Inheritance cycle
- **WHEN** accepted explicit `rdfs:subClassOf` edges form a self-cycle or strongly connected component
- **THEN** each affected class is associated with a human-review diagnostic and the explicit cycle edges are cited

#### Scenario: Duplicate or conflicting definitions
- **WHEN** repeated definitions are detected among accepted statements
- **THEN** exact duplicates are distinguished from incompatible declarations/literals and identity uncertainty prevents a definite conflict verdict

#### Scenario: Label concern
- **WHEN** an explicit label is empty, duplicated inconsistently, or otherwise matches a documented heuristic
- **THEN** the analyzer emits a suggestion with the exact label statement evidence, not an inferred correction

### Requirement: Incomplete evidence blocks definite conclusions

Every check SHALL account for selected input completeness, parser truncation/errors, literal truncation, identity reliability, source staleness, and statement traceability. If a relevant check depends on missing, truncated, over-budget, or unreliable evidence, it MUST return “analysis incomplete” or “cannot reliably determine,” not a definite diagnostic conclusion.

#### Scenario: Truncated identity affects duplicate check
- **WHEN** literal statement identity cannot be reliably compared because of bounded truncation
- **THEN** duplicate/conflict diagnostics for those statements are unknown/incomplete and neither merge nor violation is asserted

#### Scenario: Partial input affects absence-based heuristic
- **WHEN** an entity appears unused or a list/reference seems absent in an incomplete source/workset
- **THEN** the analyzer does not issue a definite absence-based error and labels the result partial or unverifiable

### Requirement: Filter, group, navigate, and budget findings

The diagnostic list SHALL support deterministic filtering and grouping by category, rule, severity, source, and entity; navigating a finding SHALL select a valid existing entity while preserving the user's graph filters and view state. Diagnostic count, recursion, list traversal, and rendered samples SHALL have explicit bounds and disclose omissions.

#### Scenario: Navigate without clearing filters
- **WHEN** the user navigates from a finding to an entity hidden by current filters
- **THEN** the UI preserves filters and explains the hidden selection instead of silently resetting state

#### Scenario: Diagnostic cap
- **WHEN** diagnostics exceed the configured analysis/render budget
- **THEN** the UI reports total, shown, omitted, and truncation reason, and stable ordering makes repeated runs comparable
