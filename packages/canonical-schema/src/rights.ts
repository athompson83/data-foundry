import { z } from 'zod';

/**
 * Rights classification — the deployment gate behind AGENTS.md rule 1
 * ("No source without rights metadata. Unreviewed/RED sources must not
 * publish.").
 *
 * `AMBER` is doc 13's `YELLOW`: facts are probably usable but terms, database
 * rights, image rights, attribution or redistribution scope still need legal or
 * business review. `UNREVIEWED` is the default for anything that has not been
 * classified at all, and it is deliberately *not* publishable — the absence of
 * a decision is not permission.
 */
export const RIGHTS_CLASSIFICATIONS = ['GREEN', 'AMBER', 'RED', 'UNREVIEWED'] as const;
export const RightsClassificationSchema = z.enum(RIGHTS_CLASSIFICATIONS);
export type RightsClassification = z.infer<typeof RightsClassificationSchema>;

/** Classifications that may reach a published surface (web/API/MCP/exports). */
export const PUBLISHABLE_RIGHTS_CLASSIFICATIONS = ['GREEN', 'AMBER'] as const satisfies
  readonly RightsClassification[];

/** Classifications that block publication outright. */
export const BLOCKED_RIGHTS_CLASSIFICATIONS = ['RED', 'UNREVIEWED'] as const satisfies
  readonly RightsClassification[];

/**
 * The rule-1 predicate. Returns `false` for `RED` and `UNREVIEWED`, always.
 *
 * Callers must treat a missing/unknown classification as `UNREVIEWED` rather
 * than defaulting to permissive.
 */
export function canPublish(rights: RightsClassification): boolean {
  switch (rights) {
    case 'GREEN':
    case 'AMBER':
      return true;
    case 'RED':
    case 'UNREVIEWED':
      return false;
  }
}

/**
 * `AMBER` may publish, but it may not publish *silently*. Anything AMBER needs
 * an attached legal/business review record before it is treated as settled.
 */
export function requiresLegalReview(rights: RightsClassification): boolean {
  return rights === 'AMBER';
}

export type PublishDecision =
  | { readonly allowed: true; readonly rights: RightsClassification; readonly requiresReview: boolean }
  | { readonly allowed: false; readonly rights: RightsClassification; readonly reason: string };

/** `canPublish` with the reason attached, for admin surfaces and audit logs. */
export function publishDecision(rights: RightsClassification): PublishDecision {
  if (rights === 'RED') {
    return {
      allowed: false,
      rights,
      reason: 'RED: explicit restrictions or unresolved risk incompatible with redistribution.',
    };
  }
  if (rights === 'UNREVIEWED') {
    return {
      allowed: false,
      rights,
      reason: 'UNREVIEWED: no rights decision on record; absence of a decision is not permission.',
    };
  }
  return { allowed: true, rights, requiresReview: requiresLegalReview(rights) };
}

export class RightsViolationError extends Error {
  override readonly name = 'RightsViolationError';
  readonly rights: RightsClassification;

  constructor(rights: RightsClassification, subject: string, reason: string) {
    super(`Refusing to publish ${subject}: ${reason}`);
    this.rights = rights;
  }
}

/** Throwing form of {@link canPublish} for use at write/publish boundaries. */
export function assertCanPublish(
  rights: RightsClassification,
  subject = 'this record',
): asserts rights is 'GREEN' | 'AMBER' {
  const decision = publishDecision(rights);
  if (!decision.allowed) {
    throw new RightsViolationError(rights, subject, decision.reason);
  }
}

/**
 * Doc 13 writes the middle tier as `YELLOW`; the code model uses `AMBER`.
 * Normalise anything unknown to `UNREVIEWED` rather than throwing, so a typo in
 * a source registry file fails closed instead of crashing ingestion.
 */
export function normalizeRightsClassification(value: string | null | undefined): RightsClassification {
  const upper = (value ?? '').trim().toUpperCase();
  if (upper === 'YELLOW') return 'AMBER';
  const parsed = RightsClassificationSchema.safeParse(upper);
  return parsed.success ? parsed.data : 'UNREVIEWED';
}

/**
 * Attribution obligations attached to a source or media asset. `required: true`
 * with an empty `text` is a misconfiguration, not "no attribution needed".
 */
export const AttributionRequirementSchema = z.object({
  required: z.boolean(),
  /** Exact credit line to render. Required when `required` is true. */
  text: z.string().min(1).nullable(),
  /** Link to credit, if the licence demands a backlink. */
  url: z.url().nullable(),
});
export type AttributionRequirement = z.infer<typeof AttributionRequirementSchema>;

export function attributionIsSatisfiable(attribution: AttributionRequirement): boolean {
  return !attribution.required || attribution.text !== null;
}

/** Closed acquisition routes shared by source policy and the rights matrix. */
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

export const RIGHTS_STATES = [
  'ALLOW',
  'DENY',
  'CONDITIONAL',
  'UNKNOWN',
  'NOT_APPLICABLE',
] as const;
export const RightsStateSchema = z.enum(RIGHTS_STATES);
export type RightsState = z.infer<typeof RightsStateSchema>;

export const RIGHTS_OPERATIONS = [
  'ACQUIRE',
  'STORE',
  'NORMALIZE',
  'DERIVE',
  'DISPLAY_PUBLICLY',
  'BUILD_COMPARISON_TOOLS',
  'QUOTE_OR_EXCERPT',
  'SERVE_API_ACCESS',
  'SELL_API_ACCESS',
  'REDISTRIBUTE_RAW',
  'REDISTRIBUTE_NORMALIZED',
  'OFFER_BULK_EXPORT',
  'SUBLICENSE_ACCESS',
  'LLM_RETRIEVAL',
  'DELIVER_TO_PARTNERS',
  'TRAIN_MODELS',
  'EVALUATE_MODELS',
  'CACHE',
  'RETAIN_AFTER_TERMINATION',
] as const;
export const RightsOperationSchema = z.enum(RIGHTS_OPERATIONS);
export type RightsOperation = z.infer<typeof RightsOperationSchema>;

export const RIGHTS_CHANNELS = [
  'INTERNAL_PROCESSING',
  'PUBLIC_WEBSITE',
  'SEARCH_INDEX',
  'DIRECT_CUSTOMER_API',
  'RAPIDAPI_MARKETPLACE',
  'MCP_AGENT',
  'BULK_DOWNLOAD',
  'PARTNER_DELIVERY',
  'MODEL_PIPELINE',
] as const;
export const RightsChannelSchema = z.enum(RIGHTS_CHANNELS);
export type RightsChannel = z.infer<typeof RightsChannelSchema>;

export const RIGHTS_OUTPUT_CLASSES = [
  'RAW_RECORD',
  'NORMALIZED_FACT',
  'DERIVED_METRIC',
  'METADATA',
  'IMAGE_OR_MEDIA',
  'PERSONAL_DATA',
] as const;
export const RightsOutputClassSchema = z.enum(RIGHTS_OUTPUT_CLASSES);
export type RightsOutputClass = z.infer<typeof RightsOutputClassSchema>;

export const RIGHTS_ASSET_CLASSES = [
  'DATA',
  'DOCUMENT',
  'IMAGE',
  'TRADEMARK',
  'PERSONAL_DATA',
] as const;
export const RightsAssetClassSchema = z.enum(RIGHTS_ASSET_CLASSES);
export type RightsAssetClass = z.infer<typeof RightsAssetClassSchema>;

export const RIGHTS_REVIEWER_TYPES = ['AUTOMATED', 'HUMAN', 'COUNSEL'] as const;
export const RightsReviewerTypeSchema = z.enum(RIGHTS_REVIEWER_TYPES);
export type RightsReviewerType = z.infer<typeof RightsReviewerTypeSchema>;

export const RIGHTS_REVIEW_STATUSES = ['ASSESSMENT', 'APPROVED', 'REJECTED'] as const;
export const RightsReviewStatusSchema = z.enum(RIGHTS_REVIEW_STATUSES);
export type RightsReviewStatus = z.infer<typeof RightsReviewStatusSchema>;

export const RIGHTS_TERMS_ACTIVATION_STATES = ['ACTIVE', 'REVOKED'] as const;
export const RightsTermsActivationStateSchema = z.enum(RIGHTS_TERMS_ACTIVATION_STATES);
export type RightsTermsActivationState = z.infer<typeof RightsTermsActivationStateSchema>;

export const RIGHTS_CONDITION_TYPES = [
  'ATTRIBUTION',
  'FRESHNESS',
  'VOLUME_CAP',
  'PURPOSE_LIMITATION',
  'JURISDICTION',
  'OTHER',
] as const;
export const RightsConditionTypeSchema = z.enum(RIGHTS_CONDITION_TYPES);
export type RightsConditionType = z.infer<typeof RightsConditionTypeSchema>;
