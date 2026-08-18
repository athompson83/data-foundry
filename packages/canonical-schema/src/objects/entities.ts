import { z } from 'zod';
import { EntityQualityScoreSchema, IdentityConfidenceSchema } from '../confidence.js';
import {
  EntityAliasIdSchema,
  EntityIdSchema,
  EntityRedirectIdSchema,
  ResolutionJudgmentIdSchema,
  SourceIdSchema,
  VerticalIdSchema,
} from '../ids.js';
import { IdentifierSchema, IsoDateTimeSchema, SlugSchema } from '../primitives.js';

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
  /** Which source asserted the alias; null for editorially added aliases. */
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
