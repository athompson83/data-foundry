import { z } from 'zod';
import { EntityQualityScoreSchema, IdentityConfidenceSchema } from '../confidence.js';
import {
  EntityAliasIdSchema,
  EntityAliasClaimIdSchema,
  EntityIdSchema,
  EntityRedirectIdSchema,
  ResolutionJudgmentIdSchema,
  SourceIdSchema,
  SourceRecordIdSchema,
  VerticalIdSchema,
} from '../ids.js';
import { IdentifierSchema, IsoDateTimeSchema, LocatorTypeSchema, SlugSchema } from '../primitives.js';

export const ENTITY_STATUSES = [
  'CANDIDATE',
  'ACTIVE',
  'MERGED',
  'SPLIT',
  'SUPPRESSED',
  'RETIRED',
] as const;
export const EntityStatusSchema = z.enum(ENTITY_STATUSES);
export type EntityStatus = z.infer<typeof EntityStatusSchema>;

/**
 * `entities` — canonical real-world things.
 *
 * `entity_type` is a vertical-defined identifier (`manufacturer`, `equipment`,
 * `part`, `certification`), not a platform enum: adding an entity type is a
 * vertical config change, never an app fork (AGENTS.md rule 4).
 */
export const EntitySchema = z.object({
  id: EntityIdSchema,
  vertical_id: VerticalIdSchema,
  entity_type: IdentifierSchema,
  canonical_name: z.string().min(1).max(500),
  canonical_slug: SlugSchema,
  status: EntityStatusSchema,
  quality_score: EntityQualityScoreSchema,
  first_seen_at: IsoDateTimeSchema,
  last_verified_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntityInsertSchema = EntitySchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type EntityInsert = z.infer<typeof EntityInsertSchema>;

/**
 * Alias types that the platform understands out of the box. Verticals may
 * declare additional ones; this list is a floor, not a closed enum.
 */
export const CORE_ALIAS_TYPES = [
  'name',
  'legal_name',
  'dba',
  'abbreviation',
  'former_name',
  'misspelling',
  'model_number',
  'part_number',
  'sku',
  'mpn',
  'gtin',
  'upc',
  'domain',
  'url',
  'external_id',
] as const;

/**
 * `entity_aliases` — the exact-identifier index. AGENTS.md rule 7: deterministic
 * matching on `normalized_value` always beats vector similarity, so this table
 * is the first stop in resolution, not a fallback.
 */
export const EntityAliasSchema = z.object({
  id: EntityAliasIdSchema,
  entity_id: EntityIdSchema,
  alias_type: IdentifierSchema,
  /** Value exactly as the source wrote it. */
  alias_value: z.string().min(1).max(500),
  /** Deterministically normalized form used for lookup/joins. */
  normalized_value: z.string().min(1).max(500),
  /** Source that supplied the retained display spelling; claim rows alone decide currentness. */
  source_id: SourceIdSchema.nullable(),
  identity_confidence: IdentityConfidenceSchema,
  valid_from: IsoDateTimeSchema,
  valid_to: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export type EntityAlias = z.infer<typeof EntityAliasSchema>;

export const EntityAliasInsertSchema = EntityAliasSchema.omit({
  id: true,
  created_at: true,
});
export type EntityAliasInsert = z.infer<typeof EntityAliasInsertSchema>;

export const ENTITY_ALIAS_CLAIM_KINDS = ['CURATED', 'SOURCE_RECORD'] as const;
export const EntityAliasClaimKindSchema = z.enum(ENTITY_ALIAS_CLAIM_KINDS);
export type EntityAliasClaimKind = z.infer<typeof EntityAliasClaimKindSchema>;

/**
 * `entity_alias_claims` — append-only authority for whether an exact identifier
 * is current. The alias row's descriptive `source_id` never substitutes for a
 * claim: source assertions cite an exact immutable source-record revision.
 */
export const EntityAliasClaimSchema = z.object({
  id: EntityAliasClaimIdSchema,
  entity_alias_id: EntityAliasIdSchema,
  /** Exact source/editorial spelling asserted by this immutable claim. */
  asserted_alias_value: z.string().min(1).max(500),
  /** Exact normalized identifier the assertion is bound to. */
  asserted_normalized_value: z.string().min(1).max(500),
  /** Identity confidence asserted with this claim, not the mutable display-row maximum. */
  identity_confidence: IdentityConfidenceSchema,
  claim_kind: EntityAliasClaimKindSchema,
  /** Source attribution selected with this claim; source-record claims derive it from the record. */
  source_id: SourceIdSchema.nullable(),
  source_record_id: SourceRecordIdSchema.nullable(),
  /** Global alias lifecycle generation; pre-retirement claims never cross a reopen boundary. */
  authority_epoch: z.number().int().nonnegative(),
  locator_type: LocatorTypeSchema.nullable(),
  locator_value: z.string().max(2000).nullable(),
  /** Assertion snapshot; `entity_aliases.valid_to` is the global retirement/reopen gate. */
  valid_to: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
}).superRefine((claim, context) => {
  if (claim.claim_kind === 'CURATED') {
    if (claim.source_record_id !== null || claim.locator_type !== null || claim.locator_value !== null) {
      context.addIssue({
        code: 'custom',
        message: 'A curated alias claim cannot cite a source record or locator.',
      });
    }
    return;
  }
  if (
    claim.source_record_id === null ||
    claim.source_id === null ||
    claim.locator_type === null ||
    claim.locator_value === null ||
    claim.valid_to !== null
  ) {
    context.addIssue({
      code: 'custom',
      message: 'A source alias claim requires a source record and locator and cannot carry valid_to.',
    });
  }
});
export type EntityAliasClaim = z.infer<typeof EntityAliasClaimSchema>;

export const ENTITY_REDIRECT_REASONS = ['MERGE', 'SPLIT', 'RENAME', 'RETIRE'] as const;
export const EntityRedirectReasonSchema = z.enum(ENTITY_REDIRECT_REASONS);
export type EntityRedirectReason = z.infer<typeof EntityRedirectReasonSchema>;

/**
 * `entity_redirects` — keeps IDs and URLs stable across merge/split/rename.
 *
 * Merges are reversible (AGENTS.md rule 3), so a redirect carries the judgment
 * that caused it and can be withdrawn by writing a compensating row rather than
 * by deleting history.
 */
export const EntityRedirectSchema = z.object({
  id: EntityRedirectIdSchema,
  vertical_id: VerticalIdSchema,
  from_entity_id: EntityIdSchema,
  to_entity_id: EntityIdSchema,
  /** Old public slug, when the URL changed as well as the id. */
  from_slug: SlugSchema.nullable(),
  reason: EntityRedirectReasonSchema,
  judgment_id: ResolutionJudgmentIdSchema.nullable(),
  active: z.boolean(),
  created_at: IsoDateTimeSchema,
});
export type EntityRedirect = z.infer<typeof EntityRedirectSchema>;

export const EntityRedirectInsertSchema = EntityRedirectSchema.omit({
  id: true,
  created_at: true,
});
export type EntityRedirectInsert = z.infer<typeof EntityRedirectInsertSchema>;
