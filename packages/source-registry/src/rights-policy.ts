import { z } from 'zod';
import {
  AttributionRequirementSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MediaDisplayModeSchema,
  RightsClassificationSchema,
} from '@data-foundry/canonical-schema';

/**
 * The doc 13 source policy record, in full.
 *
 * Every field here exists because someone will eventually have to answer a
 * lawyer's question about a published row. "We didn't record that" is not an
 * available answer, which is why almost nothing is optional — a `null`
 * `terms_url` is an explicit statement that no terms page exists, not an
 * omission.
 */
export const SourceRightsPolicySchema = z.object({
  /** Legal entity that publishes the source, not the marketing brand. */
  publisher_legal_entity: z.string().min(1).max(300),
  terms_url: z.url().nullable(),
  /** SPDX identifier where one applies (`CC-BY-4.0`, `ODbL-1.0`). */
  license_id: z.string().max(120).nullable(),
  /** Pointer to the stored licence text/screenshot when there is no SPDX id. */
  license_text_ref: z.string().max(500).nullable(),
  api_terms_url: z.url().nullable(),

  commercial_use_allowed: z.boolean(),
  redistribution_allowed: z.boolean(),
  derivative_normalization_allowed: z.boolean(),
  attribution: AttributionRequirementSchema,
  images_reusable: z.boolean(),
  personal_data_present: z.boolean(),

  geographic_notes: z.string().max(4000),

  reviewed_at: IsoDateTimeSchema.nullable(),
  /** Named human reviewer. A model is not a reviewer. */
  reviewed_by: z.string().min(1).max(200).nullable(),
  next_review_at: IsoDateSchema.nullable(),
});
export type SourceRightsPolicy = z.infer<typeof SourceRightsPolicySchema>;

/**
 * Code licence and data licence are independent (doc 13). An MIT-licensed
 * scraper that ships a proprietary dataset is a normal situation, and
 * conflating the two is how the dataset ends up republished by accident.
 */
export const CodeVsDataLicenseSchema = z.object({
  code_license_id: z.string().max(120).nullable(),
  data_license_id: z.string().max(120).nullable(),
  notes: z.string().max(2000),
});
export type CodeVsDataLicense = z.infer<typeof CodeVsDataLicenseSchema>;

export const ACQUISITION_METHODS = [
  'DIRECT_HTTP',
  'BROWSER_RUN',
  'CRAWL4AI',
  'VENDOR_API',
  'SITEMAP',
  'BULK_FILE',
  'RSS',
  'MANUAL_UPLOAD',
] as const;
export const AcquisitionMethodSchema = z.enum(ACQUISITION_METHODS);
export type AcquisitionMethod = z.infer<typeof AcquisitionMethodSchema>;

/**
 * How we are allowed to obtain this source. The method is a policy decision,
 * not an implementation detail: "we could render it headlessly" is not the same
 * as "we are permitted to render it headlessly".
 */
export const AcquisitionPolicySchema = z.object({
  method: AcquisitionMethodSchema,
  /** Signed off by a human as compatible with the source's terms. */
  approved: z.boolean(),
  approved_by: z.string().max(200).nullable(),
  approved_at: IsoDateTimeSchema.nullable(),
  max_requests_per_minute: z.number().int().min(1).max(10_000).nullable(),
  notes: z.string().max(2000),
});
export type AcquisitionPolicy = z.infer<typeof AcquisitionPolicySchema>;

/**
 * Image policy (AGENTS.md rule 9). Defaults are restrictive: no caching, no
 * display modes, until someone decides otherwise.
 */
export const SourceImagePolicySchema = z.object({
  images_reusable: z.boolean(),
  /** Copying bytes into R2 is republication and needs its own decision. */
  cache_to_r2_permitted: z.boolean(),
  default_display_modes: z.array(MediaDisplayModeSchema),
  image_attribution: AttributionRequirementSchema,
});
export type SourceImagePolicy = z.infer<typeof SourceImagePolicySchema>;

/**
 * Provenance retention (AGENTS.md rule 10). Discarding artifacts that back a
 * published fact makes the fact unexplainable and unreprocessable.
 */
export const ProvenanceRetentionPolicySchema = z.object({
  retain_artifacts: z.boolean(),
  /** `null` means retain indefinitely. */
  retention_days: z.number().int().min(1).nullable(),
  /** Suspends deletion entirely, regardless of `retention_days`. */
  legal_hold: z.boolean(),
});
export type ProvenanceRetentionPolicy = z.infer<typeof ProvenanceRetentionPolicySchema>;

/** True when a rights review exists and has not lapsed as of `asOf`. */
export function rightsReviewIsCurrent(policy: SourceRightsPolicy, asOf: string): boolean {
  if (policy.reviewed_at === null || policy.reviewed_by === null) return false;
  if (policy.next_review_at === null) return true;
  return Date.parse(asOf) < Date.parse(`${policy.next_review_at}T23:59:59Z`);
}

export { RightsClassificationSchema };
