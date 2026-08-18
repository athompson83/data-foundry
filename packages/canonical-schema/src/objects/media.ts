import { z } from 'zod';
import { EntityIdSchema, MediaAssetIdSchema, SourceIdSchema, VerticalIdSchema } from '../ids.js';
import { ContentHashSchema, IsoDateTimeSchema, StorageUriSchema } from '../primitives.js';
import {
  AttributionRequirementSchema,
  RightsClassificationSchema,
  canPublish,
  type RightsClassification,
} from '../rights.js';

export const MEDIA_TYPES = [
  'PRODUCT_PHOTO',
  'DIAGRAM',
  'SCHEMATIC',
  'LABEL',
  'DRAWING',
  'MANUAL_COVER',
  'CHART',
  'LOGO',
  'OTHER',
] as const;
export const MediaTypeSchema = z.enum(MEDIA_TYPES);
export type MediaType = z.infer<typeof MediaTypeSchema>;

/**
 * What we are permitted to do with an image. `HOTLINK_ONLY` means display from
 * the origin without copying bytes into R2; `NONE` means evidence-only, never
 * shown to a user.
 */
export const MEDIA_DISPLAY_MODES = [
  'NONE',
  'HOTLINK_ONLY',
  'THUMBNAIL',
  'INLINE',
  'FULL',
  'DOWNLOAD',
] as const;
export const MediaDisplayModeSchema = z.enum(MEDIA_DISPLAY_MODES);
export type MediaDisplayMode = z.infer<typeof MediaDisplayModeSchema>;

export const MEDIA_ASSET_STATUSES = ['PENDING_REVIEW', 'APPROVED', 'BLOCKED', 'RETIRED'] as const;
export const MediaAssetStatusSchema = z.enum(MEDIA_ASSET_STATUSES);
export type MediaAssetStatus = z.infer<typeof MediaAssetStatusSchema>;

/**
 * `media_assets` — images are evidence and licensed assets, not decoration
 * (AGENTS.md rule 9). `r2_uri` stays null until a rights decision permits
 * caching; the default posture is "record the URL, copy nothing".
 */
export const MediaAssetSchema = z.object({
  id: MediaAssetIdSchema,
  vertical_id: VerticalIdSchema,
  entity_id: EntityIdSchema.nullable(),
  source_id: SourceIdSchema,
  source_url: z.url(),
  content_hash: ContentHashSchema.nullable(),
  media_type: MediaTypeSchema,
  rights_classification: RightsClassificationSchema,
  /** SPDX id or licence name where one exists. */
  license_id: z.string().max(120).nullable(),
  attribution: AttributionRequirementSchema,
  allowed_display_modes: z.array(MediaDisplayModeSchema),
  /** Populated only once caching is permitted. */
  r2_uri: StorageUriSchema.nullable(),
  width: z.number().int().min(1).nullable(),
  height: z.number().int().min(1).nullable(),
  alt_text: z.string().max(1000).nullable(),
  /** 0 = primary image for the entity; higher numbers rank lower. */
  primary_rank: z.number().int().min(0),
  status: MediaAssetStatusSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const MediaAssetInsertSchema = MediaAssetSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type MediaAssetInsert = z.infer<typeof MediaAssetInsertSchema>;

type MediaRightsView = {
  readonly rights_classification: RightsClassification;
  readonly allowed_display_modes: readonly MediaDisplayMode[];
  readonly status: MediaAssetStatus;
  readonly attribution: { readonly required: boolean; readonly text: string | null };
};

/** Rule 9, display side: never render an image we have not cleared for that mode. */
export function canDisplayMediaAsset(asset: MediaRightsView, mode: MediaDisplayMode): boolean {
  if (mode === 'NONE') return false;
  if (asset.status !== 'APPROVED') return false;
  if (!canPublish(asset.rights_classification)) return false;
  if (!asset.allowed_display_modes.includes(mode)) return false;
  return !asset.attribution.required || asset.attribution.text !== null;
}

/**
 * Rule 9, storage side: copying bytes into R2 is republication. Hotlink-only
 * assets must never be cached, regardless of how convenient it would be.
 */
export function canCacheMediaAsset(asset: MediaRightsView): boolean {
  if (asset.status !== 'APPROVED') return false;
  if (!canPublish(asset.rights_classification)) return false;
  if (asset.allowed_display_modes.includes('HOTLINK_ONLY')) return false;
  return asset.allowed_display_modes.some(
    (mode) => mode === 'THUMBNAIL' || mode === 'INLINE' || mode === 'FULL' || mode === 'DOWNLOAD',
  );
}
