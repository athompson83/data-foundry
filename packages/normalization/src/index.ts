/**
 * `@data-foundry/normalization`
 *
 * Turns source-native records into **typed canonical candidates** (doc 02,
 * "NORMALIZATION PIPELINE"; doc 06, layers 1–4).
 *
 * What this package does:
 *
 * - a deterministic, rule-driven pipeline: no LLM calls, no network, no
 *   randomness, no clock reads, no locale-sensitive operations;
 * - units with explicit conversion and **retention** — `1 ton = 12,000 BTU/h`,
 *   and the source unit is never silently dropped;
 * - identifier normalization for exact matching, with the display form always
 *   preserved (AGENTS.md rule 7);
 * - a `NormalizationRuleSet` loaded from vertical config as plain data, so a
 *   vertical adds fields without forking the platform (AGENTS.md rule 4);
 * - unmappable values recorded as failures **with a reason**, never coerced.
 *
 * What this package must never do: resolve identity, merge records, decide which
 * of two conflicting claims wins, or import `canonical-store` /
 * `entity-resolution`. Its only workspace dependency is
 * `@data-foundry/canonical-schema`.
 */

export * from './types.js';
export * from './failures.js';
export * from './text.js';
export * from './units.js';
export * from './identifier.js';
export * from './scalars.js';
export * from './vocabulary.js';
export * from './rules.js';
export * from './pipeline.js';
