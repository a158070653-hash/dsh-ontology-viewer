# OWL Semantic Inspection Specification

## Purpose

Provides bounded, evidence-linked natural-language explanations of common OWL/RDFS structures found in accepted RDF statements. It helps readers interpret explicit modeling constructs without claiming inference, consistency checking, or facts beyond the loaded data.

## Requirements

### Requirement: Explain common OWL restrictions

The inspection SHALL recognize explicit `owl:Restriction` structures using `owl:onProperty`, some/all/has value and supported qualified or unqualified cardinality predicates, and produce a plain-language explanation that preserves the exact asserted form.

#### Scenario: someValuesFrom explanation
- **WHEN** a complete restriction has one `owl:onProperty` and one `owl:someValuesFrom`
- **THEN** the explanation states that the class has at least one property value in the named class/datatype, without asserting that a particular instance has a value

#### Scenario: allValuesFrom explanation
- **WHEN** a complete restriction has one `owl:onProperty` and one `owl:allValuesFrom`
- **THEN** the explanation describes the explicit universal restriction and does not infer that any value exists

#### Scenario: hasValue explanation
- **WHEN** a complete restriction has one `owl:onProperty` and one `owl:hasValue`
- **THEN** the explanation identifies the required value using its RDF term kind, datatype/language when literal, and original statement evidence

#### Scenario: cardinality explanation
- **WHEN** a restriction has a supported min/max/exact cardinality predicate and an untruncated, reliably identified non-negative integer value
- **THEN** the explanation names the predicate's cardinality meaning and property without treating it as a closed-world count of loaded triples

#### Scenario: unsupported or conflicting restriction structure
- **WHEN** a restriction lacks required operands, repeats a functional operand inconsistently, or uses an unsupported cardinality form
- **THEN** it is not presented as a complete semantic explanation and is marked incomplete or needing review with the conflicting/missing evidence

### Requirement: Explain boolean and relational OWL constructs

The inspection SHALL reconstruct supported `intersectionOf`, `unionOf`, `oneOf`, `equivalentClass`, and `disjointWith` structures from explicit RDF statements and ordered RDF Lists where applicable, retaining operand identity and asserted relation direction/scope.

#### Scenario: intersection and union list
- **WHEN** an expression points to a complete, acyclic, budget-bounded RDF List
- **THEN** the explanation lists operands in RDF list order and distinguishes intersection from union

#### Scenario: enumeration list
- **WHEN** `owl:oneOf` points to a complete valid list
- **THEN** the explanation identifies the explicitly enumerated RDF terms and preserves literal metadata

#### Scenario: incomplete or cyclic RDF List
- **WHEN** a supported expression points to a malformed, cyclic, truncated, or over-budget list
- **THEN** the explanation is marked incomplete and does not present a partial operand set as complete

#### Scenario: equivalent and disjoint class assertions
- **WHEN** explicit `owl:equivalentClass` or `owl:disjointWith` triples are present
- **THEN** the UI describes only the asserted relation and does not materialize inferred class relationships

### Requirement: Explain property vocabulary without inference

The inspection SHALL explain explicit `rdfs:domain`, `rdfs:range`, `owl:inverseOf`, and supported OWL property characteristics as declarations, preserving the asserted predicate, term, direction, and evidence.

#### Scenario: domain and range
- **WHEN** a property has explicit domain or range statements
- **THEN** the explanation identifies each declared domain/range and describes their RDF/OWL semantics without asserting observed instance data

#### Scenario: inverse and characteristics
- **WHEN** inverse or supported functional, inverse-functional, transitive, symmetric, asymmetric, reflexive, or irreflexive characteristics are explicitly typed
- **THEN** the explanation names only the explicit characteristic and does not synthesize inverse edges or entailments

### Requirement: Preserve semantic evidence and confidence

Each explanation SHALL identify the source/workspace scope, stable statement IDs and source IDs for its evidence, retain original RDF terms, and report input completeness, parser truncation, relevant literal truncation, and identity reliability. A semantic conclusion that depends on unknown identity or missing/truncated evidence MUST be “cannot reliably determine” or “analysis incomplete,” not deterministic.

#### Scenario: Trace explanation to source statements
- **WHEN** an explanation is selected
- **THEN** its original predicate/object terms and all contributing accepted source and statement identifiers are available

#### Scenario: Truncated literal affects interpretation
- **WHEN** an operand or cardinality literal used by an explanation is truncated or has unreliable identity
- **THEN** the explanation is marked incomplete and cannot assert a definite value or equality

#### Scenario: Partial source scope
- **WHEN** any selected source is parse-truncated, rejected, errored, stale, or excluded from the active workset
- **THEN** explanation scope states the relevant limitation and does not imply completeness beyond accepted input

### Requirement: Do not perform unimplemented inference

The inspection SHALL explain asserted syntax only and MUST NOT advertise or perform OWL reasoning, full consistency checking, or closed-world validation. Natural-language text MUST NOT turn open-world axioms into claims that loaded instance data is complete.

#### Scenario: Open-world existential restriction
- **WHEN** a class contains `someValuesFrom`
- **THEN** the text explains the class axiom and does not report instances lacking a matching loaded edge as violations

#### Scenario: No reasoner result
- **WHEN** an expression could imply additional facts under OWL semantics
- **THEN** no inferred triple, inferred type, or consistency verdict is shown
