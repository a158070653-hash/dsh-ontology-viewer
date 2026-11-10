/**
 * Presentation constants and the stylesheet for the ontology graph view.
 *
 * This module is concatenated before graph-view.js and shares its closure with
 * the rest of the Client bundle, so graph-view.js may reference these
 * identifiers directly. It is also imported by the Node tests, therefore it
 * must never touch React, the DOM or any other module at load time.
 *
 * Colour rule: every colour in this stylesheet comes from a host
 * `--dsw-alias-*` token (with a literal fallback); no foreground colour is
 * hard-coded.
 */

/** Zoom limits for the SVG viewport. */
const GRAPH_MIN_ZOOM = 0.15
const GRAPH_MAX_ZOOM = 4
/** Fallback canvas size before the first measurement. */
const GRAPH_DEFAULT_SIZE = { width: 900, height: 600 }
/** Label level-of-detail thresholds (node count and zoom). */
const GRAPH_LABEL_NODE_LIMIT = 260
const GRAPH_LABEL_ZOOM = 0.8
/** Below this canvas width the layout switches to its narrow mode. */
const GRAPH_NARROW_WIDTH = 640
/** Padding used when fitting the graph into the viewport. */
const GRAPH_FIT_PADDING = 30
/** matchNodes() result cap kept in memory; the dropdown shows fewer. */
const GRAPH_SEARCH_LIMIT = 500
/** Search dropdown page size from the graph-view spec (default 20). */
const GRAPH_SEARCH_VISIBLE = 20
/** Draw budget: maximum rendered edges (SVG element budget, see design §8.2). */
const GRAPH_EDGE_BUDGET = 6000
/** Multi-hop exploration budget handed to exploreNeighborhood. */
const GRAPH_EXPLORE_BUDGET = { perHopNodes: 300, maxEdges: 800 }

/** Empty graph-model statistics; a fallback so render never divides by null. */
const GRAPH_EMPTY_STATS = {
  triples: 0,
  nodes: 0,
  edges: 0,
  literals: 0,
  classes: 0,
  properties: 0,
  individuals: 0,
  blanks: 0,
  droppedNodes: 0,
  droppedEdges: 0,
  droppedLiterals: 0,
}

/** Fully empty graph used by the view's defensive normaliser. */
const GRAPH_EMPTY_GRAPH = { nodes: [], edges: [], stats: GRAPH_EMPTY_STATS, warnings: [] }

/**
 * Single stylesheet injected by the view root. Every class is `dov-` prefixed.
 * The first block is the V1.0.0 visual language; the second half is the
 * incremental chrome added by this change (popovers, banners, relation groups,
 * accessible helpers). Colours stay theme-token based throughout.
 */
const GRAPH_VIEW_CSS = `
.dov-root { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; line-height: 1.45; }
.dov-header { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-2, #f7f8fa); border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); }
.dov-source { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-weight: 600; }
.dov-stats { display: flex; align-items: center; gap: 8px; white-space: nowrap; color: var(--dsw-alias-label-tertiary, #8b9096); font-variant-numeric: tabular-nums; }
.dov-stat b { color: var(--dsw-alias-label-secondary, #57606a); font-weight: 600; }
.dov-spacer { flex: 1 1 20px; }
.dov-toolbar-sep { flex: none; width: 1px; height: 18px; background: var(--dsw-alias-border-l1, #e5e7eb); }
.dov-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dov-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; padding: 0 9px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; white-space: nowrap; }
.dov-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); color: var(--dsw-alias-label-primary, #1f2328); }
.dov-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, .08)); }
.dov-btn[aria-pressed="true"] { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 10%, transparent); }
.dov-btn:disabled { opacity: .4; cursor: default; }
.dov-btn--icon { width: 26px; padding: 0; font-size: 15px; }
.dov-btn--small { height: 22px; padding: 0 7px; font-size: 11px; }
.dov-btn:focus-visible, .dov-copy:focus-visible, .dov-type:focus-visible, .dov-rel-item:focus-visible, .dov-group-head:focus-visible, .dov-diag-head:focus-visible, .dov-issues-toggle:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 55%, transparent); outline-offset: 1px; }
.dov-zoom { min-width: 40px; text-align: center; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; font-variant-numeric: tabular-nums; }
.dov-badge { flex: none; border-radius: 999px; padding: 1px 7px; font-size: 10px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-bg-layer-1, #ffffff); }
.dov-badge--warn { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 8%, transparent); }
.dov-badge--active { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 8%, transparent); }
.dov-search { box-sizing: border-box; display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 6px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); }
.dov-search:focus-within { border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 55%, transparent); }
.dov-search-input { width: 132px; height: 24px; border: 0; outline: none; background: transparent; color: var(--dsw-alias-label-primary, #1f2328); font: inherit; font-size: 12px; }
.dov-search-input::placeholder { color: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-search-count { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dov-search-count--none { opacity: .7; }
.dov-search-clear { border: 0; padding: 0 2px; background: transparent; color: var(--dsw-alias-label-tertiary, #8b9096); font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
.dov-issues { flex: none; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 5%, var(--dsw-alias-bg-layer-1, #ffffff)); }
.dov-issues-toggle { display: flex; width: 100%; align-items: center; gap: 6px; padding: 5px 10px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.dov-issues-list { max-height: 160px; overflow: auto; margin: 0; padding: 0 10px 8px 26px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; }
.dov-issues-list li { margin: 2px 0; overflow-wrap: anywhere; }
.dov-body { flex: 1; min-height: 0; display: flex; position: relative; }
.dov-canvas { flex: 1; min-height: 0; position: relative; overflow: hidden; background: var(--dsw-alias-bg-layer-1, #ffffff); }
.dov-svg { display: block; width: 100%; height: 100%; user-select: none; touch-action: none; cursor: grab; outline: none; }
.dov-svg[data-drag="pan"], .dov-svg[data-drag="node"] { cursor: grabbing; }
.dov-svg:focus-visible { outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 55%, transparent); outline-offset: -2px; }
.dov-backdrop { pointer-events: none; }
.dov-grid-line { fill: none; stroke: var(--dsw-alias-border-l1, #e5e7eb); stroke-width: .6; opacity: .65; }
.dov-edge { fill: none; stroke: var(--dsw-alias-border-l2, #cfd4da); stroke-width: 1; stroke-linecap: round; opacity: .9; vector-effect: non-scaling-stroke; transition: opacity .12s ease, stroke .12s ease; }
.dov-edge--type { stroke-dasharray: 3 3; }
.dov-edge--subclass { stroke-dasharray: 7 3; }
.dov-edge--blank { stroke-dasharray: 1 3.2; }
.dov-edge.dov-is-active { stroke: var(--dsw-alias-brand-primary, #4d6bfe); opacity: 1; }
.dov-edge.dov-is-dim { opacity: .1; }
.dov-edge-label { fill: var(--dsw-alias-label-tertiary, #8b9096); font-size: 9px; pointer-events: none; paint-order: stroke; stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 3px; stroke-linejoin: round; }
.dov-node { cursor: pointer; transition: opacity .12s ease; }
.dov-node.dov-is-dim { opacity: .13; }
.dov-node.dov-is-context { opacity: .6; }
.dov-edge.dov-is-context { opacity: .5; }
.dov-node-hit { fill: transparent; }
.dov-node-dot { stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 1.5; }
.dov-node-halo { fill: none; stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 1.5; opacity: .5; pointer-events: none; }
.dov-node--class .dov-node-dot { fill: var(--dsw-alias-brand-primary, #4d6bfe); }
.dov-node--property .dov-node-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 62%, var(--dsw-alias-bg-layer-1, #ffffff)); }
.dov-node--individual .dov-node-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 30%, var(--dsw-alias-bg-layer-1, #ffffff)); }
.dov-node--blank .dov-node-dot { fill: var(--dsw-alias-bg-layer-2, #f7f8fa); stroke: var(--dsw-alias-label-tertiary, #8b9096); stroke-dasharray: 2 1.5; }
.dov-node--external .dov-node-dot { fill: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-node.dov-is-active .dov-node-dot { stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 2; }
.dov-node.dov-is-selected .dov-node-halo { opacity: 1; stroke-width: 2; }
.dov-node.dov-is-match .dov-node-halo { opacity: .85; stroke-dasharray: 2 2; }
.dov-node:focus { outline: none; }
.dov-node.dov-is-focus .dov-node-dot { stroke: var(--dsw-alias-brand-primary, #4d6bfe); stroke-width: 2; }
.dov-node.dov-is-focus .dov-node-halo { opacity: 1; stroke-width: 2; stroke-dasharray: 2 2; }
.dov-node-label { fill: var(--dsw-alias-label-secondary, #57606a); font-size: 10px; pointer-events: none; paint-order: stroke; stroke: var(--dsw-alias-bg-layer-1, #ffffff); stroke-width: 3px; stroke-linejoin: round; }
.dov-node.dov-is-selected .dov-node-label, .dov-node.dov-is-hovered .dov-node-label { fill: var(--dsw-alias-label-primary, #1f2328); font-weight: 600; }
.dov-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; pointer-events: none; }
.dov-empty-icon { width: 56px; height: 56px; color: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-empty-icon circle { fill: var(--dsw-alias-bg-layer-2, #f7f8fa); stroke: currentColor; stroke-width: 1.5; }
.dov-empty-icon line { stroke: currentColor; stroke-width: 1.5; }
.dov-empty-title { color: var(--dsw-alias-label-secondary, #57606a); font-size: 13px; font-weight: 600; }
.dov-empty-hint { max-width: 320px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-empty-actions { display: flex; gap: 6px; pointer-events: auto; }
.dov-canvas-hint { position: absolute; left: 10px; bottom: 8px; max-width: calc(100% - 20px); padding: 2px 6px; border-radius: 4px; pointer-events: none; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 78%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dov-canvas-badge { position: absolute; left: 10px; top: 10px; padding: 3px 9px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l1, #e5e7eb); pointer-events: none; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #ffffff) 86%, transparent); }
.dov-canvas-badge--busy { top: auto; bottom: 10px; left: auto; right: 10px; }
.dov-computing { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px; text-align: center; pointer-events: none; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2, #d5d9df); border-top-color: var(--dsw-alias-brand-primary, #4d6bfe); animation: dov-spin .8s linear infinite; }
@keyframes dov-spin { to { transform: rotate(360deg); } }
.dov-panel { position: absolute; top: 0; right: 0; bottom: 0; z-index: 4; width: min(300px, calc(100% - 32px)); display: flex; flex-direction: column; overflow: hidden; background: var(--dsw-alias-bg-layer-2, #f7f8fa); border-left: .5px solid var(--dsw-alias-border-l1, #e5e7eb); box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 18%, transparent); }
.dov-panel:focus { outline: none; }
.dov-panel-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dov-panel-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-weight: 600; }
.dov-panel-body { flex: 1; min-height: 0; overflow: auto; padding-bottom: 12px; }
.dov-section { padding: 10px 10px 0; }
.dov-section-title { margin-bottom: 5px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
.dov-section-title--row { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.dov-iri-row { display: flex; align-items: flex-start; gap: 6px; }
.dov-iri { flex: 1; min-width: 0; color: var(--dsw-alias-label-primary, #1f2328); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; user-select: text; }
.dov-copy { flex: none; height: 22px; padding: 0 7px; border-radius: 5px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; cursor: pointer; }
.dov-copy:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dov-copy:disabled { opacity: .45; cursor: default; }
.dov-types { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.dov-type { max-width: 100%; border: 0; padding: 1px 0; background: transparent; color: var(--dsw-alias-brand-primary, #4d6bfe); font: inherit; font-size: 11px; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.dov-type:hover { text-decoration: underline; }
.dov-type--plain { color: var(--dsw-alias-label-secondary, #57606a); cursor: default; text-decoration: none; }
.dov-chip { flex: none; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 999px; padding: 0 6px; color: var(--dsw-alias-label-secondary, #57606a); background: var(--dsw-alias-bg-layer-1, #ffffff); font-size: 10px; line-height: 16px; }
.dov-chip--class { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 42%, transparent); }
.dov-literals { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dov-literals td { padding: 4px 0; border-top: .5px solid var(--dsw-alias-border-l1, #e5e7eb); vertical-align: top; font-size: 11px; overflow-wrap: anywhere; }
.dov-literals tr:first-child td { border-top: 0; }
.dov-lit-p { width: 38%; padding-right: 8px; color: var(--dsw-alias-label-tertiary, #8b9096); }
.dov-lit-v { color: var(--dsw-alias-label-primary, #1f2328); }
.dov-lit-meta { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-counts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.dov-count { padding: 6px; border: .5px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); text-align: center; }
.dov-count b { display: block; color: var(--dsw-alias-label-primary, #1f2328); font-size: 13px; font-variant-numeric: tabular-nums; }
.dov-count span { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-muted { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-scrim { position: absolute; inset: 0; z-index: 3; border: 0; padding: 0; background: color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 20%, transparent); }
.dov-root--narrow .dov-source { max-width: 150px; }
.dov-root--narrow .dov-search-input { width: 96px; }
.dov-root--narrow .dov-canvas-hint { display: none; }
.dov-root--narrow .dov-panel { position: absolute; top: 0; right: 0; bottom: 0; z-index: 4; width: min(300px, calc(100% - 32px)); box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 24%, transparent); }
.dov-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.dov-notice { flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 5px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 7%, var(--dsw-alias-bg-layer-1, #ffffff)); color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; }
.dov-notice-text { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.dov-notice-actions { display: flex; gap: 6px; flex: none; }
.dov-budget-list { margin: 0; padding: 0 10px 8px; list-style: none; }
.dov-budget-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 2px 0; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; }
.dov-budget-kind { flex: none; min-width: 84px; color: var(--dsw-alias-label-primary, #1f2328); font-weight: 600; }
.dov-budget-reason { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-budget-note { padding: 0 10px 6px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-diag-group { margin: 4px 0; }
.dov-diag-head { display: flex; width: 100%; align-items: baseline; gap: 6px; padding: 2px 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.dov-diag-code { color: var(--dsw-alias-label-primary, #1f2328); font-weight: 600; }
.dov-diag-count { color: var(--dsw-alias-label-tertiary, #8b9096); font-variant-numeric: tabular-nums; }
.dov-diag-samples { margin: 2px 0 4px; padding: 0 0 0 16px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-diag-samples li { margin: 1px 0; overflow-wrap: anywhere; }
.dov-group { margin-top: 2px; }
.dov-group-head { display: flex; width: 100%; align-items: center; gap: 6px; padding: 2px 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.dov-group-pred { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); }
.dov-group-count { color: var(--dsw-alias-label-tertiary, #8b9096); font-variant-numeric: tabular-nums; }
.dov-rel-list { margin: 0; padding: 0 0 0 8px; list-style: none; border-left: .5px solid var(--dsw-alias-border-l1, #e5e7eb); }
.dov-rel-item { display: flex; align-items: baseline; gap: 6px; width: 100%; padding: 1px 0 1px 4px; border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #4d6bfe); font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.dov-rel-item:hover { text-decoration: underline; }
.dov-rel-endpoint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dov-rel-hidden { flex: none; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 9px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 999px; padding: 0 4px; }
.dov-rel-more { padding: 1px 0 1px 4px; border: 0; background: transparent; color: var(--dsw-alias-brand-primary, #4d6bfe); font: inherit; font-size: 10px; cursor: pointer; }
.dov-rel-empty { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; }
.dov-pop { position: absolute; z-index: 6; top: 6px; right: 10px; width: 330px; max-height: calc(100% - 16px); display: flex; flex-direction: column; overflow: hidden; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 18%, transparent); }
.dov-pop--wide { width: 360px; }
.dov-pop-head { flex: none; display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dov-pop-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; font-weight: 600; }
.dov-pop-body { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px 12px; }
.dov-pop-section { margin-top: 10px; }
.dov-pop-section:first-child { margin-top: 0; }
.dov-pop-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dov-pop-label { display: block; margin-bottom: 4px; color: var(--dsw-alias-label-secondary, #57606a); font-size: 11px; font-weight: 600; }
.dov-pop-hint { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; line-height: 1.4; }
.dov-pop-counts { display: flex; flex-direction: column; gap: 2px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; font-variant-numeric: tabular-nums; }
.dov-check-list { display: flex; flex-direction: column; gap: 1px; max-height: 168px; overflow: auto; padding: 2px 0; }
.dov-check { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 4px; cursor: pointer; font-size: 11px; color: var(--dsw-alias-label-primary, #1f2328); }
.dov-check:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .05)); }
.dov-check input { margin: 0; accent-color: var(--dsw-alias-brand-primary, #4d6bfe); }
.dov-check-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dov-check-count { color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 10px; font-variant-numeric: tabular-nums; }
.dov-radio-row { display: flex; gap: 4px; flex-wrap: wrap; }
.dov-radio { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: var(--dsw-alias-label-secondary, #57606a); font: inherit; font-size: 11px; cursor: pointer; }
.dov-radio[aria-pressed="true"] { color: var(--dsw-alias-brand-primary, #4d6bfe); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 10%, transparent); }
.dov-radio:disabled { opacity: .45; cursor: default; }
.dov-pop-footer { flex: none; display: flex; gap: 6px; justify-content: flex-end; padding: 8px 10px; border-top: .5px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-2, #f7f8fa); }
.dov-search-wrap { position: relative; display: flex; align-items: center; }
.dov-search-list { position: absolute; z-index: 9; top: 30px; left: 0; width: 300px; max-height: 260px; overflow: auto; margin: 0; padding: 4px; list-style: none; border: .5px solid var(--dsw-alias-border-l2, #d5d9df); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #ffffff); box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary, #1f2328) 18%, transparent); }
.dov-search-option { display: flex; align-items: baseline; gap: 6px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
.dov-search-option[aria-selected="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 12%, transparent); }
.dov-search-option-label { min-width: 0; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-primary, #1f2328); font-size: 11px; }
.dov-search-iri { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary, #8b9096); font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 10px; text-align: right; }
.dov-search-empty { padding: 8px; color: var(--dsw-alias-label-tertiary, #8b9096); font-size: 11px; }
.dov-root--narrow .dov-header { flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden; padding: 6px 8px; }
.dov-root--narrow .dov-actions { flex-wrap: nowrap; }
.dov-root--narrow .dov-pop { position: absolute; left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 62%; border-radius: 10px; }
.dov-root--narrow .dov-search-list { position: fixed; top: 46px; left: 8px; right: 8px; width: auto; }
.dov-root--narrow .dov-pop-footer { position: sticky; bottom: 0; }
@media (prefers-reduced-motion: reduce) { .dov-node, .dov-edge, .dov-notice, .dov-pop, .dov-search-list, .dov-group, .dov-diag-group { transition: none; animation: none; } .dov-spinner { animation: none; } }
`
