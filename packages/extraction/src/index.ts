/**
 * `@data-foundry/extraction`
 *
 * Turns acquired artifacts into **source-native records** (doc 02, "EXTRACTION /
 * STAGING"; doc 04, "a source record is not a canonical entity").
 *
 * What this package does:
 *
 * - one `ExtractionProvider` contract, four concrete providers (JSON, CSV, HTML,
 *   PDF), selected by format;
 * - schema-driven, declarative mapping configs — onboarding a new source of an
 *   existing format is data, not TypeScript (AGENTS.md rule 4);
 * - a locator on **every** extracted value, so provenance can later prove where
 *   a fact came from (AGENTS.md rule 2);
 * - `extraction_confidence` computed from observed signals, never hard-coded.
 *
 * What this package must never do: create canonical entities, resolve identity,
 * merge records, or import `canonical-store` / `entity-resolution`. Its only
 * workspace dependency is `@data-foundry/canonical-schema`.
 */

export * from './locator.js';
export * from './types.js';
export * from './schema.js';
export * from './confidence.js';
export * from './record-builder.js';
export * from './registry.js';
export * from './source-record.js';

export { JsonExtractor, createJsonExtractor } from './providers/json-extractor.js';
export { CsvExtractor, createCsvExtractor } from './providers/csv-extractor.js';
export { HtmlExtractor, createHtmlExtractor } from './providers/html-extractor.js';
export { PdfExtractor, createPdfExtractor } from './providers/pdf-extractor.js';
export { cssPathOf, labelMatches, withAttribute, isTagNode, type HtmlNodeLike } from './providers/html-dom.js';
