/**
 * Host half of dsh-ontology-viewer.
 *
 * The whole capability lives in the Client module (`./client.js`): it registers
 * an ontology graph renderer into DSH's right-sidebar document preview and a
 * file viewer into dsh-better-sidebar. The Host half only exists so the bundle
 * owns a visible row in the profile and can be enabled/disabled there.
 */
export function apply() {}
