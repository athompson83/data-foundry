/**
 * `@data-foundry/acquisition`
 *
 * The acquisition layer: it obtains bytes from approved sources, records the
 * rights and robots state that permitted the fetch, and writes the bytes into
 * the raw evidence store content-addressed and idempotently.
 *
 * What this package knows about: URLs, headers, HTTP status codes, bytes, mime
 * types, hashes, robots directives, rate limits and rights records.
 *
 * What it does not know about, and must never learn: entities, facts,
 * relationships, normalization, any specific vertical, or any specific vendor's
 * semantics leaking past its adapter (AGENTS.md rules 4 and 6).
 *
 * Composition looks like this:
 *
 * ```ts
 * const providers = new AcquisitionProviderRegistry([
 *   new HttpAcquisitionProvider({ deps }),
 *   new BrowserRunAcquisitionProvider({ deps, ...credentials }),
 *   new Crawl4AIAcquisitionProvider({ deps, baseUrl }),
 * ]);
 * const provider = providers.forEntry(sourceEntry); // never a branch on provider type
 * const { artifacts } = await provider.fetch(request);
 * ```
 */

export * from './errors.js';
export * from './clock.js';
export * from './hashing.js';
export * from './fs.js';
export * from './types.js';
export * from './provider.js';
export * from './policy/gate-types.js';
export * from './policy/robots.js';
export * from './policy/rights-gate.js';
export * from './policy/refresh-schedule.js';
export * from './policy/rate-limit.js';
export * from './policy/conditional.js';
export * from './policy/result-policy.js';
export * from './policy/policy-snapshot.js';

export * from './storage/keys.js';
export * from './storage/artifact-store.js';
export * from './storage/r2-artifact-store.js';
export * from './storage/local-fs-artifact-store.js';
export * from './storage/orphans.js';

export * from './providers/http-client.js';
export * from './providers/base.js';
export * from './providers/http.js';
export * from './providers/browser-run.js';
export * from './providers/crawl4ai.js';
export * from './providers/fixture.js';

// Re-exported so acquisition callers have one import for the rights vocabulary
// they must not route around.
export {
  canPublish,
  assertCanPublish,
  publishDecision,
  RightsViolationError,
  type RightsClassification,
  type SourceArtifact,
  type SourceArtifactId,
  type SourceId,
  type ContentHash,
  type StorageUri,
  type PolicySnapshotId,
} from '@data-foundry/canonical-schema';
