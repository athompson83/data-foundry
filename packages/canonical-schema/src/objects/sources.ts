import { z } from 'zod';
import { SourceIdSchema, VerticalIdSchema } from '../ids.js';
import { ContentHashSchema, IsoDateTimeSchema, RefreshCadenceSchema } from '../primitives.js';
import { AttributionRequirementSchema, RightsClassificationSchema } from '../rights.js';

export const SOURCE_TYPES = [
  'REGULATORY',
  'STANDARDS_BODY',
  'CERTIFICATION_BODY',
  /**
   * A register maintained by a regulator, holding values the MANUFACTURER
   * asserted to it.
   *
   * Distinct from `REGULATORY` and from `CERTIFICATION_BODY`, because those two
   * describe different things and this sits between them. `REGULATORY` says the
   * agency asserts the value. `CERTIFICATION_BODY` says an independent body
   * measured it under a defined test procedure. A filing is neither: the
   * regulator hosts it and the manufacturer asserts it.
   *
   * The distinction is the publisher's own, not ours. DOE says of its
   * Compliance Certification Database, verbatim: "The appearance of a model on
   * this web site is not an indication that DOE has determined that the model is
   * compliant with DOE energy conservation standards."
   *
   * It ranks above `MANUFACTURER` because a filing carries legal consequence for
   * misstatement that a specification sheet does not, and below
   * `CERTIFICATION_BODY` because nobody independent measured it.
   */
  'REGULATORY_FILING',
  'MANUFACTURER',
  'DISTRIBUTOR',
  'TRADE_ASSOCIATION',
  'MARKETPLACE',
  'AGGREGATOR',
  'COMMUNITY',
  'PARTNER_FEED',
  'LICENSED_DATASET',
  'OPEN_DATASET',
  'OTHER',
] as const;
export const SourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/**
 * Source lifecycle. `ACTIVE` is gated: doc 13 requires classification,
 * acquisition-method approval, attribution config, image policy and a
 * provenance retention policy before a source may be activated. See
 * `@data-foundry/source-registry` for the gate itself.
 */
export const SOURCE_STATUSES = [
  'PROPOSED',
  'UNDER_REVIEW',
  'APPROVED',
  'ACTIVE',
  'PAUSED',
  'SUSPENDED',
  'RETIRED',
] as const;
export const SourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

/**
 * Snapshot of the robots directives in force when this source was last
 * reviewed. Stored, not fetched-at-crawl-time, so a crawl decision can be
 * explained after the fact.
 */
export const RobotsPolicySchema = z.object({
  respect_robots: z.boolean(),
  user_agent: z.string().min(1).max(200),
  crawl_delay_seconds: z.number().min(0).max(86_400).nullable(),
  disallowed_paths: z.array(z.string().min(1)).max(2000),
  allowed_paths: z.array(z.string().min(1)).max(2000),
  robots_url: z.url().nullable(),
  snapshot_hash: ContentHashSchema.nullable(),
  snapshot_at: IsoDateTimeSchema.nullable(),
});
export type RobotsPolicy = z.infer<typeof RobotsPolicySchema>;

/**
 * `sources` — one authoritative or commercial/public information source.
 *
 * `authority_rank` (0–100) is the field-independent trust weight used by
 * canonical fact selection; it is not a confidence score and is not on the
 * unit interval, deliberately, so it cannot be confused with one.
 */
export const SourceSchema = z.object({
  id: SourceIdSchema,
  vertical_id: VerticalIdSchema,
  publisher: z.string().min(1).max(300),
  domain: z.string().min(1).max(253),
  source_type: SourceTypeSchema,
  authority_rank: z.number().int().min(0).max(100),
  rights_classification: RightsClassificationSchema,
  attribution_requirement: AttributionRequirementSchema,
  robots_policy: RobotsPolicySchema,
  refresh_cadence: RefreshCadenceSchema,
  status: SourceStatusSchema,
  /** NULL exists only for pre-0016 rows and is refusal at every distribution surface. */
  kill_switch_engaged: z.boolean().nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Source = z.infer<typeof SourceSchema>;

export const SourceInsertSchema = SourceSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  kill_switch_engaged: true,
}).extend({ kill_switch_engaged: z.boolean() });
export type SourceInsert = z.infer<typeof SourceInsertSchema>;
