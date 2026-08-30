import { authorizeAll } from './resolver.js';
import type {
  ContributionRightsEvaluation,
  RightsChannel,
  RightsEvaluationOptions,
  RightsEvaluationRequest,
  RightsOperation,
  RightsSnapshot,
} from './types.js';

/**
 * Customer/distribution surfaces. These names are entitlements, not presentation
 * labels: a grant for one never authorizes a neighboring surface.
 */
export const RIGHTS_SURFACES = [
  'PUBLIC_WEB',
  'SEARCH_INDEX',
  'API_FREE',
  'API_PAID',
  'RAPIDAPI',
  'MCP',
  'BULK_EXPORT',
  'PARTNER_DELIVERY',
  'MODEL_TRAINING',
  'MODEL_EVALUATION',
] as const;
export type RightsSurface = (typeof RIGHTS_SURFACES)[number];

export interface SurfaceRightsRequirement {
  readonly id: string;
  readonly operation: RightsOperation;
  readonly channel: RightsChannel;
}

const requirement = (
  id: string,
  operation: RightsOperation,
  channel: RightsChannel,
): SurfaceRightsRequirement => Object.freeze({ id, operation, channel });

/**
 * The AND-bundle for each surface. Keep this explicit: collapsing these into a
 * hierarchy would recreate the all-or-nothing rights model ADR-0010 replaces.
 */
const SURFACE_REQUIREMENTS = Object.freeze({
  PUBLIC_WEB: Object.freeze([
    requirement('public-display', 'DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE'),
  ]),
  SEARCH_INDEX: Object.freeze([
    requirement('search-display', 'DISPLAY_PUBLICLY', 'SEARCH_INDEX'),
  ]),
  API_FREE: Object.freeze([
    requirement('api-service', 'SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API'),
  ]),
  API_PAID: Object.freeze([
    requirement('api-service', 'SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API'),
    requirement('api-sale', 'SELL_API_ACCESS', 'DIRECT_CUSTOMER_API'),
    requirement('api-redistribution', 'REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API'),
  ]),
  RAPIDAPI: Object.freeze([
    requirement('marketplace-service', 'SERVE_API_ACCESS', 'RAPIDAPI_MARKETPLACE'),
    requirement('marketplace-sale', 'SELL_API_ACCESS', 'RAPIDAPI_MARKETPLACE'),
    requirement(
      'marketplace-redistribution',
      'REDISTRIBUTE_NORMALIZED',
      'RAPIDAPI_MARKETPLACE',
    ),
    requirement('marketplace-sublicense', 'SUBLICENSE_ACCESS', 'RAPIDAPI_MARKETPLACE'),
  ]),
  MCP: Object.freeze([
    requirement('agent-retrieval', 'LLM_RETRIEVAL', 'MCP_AGENT'),
  ]),
  BULK_EXPORT: Object.freeze([
    requirement('bulk-offer', 'OFFER_BULK_EXPORT', 'BULK_DOWNLOAD'),
    requirement('bulk-redistribution', 'REDISTRIBUTE_NORMALIZED', 'BULK_DOWNLOAD'),
  ]),
  PARTNER_DELIVERY: Object.freeze([
    requirement('partner-delivery', 'DELIVER_TO_PARTNERS', 'PARTNER_DELIVERY'),
    requirement('partner-sublicense', 'SUBLICENSE_ACCESS', 'PARTNER_DELIVERY'),
  ]),
  MODEL_TRAINING: Object.freeze([
    requirement('model-training', 'TRAIN_MODELS', 'MODEL_PIPELINE'),
  ]),
  MODEL_EVALUATION: Object.freeze([
    requirement('model-evaluation', 'EVALUATE_MODELS', 'MODEL_PIPELINE'),
  ]),
} satisfies Record<RightsSurface, readonly SurfaceRightsRequirement[]>);

export function rightsRequirementsForSurface(
  surface: RightsSurface,
): readonly SurfaceRightsRequirement[] {
  return SURFACE_REQUIREMENTS[surface];
}

export interface SurfaceRightsContribution {
  readonly contributionId: string;
  readonly request: Omit<RightsEvaluationRequest, 'operation' | 'channel'>;
  readonly snapshot: RightsSnapshot;
}

/**
 * Authorize every surface intent for every provenance contribution. The
 * Cartesian product is intentional: one permissive source or one permissive
 * operation cannot launder any blocked neighbor.
 */
export function authorizeSurface(
  surface: RightsSurface,
  contributions: readonly SurfaceRightsContribution[],
  options: RightsEvaluationOptions = {},
): ContributionRightsEvaluation {
  const expanded = contributions.flatMap((contribution) =>
    rightsRequirementsForSurface(surface).map((entry) => ({
      requirementId: `${surface}:${entry.id}`,
      contributionId: contribution.contributionId,
      request: {
        ...contribution.request,
        operation: entry.operation,
        channel: entry.channel,
      },
      snapshot: contribution.snapshot,
    })),
  );
  return authorizeAll(expanded, options);
}
