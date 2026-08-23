/**
 * Vitest workspace definition for the Data Foundry monorepo.
 *
 * Each workspace package owns its own test project so that a failing package is
 * attributable without inspecting file paths. Wave 1 ships the two contract
 * packages; later waves append their own entries here rather than creating
 * competing runner configs.
 */
export const projects = [
  'packages/canonical-schema',
  'packages/source-registry',
  'packages/acquisition',
  'packages/extraction',
  'packages/normalization',
  'packages/canonical-store',
  'packages/provenance',
  'packages/query-model',
  'services/ingest-worker',
  'services/export-builder',
  'apps/api',
  'apps/mcp',
  'apps/edge',
  'verticals/hvac',
  'tooling',
  // The repo-root `tests/` tree: integration, end-to-end and contract suites
  // that span packages and therefore belong to no single one of them. Its root
  // is the repository, so the runner's `tests/**` include pattern finds it.
  '.',
] as const;

export default projects;
