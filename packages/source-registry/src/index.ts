/**
 * `@data-foundry/source-registry`
 *
 * The source rights and health contract, plus the publish gate that AGENTS.md
 * rule 1 demands. Depends only on `@data-foundry/canonical-schema`.
 *
 * Nothing in here fetches bytes. Acquisition adapters (Browser Run, Crawl4AI,
 * direct HTTP) read policy from this package; they do not define it.
 */

export * from './rights-policy.js';
export * from './entry.js';
export * from './publish-gate.js';
export * from './loader.js';

// Re-exported for convenience so acquisition/ingest code has one import for the
// rights vocabulary it needs.
export {
  canPublish,
  publishDecision,
  assertCanPublish,
  requiresLegalReview,
  normalizeRightsClassification,
  RightsViolationError,
  RIGHTS_CLASSIFICATIONS,
  PUBLISHABLE_RIGHTS_CLASSIFICATIONS,
  BLOCKED_RIGHTS_CLASSIFICATIONS,
  type RightsClassification,
} from '@data-foundry/canonical-schema';
