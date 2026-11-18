# Spec Delta

## Purpose

Gives users a compact, navigable summary of the ontology statements currently accepted into a selected workspace. Every metric states its data scope so that parser, workspace, graph-model, filter, and drawing budgets cannot be mistaken for one another.

## ADDED Requirements

### Requirement: Scope-qualified knowledge counts

The overview SHALL report counts for classes, properties, individuals, namespaces, accepted relationships, and supported restriction/expression structures, and each count SHALL identify the exact source/workset and data layer from which it was computed.

#### Scenario: Accepted versus displayed counts
- **WHEN** source, graph-model, or view budgets make accepted input differ from the visible projection
- **THEN** the overview labels accepted L0, retained L1, filtered, and drawn counts separately and does not substitute a displayed count for an accepted count

#### Scenario: Partial parse scope
- **WHEN** an accepted source has parser errors or triple truncation
- **THEN** counts remain explicitly limited to accepted statements and identify the source as partial

### Requirement: Structural overview summaries

The overview SHALL provide namespace and relation-type distributions, explicit class-hierarchy summaries, roots, isolated classes, and high-connection entities using deterministic ordering and bounded result counts.

#### Scenario: Main namespaces and predicates
- **WHEN** accepted L0 contains several namespaces and predicates
- **THEN** distributions are ordered deterministically and show their count basis and omitted-item count when capped

#### Scenario: Roots, isolated classes, and connected entities
- **WHEN** explicit class declarations or `rdfs:subClassOf` statements exist
- **THEN** roots and isolated classes derive only from retained explicit hierarchy statements, cycles are disclosed, and high-degree entities have stable IDs for navigation

### Requirement: Navigate from overview to entities

Overview entries associated with graph entities SHALL provide a selection action that targets the stable entity identity in the existing graph workspace; non-entity aggregates SHALL not fabricate a graph node.

#### Scenario: Locate a class metric
- **WHEN** the user activates a class or relation entry that has a graph entity
- **THEN** the existing workspace selects and locates that entity without changing RDF statements or silently clearing source/filter state

#### Scenario: Aggregate without entity
- **WHEN** the user activates a namespace/count aggregate without a unique graph entity
- **THEN** the UI presents its members or explains that no single entity can be located, without creating a synthetic RDF node

### Requirement: Overview completeness and evidence status

The overview SHALL disclose source count, accepted occurrence count, stale/error/partial sources, parser and identity truncation, and whether each statistic is complete, partial, or unavailable; unknown identities MUST NOT be silently counted as confirmed unique terms.

#### Scenario: Identity uncertainty in statistics
- **WHEN** long literal or entity identity is unknown under a configured budget
- **THEN** affected counts are marked uncertain or bounded rather than presented as exact unique-entity totals
