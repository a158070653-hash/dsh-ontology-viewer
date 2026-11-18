# Proposal

## Why

The 1.1.0 viewer preserves RDF statements and source provenance but presents OWL restriction and list structures mostly as raw graph details, leaving users to interpret them manually. A bounded, explicitly non-inferential inspection layer can explain common OWL constructs, summarize the accepted workspace, and surface traceable modeling diagnostics without turning the plugin into a reasoner or closed-world validator.

## What Changes

- Add natural-language explanations for common OWL restrictions, boolean class expressions, property characteristics, domain/range, inverse, equivalence, and disjointness; retain RDF terms and source/statement evidence and avoid unimplemented inference.
- Add a knowledge overview over accepted L0 statements, with scope-qualified counts, namespace and relation distributions, hierarchy summaries, and navigation to graph entities.
- Add bounded structural and heuristic diagnostics for RDF Lists, references, duplicate/conflicting definitions, hierarchy cycles, unused entities, and labels; separate parse errors, definite structural findings, suggestions, and unverifiable cases.
- Add compact semantic/analysis entry points coordinated with node details, a filterable/grouped diagnostic list with graph navigation, and Markdown/JSON report export.
- As a mandatory first Apply gate, repair the existing truncated-literal identity collision: semantic statement identity must not use the display-truncated lexical prefix. Distinguish reliable RDF identity from bounded retained/display values, preserve provenance through merge/remove/reload, and report uncertainty where equality cannot be established.
- Base analysis on accepted L0 snapshots, not graph-model L1 projections; disclose parse/input/literal truncation and evidence reliability. Do not add a reasoner, complete OWL consistency checker, SHACL engine, server, database, runtime dependency, new parser format, or direct `client.js` edits.

## Capabilities

### New Capabilities
- `owl-semantic-inspection`: bounded OWL expression reconstruction, semantic explanations, and evidence-qualified interpretation.
- `ontology-overview`: scope-explicit workspace summaries and navigation from metrics to graph entities.
- `ontology-quality-diagnostics`: deterministic structural checks and heuristic suggestions with stable rules, evidence, uncertainty, filters, and navigation.
- `ontology-analysis-reports`: user-triggered Markdown/JSON reports that distinguish confirmed findings, suggestions, and unverifiable analysis.

### Modified Capabilities
- `rdf-parsing`: preserve literal identity/evidence reliability separately from any bounded display representation and expose truncation state.
- `ontology-workspace`: make statement deduplication safe for truncated literals and preserve occurrences/provenance through cross-file merge, removal, and reload.

## Impact

Expected source areas include `src/rdf-parse.js`, `ontology-workspace.js`, `ontology-identity.js`, `graph-model.js`, `ontology-job.js`, `worker-entry.js`, and focused analysis/UI/report modules composed through `build/build.mjs`; matching `tests/` fixtures and suites; `src/main.js` dictionaries and `scripts/check-i18n.mjs` if dynamic keys are introduced; generated `client.js` only through the build. Existing document preview slot, React Client module, worker lifecycle, theme tokens, and browser-local export mechanisms are sufficient; no new DSH extension point is planned. The Apply phase must first repair and validate the truncated-literal identity contract before implementing dependent semantic analysis, overview, or diagnostics. No version bump, release, archive, push, profile reinstall, or server-side component is in scope.
