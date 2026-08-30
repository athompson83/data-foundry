import { z } from 'zod';
import {
  IsoDateTimeSchema,
  RefreshCadenceSchema,
  RightsClassificationSchema,
  RobotsPolicySchema,
  SlugSchema,
  SourceTypeSchema,
  SourceStatusSchema,
  AttributionRequirementSchema,
  type SourceInsert,
  type VerticalId,
} from '@data-foundry/canonical-schema';
import {
  AcquisitionPolicySchema,
  CodeVsDataLicenseSchema,
  ProvenanceRetentionPolicySchema,
  SourceImagePolicySchema,
  SourceRightsPolicySchema,
} from './rights-policy.js';

/**
 * Stable, human-authored key for a source (`ratings-directory`, `acme-catalog`).
 * Registry files are keyed by this, not by database UUID, so a source survives
 * a database rebuild.
 */
export const SourceKeySchema = SlugSchema;
export type SourceKey = z.infer<typeof SourceKeySchema>;

/**
 * A source as declared in `verticals/<slug>/sources/*.yaml` — everything a
 * human writes down, before the row exists in Postgres.
 *
 * This is the shape the registry loader returns and the shape CI validates. It
 * carries the doc 13 policy record inline: a source declaration without rights
 * metadata is not a valid declaration (AGENTS.md rule 1), so the fields are
 * required rather than optional.
 */
export const SourceRegistryEntrySchema = z.object({
  key: SourceKeySchema,
  vertical_slug: SlugSchema,

  publisher: z.string().min(1).max(300),
  domain: z.string().min(1).max(253),
  source_type: SourceTypeSchema,
  /** Field-independent trust weight, 0–100. Not a confidence score. */
  authority_rank: z.number().int().min(0).max(100),
  status: SourceStatusSchema,
  refresh_cadence: RefreshCadenceSchema,

  rights_classification: RightsClassificationSchema,
  attribution_requirement: AttributionRequirementSchema,
  robots_policy: RobotsPolicySchema,

  rights_policy: SourceRightsPolicySchema,
  acquisition_policy: AcquisitionPolicySchema,
  image_policy: SourceImagePolicySchema,
  provenance_retention: ProvenanceRetentionPolicySchema,
  license_split: CodeVsDataLicenseSchema,

  /** Operator kill switch (doc 13, "Takedown/suspension"). Overrides everything. */
  kill_switch_engaged: z.boolean(),
  notes: z.string().max(4000),
});
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

/** Project a declaration onto the `sources` row it becomes. */
export function toSourceInsert(entry: SourceRegistryEntry, verticalId: VerticalId): SourceInsert {
  return {
    vertical_id: verticalId,
    publisher: entry.publisher,
    domain: entry.domain,
    source_type: entry.source_type,
    authority_rank: entry.authority_rank,
    rights_classification: entry.rights_classification,
    attribution_requirement: entry.attribution_requirement,
    robots_policy: entry.robots_policy,
    refresh_cadence: entry.refresh_cadence,
    status: entry.status,
    kill_switch_engaged: entry.kill_switch_engaged,
  };
}

export const SOURCE_HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'FAILING', 'BLOCKED', 'UNKNOWN'] as const;
export const SourceHealthStateSchema = z.enum(SOURCE_HEALTH_STATES);
export type SourceHealthState = z.infer<typeof SourceHealthStateSchema>;

/**
 * Observed acquisition health for a source. Health is not rights: a perfectly
 * healthy source may still be unpublishable, and a RED source is blocked even
 * when every fetch succeeds.
 */
export const SourceHealthSchema = z.object({
  source_key: SourceKeySchema,
  state: SourceHealthStateSchema,
  last_success_at: IsoDateTimeSchema.nullable(),
  last_failure_at: IsoDateTimeSchema.nullable(),
  last_http_status: z.number().int().min(0).max(599).nullable(),
  consecutive_failures: z.number().int().min(0),
  success_rate_7d: z.number().min(0).max(1).nullable(),
  artifacts_last_7d: z.number().int().min(0),
  /** Hours since the newest artifact; compared against the cadence budget. */
  staleness_hours: z.number().min(0).nullable(),
});
export type SourceHealth = z.infer<typeof SourceHealthSchema>;

export type SourceHealthSignals = Pick<
  SourceHealth,
  'consecutive_failures' | 'success_rate_7d' | 'last_http_status'
>;

/**
 * Deterministic health classification. Deliberately boring thresholds — health
 * state drives alerting and pausing, so it must be reproducible from the same
 * inputs rather than judged.
 */
export function deriveSourceHealthState(signals: SourceHealthSignals): SourceHealthState {
  const status = signals.last_http_status;
  if (status === 401 || status === 403 || status === 451) return 'BLOCKED';
  if (signals.consecutive_failures >= 5) return 'FAILING';
  if (signals.success_rate_7d === null) return 'UNKNOWN';
  if (signals.success_rate_7d < 0.5) return 'FAILING';
  if (signals.success_rate_7d < 0.9 || signals.consecutive_failures > 0) return 'DEGRADED';
  return 'HEALTHY';
}
