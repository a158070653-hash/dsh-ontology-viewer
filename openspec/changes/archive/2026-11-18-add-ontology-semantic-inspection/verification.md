# Verification record

## Evidence boundaries

This record separates executed checks from unverified behavior. OpenSpec format validation is not an implementation or UI verdict. At implementation acceptance, no archive, release, version bump, profile reinstall, or push had been performed. On 2026-11-18 the user explicitly authorized main-spec synchronization, archive, Git commit, and push; the archival follow-up is recorded below.

## Real DSH page observations (2026-11-16)

Existing URL: `http://127.0.0.1:53588/`, viewport 1280 × 800. All observations used the installed document preview, not a mock renderer.

- `examples/pizza.ttl`: accepted L0 73 occurrences, one source; L1 retained/current displayed 25 nodes. Network → class-tree → layered → network switching kept the analysis overview. A roughly 287–320px pane was also observed in the host split layout; controls wrap and the analysis region scrolls.
- Keyboard: open analysis from its toolbar button, press Escape. The panel closes and the visible focus outline returns to the analysis button; the active document and graph remain.
- Locale/theme: account menu → Settings → General exposes the language selector and Light/Dark controls. Switched from dark/Chinese to light/English; analysis heading, scope counts, metric labels, navigation and source controls changed language and palette. Restored dark/Chinese afterward. Earlier claims that these controls were unavailable were incorrect: they were not in the top-level More menu.
- Locale switching exposed duplicate overview-row React keys: stale English rows remained next to Chinese rows. The implementation now assigns each metric/entity pair a unique key. A fresh page load of the rebuilt bundle shows no stale duplicate rows; an additional live language-toggle retest of that rebuilt bundle is still pending.
- `tests/fixtures/semantic-inspection.ttl`: accepted 15 occurrences, 9 retained/displayed nodes. The analysis panel shows `rdf-list-missing-link` as structural and `subclass-cycle` as a review suggestion. Severity `warning` reduces 2 findings to 1. Locating A opens A's details while preserving `warning` and the 1/2 result count. Statement evidence can be expanded.
- Wide observation: host fullscreen yielded two approximately 640px panes. Both graph and analysis panels remained rendered. Fullscreen is temporary test state, not a new plugin mode.
- Report buttons previously updated only the separate graph-export menu message. The analysis panel now receives the same initiated-download/error status. After rebuilding and refreshing the existing page, clicking JSON in the semantic fixture displays the Chinese initiated-download wording inside the analysis panel. Browser persistence is not claimed. The screenshot attachment SHA-256 is a738c8f1bd44a17378cf6341edd3b2913fee52746be80840db8d47622e0653e5.

## User-reported manual acceptance

The user confirmed the cross-preview sharing test passed: with both preview workspaces sharing, each displayed both documents; after sharing was disabled in one preview, that preview retained both documents while the other returned to its single local source. This resolves the earlier apparent sharing conflict; no sharing-contract change was made.

On 2026-11-18, after the agent described the two remaining manual tests, the user explicitly confirmed both passed and accepted them:

1. Source-checkbox filtering within the shared two-document workset: deselecting a source limits graph/analysis to the selected source; restoring selection or Union restores both documents.
2. Grouped multi-axiom rendering in the latest bundle: multiple supported class axioms are explained separately with corresponding evidence, without dropping an axiom or falsely reporting an expression conflict.

These are user-reported live-test results, not independent agent reproduction in this turn. Direct browser download persistence cannot be confirmed; the UI and serializer only claim download initiation. No additional required page-acceptance task remains.

## Independent correctness review

A read-only review found five concrete cases beyond the earlier suite: unbudgeted list diagnostic DFS, mandatory report metadata/evidence lost under output budgets, duplicate list-link occurrences treated as conflicting, multiple compatible class axioms treated as conflicting, and invalid restriction operand kinds reported complete. All five received focused repairs and regression coverage in this round. List diagnostics use an explicit traversal budget and bounded evidence, duplicate link occurrences retain evidence without false conflicts, compatible direct/list axioms return independently qualified child results, and invalid restriction operand kinds remain incomplete. Reports reserve mandatory metadata before optional trees and discard claims whose statement references are trimmed out. Earlier passing tests did not establish these cases were correct.

## Automated checks

After integrating the independent review fixes, `npm run build` passed. On 2026-11-18, the final rerun of `npm run check` (333/333 tests, including generated-bundle consistency), `npm run i18n`, `openspec validate add-ontology-semantic-inspection --strict`, `openspec validate --all --strict` (10/10 items), and `git diff --check` all passed. Package version remains 1.1.0; only CRLF-to-LF advisory warnings were emitted by Git. Focused tests include the semantic fixture, AnalysisPanel severity/entity filters, Escape callback, output cap counts and download feedback, report metadata reservation, and evidence-reference closure. The 333 count records this run only, not a permanent project gate.

## Current assessment

Completeness: 35/35 tracked tasks are checked after the user's explicit acceptance of both 4.7c manual tests. Cross-preview sharing/unsharing, shared-source checkbox filtering, and grouped multi-axiom display are supported by user-reported live-test evidence. Correctness: the five reproduced review defects are repaired and regression-tested. Coherence: L0-only/no-inference/bounded output and no fabricated locations are retained. Automated results are recorded separately from manual acceptance. Implementation and tracked acceptance are complete. The user subsequently authorized synchronization, archive, commit and push; no package version bump or release was requested.

## Authorized archival follow-up (2026-11-18)

- Synced the four new semantic-inspection capabilities into main specs and merged the parser/workspace literal-identity changes, preserving established titles, Purpose sections and unrelated requirements/scenarios.
- Verified all six deltas against their main specs before moving this change to `openspec/changes/archive/2026-11-18-add-ontology-semantic-inspection/`, retaining `.openspec.yaml` and this acceptance record.
- Post-sync/post-archive checks passed: 333/333 tests with generated-bundle consistency, i18n, 13/13 main specifications under strict validation, and `git diff --check`. Package version remains 1.1.0.
- Git commit/push completion is reported by the actual Git command results; this document does not pre-claim remote delivery.
