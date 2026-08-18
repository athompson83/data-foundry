import { z } from 'zod';

/**
 * Shared scalar primitives for the canonical model.
 *
 * Every timestamp crossing a package boundary is an ISO-8601 string, not a
 * `Date`. Dates are not JSON-Schema representable, do not survive a Postgres →
 * JSON → Worker round trip unambiguously, and silently lose timezone intent.
 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IsoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof IsoDateSchema>;

/** Lowercase, hyphen-separated URL segment. */
export const SlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase hyphen-separated slug');
export type Slug = z.infer<typeof SlugSchema>;

/**
 * A vertical-defined identifier: entity types, fact properties, relationship
 * predicates and alias types are all declared by vertical configuration, never
 * by a hardcoded platform enum (AGENTS.md rule 4).
 */
export const IdentifierSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be a lowercase snake_case identifier');
export type Identifier = z.infer<typeof IdentifierSchema>;

/** SHA-256 content hash, lowercase hex. Raw evidence is addressed by hash. */
export const ContentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256 digest');
export type ContentHash = z.infer<typeof ContentHashSchema>;

/** Absolute http(s) URL of a source document. */
export const UrlSchema = z.url();
export type Url = z.infer<typeof UrlSchema>;

/**
 * Object-store URI (`r2://bucket/key`, `s3://...`, `file://...`). Deliberately
 * not `z.url()` because R2/S3 schemes are not registered web URLs.
 */
export const StorageUriSchema = z
  .string()
  .regex(/^[a-z][a-z0-9+.-]*:\/\/.+$/i, 'must be a scheme-qualified storage URI');
export type StorageUri = z.infer<typeof StorageUriSchema>;

/** Free-form structured payload persisted as `jsonb`. */
export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;

/** Version string for a vertical/canonical schema, e.g. `2024.1` or `1.4.0`. */
export const SchemaVersionSchema = z.string().min(1).max(64);
export type SchemaVersion = z.infer<typeof SchemaVersionSchema>;

/** Version string of the parser/extractor that produced a record. */
export const ExtractorVersionSchema = z.string().min(1).max(120);
export type ExtractorVersion = z.infer<typeof ExtractorVersionSchema>;

export const REFRESH_CADENCES = [
  'MANUAL',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUALLY',
  'EVENT_DRIVEN',
] as const;
export const RefreshCadenceSchema = z.enum(REFRESH_CADENCES);
export type RefreshCadence = z.infer<typeof RefreshCadenceSchema>;

/** Default refresh behaviour for a vertical; individual sources may override. */
export const RefreshPolicySchema = z.object({
  cadence: RefreshCadenceSchema,
  /** Age at which content is considered stale enough to warrant re-acquisition. */
  max_staleness_hours: z.number().int().min(1),
  /** Scheduling priority, higher runs first. */
  priority: z.number().int().min(0).max(100),
});
export type RefreshPolicy = z.infer<typeof RefreshPolicySchema>;

/**
 * Where in an artifact a claim was observed. "selector/page/JSON pointer/etc."
 * is modelled as a typed pair rather than an opaque string so provenance can be
 * re-resolved mechanically when an artifact is reprocessed.
 */
export const LOCATOR_TYPES = [
  'WHOLE_DOCUMENT',
  'CSS_SELECTOR',
  'XPATH',
  'JSON_POINTER',
  'PAGE',
  'LINE_RANGE',
  'BYTE_RANGE',
  'TABLE_CELL',
  'REGEX_MATCH',
] as const;
export const LocatorTypeSchema = z.enum(LOCATOR_TYPES);
export type LocatorType = z.infer<typeof LocatorTypeSchema>;
