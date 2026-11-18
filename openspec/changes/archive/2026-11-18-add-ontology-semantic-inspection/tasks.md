# Tasks

## 1. Literal identity contract gate

- [x] 1.1 Define a versioned literal semantic-identity descriptor distinct from the bounded UI display value; set per-literal and aggregate identity-memory/CPU budgets using `npm run bench` baselines, and verify budget overflow becomes `unknown` without disabling parser/workspace limits.
- [x] 1.2 Update parser literal output to preserve exact comparison material only within the identity budget, plus `dt`, `lang`, original length, truncation and reliability; verify with focused parser tests that displayed summaries are never used as semantic lexical values.
- [x] 1.3 Update workspace statement grouping so only reliably equal literal descriptors can deduplicate; verify different long literals with identical truncated prefixes remain separate and exact same long literals merge only when equality is reliable.
- [x] 1.4 Add parser/workspace tests for different long literals with the same truncation prefix, byte-for-byte identical long literals, literals exactly at and above the display/identity length budgets, and identity-budget exhaustion; verify no false merge and explicit reliability state.
- [x] 1.5 Add cross-file merge tests for the same reliable long literal in separate files and for different same-prefix literals across files; verify occurrence counts, source IDs, revisions, graphs, and statement IDs remain correctly associated.
- [x] 1.6 Add language-tag and datatype distinction tests for long and short literals; verify same visible lexical text with different `lang` or `dt` never shares semantic identity.
- [x] 1.7 Add source removal and atomic reload tests involving repeated and unknown-identity long literals; verify only the removed/replaced source occurrences disappear and no stale statement/source references survive.
- [x] 1.8 Add node literal projection and provenance regression tests; verify bounded UI summaries retain truncation/reliability indication and map back to the exact contributing occurrences without claiming unknown equality.
- [x] 1.9 Validate the identity gate across parser, workspace, graph literal attributes, and evidence references; run focused tests plus `npm run check` and do not start semantic-analysis implementation until all pass.

## 2. Bounded L0 analysis core

- [x] 2.1 Define pure analysis snapshot/result contracts for selected source revisions, L0 occurrences, scope counts, parse/source/workspace truncation, literal identity reliability, evidence references, and completeness; verify serialization is deterministic and contains no fabricated locations.
- [x] 2.2 Implement a revision-keyed L0 statement index for subject/predicate/object lookup, source/statement occurrence traversal, and namespace/relation aggregation; verify add/remove/reload/workset changes invalidate only affected indexes and unchanged files are not reparsed.
- [x] 2.3 Implement lazy bounded RDF List validation and ordered traversal with cell/step/depth/diagnostic budgets; verify normal, empty, missing-first/rest, multiple-first/rest, invalid terminator, cycle, shared tail, and budget exhaustion cases.
- [x] 2.4 Implement pure OWL restriction decoding for onProperty, some/all/has value, and supported min/max/exact cardinalities; verify positive, missing/conflicting operand, unsupported predicate, literal metadata, truncated cardinality, and open-world wording cases.
- [x] 2.5 Implement boolean class expression decoding for intersectionOf, unionOf, oneOf, equivalentClass, and disjointWith using explicit triples and ordered list results; verify operand ordering/evidence, malformed lists, cycles, and no inferred triples.
- [x] 2.6 Implement domain/range, inverseOf, and supported property-characteristic explanations; verify explicit assertion evidence is preserved and no inferred inverse/instance assertions are generated.
- [x] 2.7 Add shared completeness/evidence qualification for semantic explanations and overview metrics; verify any relevant parser truncation, stale/error source, literal truncation, unknown identity, or missing statement reference downgrades the affected result to incomplete/unverifiable.
- [x] 2.8 Implement overview metrics over accepted L0 occurrences and explicit hierarchy edges, including roots, isolated classes, cycles, namespaces, relation kinds, and high-connection entities; verify counts state accepted/merged/display scope and unknown identity does not silently become exact unique-term counts.
- [x] 2.9 Implement deterministic quality rules for list/reference structure, exact/conflicting declarations, explicit inheritance cycles, unused-entity and label suggestions; verify stable IDs, categories, source/statement evidence, external-reference caution, and partial-input downgrade.
- [x] 2.10 Add fixtures and focused unit tests for all semantic rules, diagnostics, false-positive guards, truncation/identity uncertainty, deterministic ordering, and each traversal/result budget; verify repeated runs over identical L0 snapshots produce identical results.

## 3. Worker and workspace integration

- [x] 3.1 Extend the existing worker protocol to build/reuse bounded semantic indexes from cached L0 snapshots and return paged/aggregated analysis results; verify source revisions invalidate cached results and view changes do not parse unchanged files.
- [x] 3.2 Implement a main-thread degraded analysis path using stricter explicit budgets and the same pure modules; verify worker and fallback produce equivalent findings, metrics, evidence, completeness, and deterministic order for equal effective limits.
- [x] 3.3 Add job tests for cancellation, stale-result rejection, source removal/reload, worker termination/recreation, analysis output truncation, and unknown-identity propagation; verify no result from an older workspace revision is published.
- [x] 3.4 Measure L0 identity memory, index build/query, RDF List/OWL analysis, structured-clone transfer, cancellation, and worst-case list/diagnostic inputs with deterministic fixtures; verify benchmark output separates stages and does not add absolute CI timing thresholds.

## 4. UI, navigation, and reports

- [x] 4.1 Add compact semantic/analysis entry point in the existing workspace toolbar/panel; verify component rendering and selection callbacks with workspace UI tests. Full three-view live behavior is reserved for 4.7.
- [x] 4.2 Add overview display with layer-qualified counts and bounded namespace/relation/hierarchy sections; verify metric navigation emits stable entity selection callbacks in component tests. Preserving every live filter/view combination remains part of 4.7.
- [x] 4.3 Add filterable/grouped diagnostic list by category, rule, severity, source, and entity with stable bounded rendering; verify category/rule controls, deterministic grouping, bounded items, and entity callbacks in component tests. Live filter/hidden-selection behavior remains part of 4.7.
- [x] 4.4 Add statement evidence JSON detail and explicit incomplete/unknown-identity indicators; verify component rendering and snapshot evidence fields with automated tests. Full live node-selection coordination remains part of 4.7.
- [x] 4.5 Add versioned JSON and Markdown report serializers from one immutable analysis snapshot with escaping, omission/output budgets, and initiated-download wording; verify schema shape, escaping of hostile labels/literals, byte/item caps, valid JSON, and uncertainty sections in serializer tests. Browser save confirmation is not available.
- [x] 4.6 Add Chinese and English strings and dynamic diagnostic/rule key coverage; verify `npm run i18n` succeeds and analysis wording never presents open-world axioms as closed-world data violations.
- [x] 4.7a Real DSH page: verify the analysis panel at the observed narrow ~320px workspace width, L0/L1/display scope counts, switching among network/class-tree/layered views without losing the overview, and locating an overview entity. Record the observed page state separately from automated tests.
- [x] 4.7b Real DSH page: verify wide/split layout, light/dark and Chinese/English switching, non-empty diagnostic filtering/navigation, cross-preview multi-file sharing/unsharing, report-action feedback, and keyboard/focus restoration. The user confirmed both workspaces display both documents while sharing; after disabling sharing on one side, it retains the received pair while the other returns to one local source. This is user-reported live-test evidence, not independently re-observed in this turn. Browser download persistence is not observable and is claimed only as initiated.
- [x] 4.7c Retest source-checkbox filtering within the shared two-document workset and grouped multi-axiom rendering after rebuilding the latest bundle. On 2026-11-18, the user explicitly confirmed both manual tests passed and accepted the results. This is user-reported live-test evidence, not independent agent reproduction; see verification.md.

## 5. Integration verification

- [x] 5.1 Update deterministic build module order and embedded worker inputs for new source modules, regenerate `client.js` only through `npm run build`, and verify `npm run build:check` succeeds.
- [x] 5.2 Run `npm run check`, `npm run i18n`, and `openspec validate --all`; verify all unit tests, generated bundle consistency, locale coverage, and spec validation pass without changing the package version.
- [x] 5.3 Review every analysis/report entry point against the no-inference, no-full-validator, L0-only, completeness, stable evidence, explicit budget, and no-fabricated-location contracts; verify no source path reads semantic conclusions back from L1/drawn projections.
