/**
 * `@data-foundry/canonical-schema`
 *
 * The single source of truth for the Data Foundry core object model (doc 04),
 * the ingestion job state machine (doc 02) and the rights classification gate
 * (doc 13 / AGENTS.md rule 1).
 *
 * This package has exactly one runtime dependency (`zod`) and imports **nothing**
 * from other workspace packages. It knows nothing about UI, HTTP, Cloudflare,
 * acquisition providers or any specific vertical. Everything downstream depends
 * on it; it depends on nothing downstream. Keep it that way.
 */

export * from './primitives.js';
export * from './ids.js';
export * from './confidence.js';
export * from './rights.js';
export * from './job-state.js';
export * from './fact-versioning.js';

export * from './objects/verticals.js';
export * from './objects/sources.js';
export * from './objects/evidence.js';
export * from './objects/entities.js';
export * from './objects/facts.js';
export * from './objects/relationships.js';
export * from './objects/resolution.js';
export * from './objects/snapshots.js';
export * from './objects/media.js';
export * from './objects/ingestion-jobs.js';

export { CANONICAL_OBJECT_SCHEMAS, type CanonicalObjectName } from './registry.js';
