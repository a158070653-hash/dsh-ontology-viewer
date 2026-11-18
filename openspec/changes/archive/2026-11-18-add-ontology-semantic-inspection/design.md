# Design

## Context

See proposal.md for motivation and user-visible scope. The plugin stores accepted parsed statements as bounded per-source L0 snapshots, composes them into a provenance-bearing merged statement set and a budgeted L1 graph, then derives filtered/explored/drawn projections. Parser truncation currently changes a long literal's stored `o` to a prefix and marks `literalTruncated`; the workspace merge key uses that `o` with `dt`/`lang`/graph and can therefore conflate distinct original RDF terms. Formal `ontology-workspace` already prohibits this. Parser source locations are null; statement identity/source/revision/graph provenance is available. The graph model removes `rdf:first`/`rdf:rest` plumbing and applies display budgets, so it is not a complete semantic source.

Runtime inspection confirms the existing keyed `sidebar.right.tab.document` slot, locale Service, theme aliases, and the currently registered `dsh-ontology-viewer/graph` occupant. No additional host API is needed. Existing `ontology-job` / Worker architecture can cache accepted parse snapshots and compose without reparsing unchanged files.

## Goals / Non-Goals

**Goals:**
- Keep RDF semantic identity, bounded identity evidence, and display projection distinct, with conservative behavior when equality is unknown.
- Analyze the accepted L0 statements of an explicit source/workset scope and carry source/statement/graph evidence plus all relevant completeness flags into explanations, metrics, diagnostics, and reports.
- Keep each traversal, result list, output, and retained literal representation bounded and deterministic.
- Make the identity correction a hard implementation gate before any OWL, overview, or quality-analysis consumer is implemented.

**Non-Goals:**
- Real source line/column positions, editable RDF, remote imports/context loads, SPARQL, reasoner, full OWL consistency validation, complete SHACL, or server/database services.
- Treating the rendered graph or its node/edge/literal budgets as a complete input to analysis.

## Decisions

### 1. Use a bounded semantic identity descriptor, not the display value

Each parsed literal needs three distinct concepts: (a) a bounded UI/display value, (b) a reliability-marked semantic identity descriptor that includes RDF term kind, lexical-value identity, datatype and language, and (c) its truncation/original-length metadata. Use the ordinary L0 lexical value for non-truncated literals; it is already covered by existing source/occurrence budgets and needs no duplicate identity copy. For a display-truncated literal, use exact lexical equality only while the separately benchmarked identity-memory budget can retain the comparison material. Initial caps are 65,536 UTF-16 code units per truncated literal and 262,144 retained UTF-16 bytes per parsed source. At composition, a 4 MiB workset-wide cap is preflighted across selected reliable truncated-literal descriptors; if it is exceeded, truncated-literal identity is treated as unknown for the entire selected workset so deduplication cannot depend on traversal order. This fits the existing 16-source workspace cap while bounding additional retained comparison text. The parser's per-source budget is currently capped at 256 KiB, and the aggregate selected-workset budget is 4 MiB; both are hard caps and independently enforced. The existing `maxLiteralLength` input cap remains unchanged. If a term or source exceeds its identity cap, mark identity unknown and preserve its occurrence without deduplication. A fixed-length digest may be retained as a diagnostic hint but MUST NOT alone authorize equality or deduplication, because collision resistance is not exact proof. Workspace equality is allowed only for compatible reliable descriptors. Unknown descriptors remain separate occurrences and are never deduplicated. Full raw values MUST NOT be retained without bound.

Alternatives: (a) keep full raw lexical values in L0, which enables exact JavaScript string comparison but multiplies memory use across up to 120k occurrences and cross-session snapshots; rejected as the default. (b) use the truncated prefix, which is cheap but already shown to merge unequal terms; prohibited by the confirmed requirement. (c) refuse all literal deduplication, which is conservative but loses valid duplicate aggregation even where equality is reliably available; keep it only as fallback for unknown identity.

Display budgets remain in force. Raw source-byte/workspace/occurrence limits, maximum parser literal length, and report budgets are not disabled. Where parser implementations cannot compute identity reliably within configured CPU/memory limits, the parser emits unknown identity rather than continuing unbounded work.

### 2. Preserve occurrences separately from semantic statement groups

The L0 workspace representation retains every accepted occurrence (source ID, revision, graph, stable source-local statement ID, literal identity state). A semantic statement group may reference one or more occurrences only after reliable identity comparison. Removal drops only occurrences belonging to that source; atomic reload replaces that source's occurrence set and rebuilds groups. If an unknown literal identity appears, its occurrence gets a distinct non-colliding workspace group key, not a key derived solely from the display prefix. Graph labels and literal details consume a bounded display projection while provenance links back to the occurrence set.

### 3. Treat completeness as structured data, not a banner string

An analysis snapshot carries the selected source IDs/revisions; source status (ready/partial/error/stale); parse and workspace admission truncation; scope counts (accepted occurrences versus merged reliable groups); per-literal `truncated` and `identityReliability`; and traceability (source and statement IDs, graph identity; location remains absent). Every analysis result references the snapshot revision and lists which uncertainty flags affect that result. “No finding” on incomplete data is not a clean bill of health: absence-based checks become unverifiable/partial. Definite diagnostics require sufficient complete evidence for the exact local rule.

### 4. Build a read-only L0 semantic index per workspace revision

Create bounded indexes over accepted L0 statements for subject/predicate/object lookups, RDF List cells, restriction nodes, type/declaration occurrences, and source provenance. The index is memoized by selected source IDs/revisions and invalidated on add/remove/reload/workset changes; it does not trigger parser reruns for unchanged sources. RDF Lists are traversed lazily with visited-cell, depth and total-step budgets; cycles/multiple first/rest/missing rest are recorded as structural states. Supported OWL expressions reference their source statement IDs and are not written back as RDF triples. An expression which depends on an incomplete list is represented as incomplete, not a shortened complete expression.

### 5. Separate semantic explanation, overview, diagnostics, and report contracts

- Semantic inspection returns asserted expression kind, bounded operands, localized explanation parameters, evidence, scope, and completeness/reliability state. It never materializes inferred statements.
- Overview metrics explicitly name their layer and basis. RDF fact counts come from selected accepted L0 occurrences; unique-term counts identify identity uncertainty; hierarchy summaries use explicit accepted hierarchy edges and report partial scope.
- Diagnostics use stable rule IDs, category (`parse`, `structural`, `suggestion`, `unverifiable`), severity, explanation key/parameters, evidence references, target entity IDs and completeness. Heuristic absence findings are suggestions/unverifiable when any relevant scope is partial.
- Markdown and JSON export serialize the same immutable bounded analysis snapshot. JSON has an explicit schema version; Markdown escapes untrusted text. Output caps report omitted counts and truncation.

### 6. Keep UI in existing document body and reuse current state/navigation

Add compact analysis/semantic entry points alongside current view and detail controls, keeping three views intact. A finding/metric can call the existing stable entity selection/navigation pathway; it must not reset source or graph filters silently. Diagnostic grouping/filter controls live in a secondary panel suitable for a narrow sidebar. New labels use the existing `dshOntology` ZH/EN dictionaries and existing `--dsw-alias-*` tokens. Use no new host Slot, Service, Client external, runtime dependency, server, or database. Do not directly edit generated `client.js`; add modules to the deterministic build order and generate it through the build.

### 7. Use the existing Worker with semantically identical fallback

Analysis should be a new Worker protocol operation over already cached L0 snapshots/analysis indexes, not a second file parser path. Worker and main-thread implementations share pure bounded analysis modules. If Worker is unavailable, use the existing stricter degraded budget and clearly mark reduced scope; results must agree for the same accepted input and effective limits. An unchanged-workset view switch reuses L0 and semantic indexes; source revisions invalidate only affected indexes. No new CSP/network dependency is introduced.

## Risks / Trade-offs

- [Identity digest collision or incomplete canonical material] → Never merge when reliability is unknown; include identity algorithm/version and reliability in snapshots; test against adversarial equal-prefix values and worker/main parity.
- [Retaining identity material increases memory] → Use bounded metadata per occurrence, enforce total workspace byte/occurrence caps, measure before/after with opt-in benchmarks, and degrade identity to unknown at the cap rather than retaining raw literals indefinitely.
- [Repeated or malformed RDF Lists cause expensive traversal] → Memoize by workspace revision; enforce per-list cell, total analysis-step, nesting and diagnostic caps; deterministic cycle detection.
- [Partial data appears complete] → Carry parser/source/workspace/identity completeness into every result and report; absence-based checks cannot become definite on incomplete scope.
- [Worker structured-clone cost erases compute benefit] → Benchmark end-to-end transfer/clone and reuse worker-cached L0; if analysis output exceeds budgets, return bounded pages/aggregates with omitted counts.
- [UI density in a narrow sidebar] → Keep entry points compact, group diagnostics in a secondary pane, apply bounded visible rows, and validate narrow/wide, light/dark, Chinese/English in the real DSH page during Apply.
- [Markdown injection or false claims] → Escape RDF text, produce JSON via structured serialization, distinguish initiated download from confirmed persistence, and use explicit categories/limitations.

## Migration Plan

No persisted user data format, external API, package version, or host profile migration is planned. During Apply, first land the literal identity and occurrence/provenance correction plus its regression tests. That phase is a hard gate: no OWL analysis, overview, or quality-diagnostic implementation may begin until those tests, cross-file merge checks, removal/reload checks, and statement-source consistency checks pass. Then add pure L0 analysis/index modules and Worker/fallback protocol; add UI, i18n, and bounded Markdown/JSON export; build `client.js` from source and run focused tests, `npm run check`, `npm run i18n`, and real DSH page verification appropriate to changed UI. If the identity gate fails, stop dependent work and report; rollback is reverting only the current unmerged change's source/build changes, not rewriting prior releases or archived artifacts. Archive and release are separate, user-directed workflows.

## Open Questions

None that change the chosen contract. The exact bounded literal-identity representation and collision policy must be selected and documented during the first gated implementation task before coding; the acceptance rule is fixed: unknown equality never permits deduplication.
