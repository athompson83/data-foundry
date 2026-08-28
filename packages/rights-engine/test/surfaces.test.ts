import { describe, expect, it } from 'vitest';
import type {
  RightsDecisionCandidate,
  RightsEvaluationRequest,
  RightsOperation,
  RightsChannel,
  RightsSnapshot,
} from '../src/types.js';
import {
  authorizeSurface,
  rightsRequirementsForSurface,
  type RightsSurface,
} from '../src/surfaces.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHER_ID = '22222222-2222-4222-8222-222222222222';
const AS_OF = '2026-08-28T12:00:00.000Z';

const baseRequest = (): Omit<RightsEvaluationRequest, 'operation' | 'channel'> => ({
  source: {
    id: SOURCE_ID,
    publisherId: PUBLISHER_ID,
    status: 'ACTIVE',
    rightsClassification: 'GREEN',
    killSwitchEngaged: false,
    prohibited: false,
  },
  sourceStatusRequirement: 'ACTIVE',
  acquisitionRoute: 'DIRECT_HTTP',
  accountOrProductPlan: null,
  jurisdiction: null,
  assetClass: 'DATA',
  fieldKey: 'seer2',
  fieldGroupIds: [],
  outputClass: 'NORMALIZED_FACT',
  asOf: AS_OF,
  conditionReceipts: [],
});

function candidate(
  operation: RightsOperation,
  channel: RightsChannel,
  suffix: string,
): RightsDecisionCandidate {
  const cellId = `cell-${suffix}`;
  const decisionId = `decision-${suffix}`;
  const termsCellId = `terms-cell-${suffix}`;
  const termsVersionId = `terms-version-${suffix}`;
  return {
    cell: {
      id: cellId,
      publisherId: null,
      sourceId: SOURCE_ID,
      acquisitionRoute: null,
      accountOrProductPlan: null,
      jurisdiction: null,
      assetClass: 'DATA',
      fieldKey: null,
      fieldGroupId: null,
      outputClass: 'NORMALIZED_FACT',
      operation,
      channel,
    },
    decision: {
      id: decisionId,
      cellId,
      state: 'ALLOW',
      controllingTermsVersionId: termsVersionId,
      evidenceArtifactId: `evidence-${suffix}`,
      clauseRef: `clause-${suffix}`,
      reviewStatus: 'APPROVED',
      reviewerType: 'HUMAN',
      reviewedBy: 'Rights reviewer',
      reviewedAt: '2026-08-01T00:00:00.000Z',
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      effectiveUntil: null,
      recheckAt: '2027-08-01T00:00:00.000Z',
    },
    terms: {
      version: {
        id: termsVersionId,
        termsCellId,
        evidenceArtifactId: `terms-evidence-${suffix}`,
        contentSha256: 'a'.repeat(64),
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        effectiveUntil: null,
        recheckAt: '2027-08-01T00:00:00.000Z',
      },
      scope: {
        publisherId: null,
        sourceId: SOURCE_ID,
        acquisitionRoute: null,
        accountOrProductPlan: null,
        jurisdiction: null,
      },
      currentVersionId: termsVersionId,
      activationState: 'ACTIVE',
      activationActorType: 'HUMAN',
      activationOccurredAt: '2026-08-01T00:00:00.000Z',
    },
    conditions: [],
    activation: {
      decisionId,
      cellId,
      sequenceNo: 1,
      actorType: 'HUMAN',
      actor: 'Rights reviewer',
      occurredAt: '2026-08-01T00:00:00.000Z',
    },
  };
}

const snapshot = (...candidates: RightsDecisionCandidate[]): RightsSnapshot => ({
  candidates,
  denyExceptions: [],
  sourcePublisherIds: new Map([[SOURCE_ID, PUBLISHER_ID]]),
  fieldGroupMembers: new Map(),
});

const input = (rights: RightsSnapshot, contributionId = 'fact-evidence-1') => ({
  contributionId,
  request: baseRequest(),
  snapshot: rights,
});

describe('surface rights bundles', () => {
  it('keeps every commercial and distribution surface independently named', () => {
    const expected: Record<RightsSurface, readonly string[]> = {
      PUBLIC_WEB: ['DISPLAY_PUBLICLY/PUBLIC_WEBSITE'],
      SEARCH_INDEX: ['DISPLAY_PUBLICLY/SEARCH_INDEX'],
      API_FREE: ['SERVE_API_ACCESS/DIRECT_CUSTOMER_API'],
      API_PAID: [
        'SERVE_API_ACCESS/DIRECT_CUSTOMER_API',
        'SELL_API_ACCESS/DIRECT_CUSTOMER_API',
        'REDISTRIBUTE_NORMALIZED/DIRECT_CUSTOMER_API',
      ],
      RAPIDAPI: [
        'SERVE_API_ACCESS/RAPIDAPI_MARKETPLACE',
        'SELL_API_ACCESS/RAPIDAPI_MARKETPLACE',
        'REDISTRIBUTE_NORMALIZED/RAPIDAPI_MARKETPLACE',
        'SUBLICENSE_ACCESS/RAPIDAPI_MARKETPLACE',
      ],
      MCP: ['LLM_RETRIEVAL/MCP_AGENT'],
      BULK_EXPORT: [
        'OFFER_BULK_EXPORT/BULK_DOWNLOAD',
        'REDISTRIBUTE_NORMALIZED/BULK_DOWNLOAD',
      ],
      PARTNER_DELIVERY: [
        'DELIVER_TO_PARTNERS/PARTNER_DELIVERY',
        'SUBLICENSE_ACCESS/PARTNER_DELIVERY',
      ],
      MODEL_TRAINING: ['TRAIN_MODELS/MODEL_PIPELINE'],
      MODEL_EVALUATION: ['EVALUATE_MODELS/MODEL_PIPELINE'],
    };

    for (const [surface, pairs] of Object.entries(expected) as [RightsSurface, string[]][]) {
      expect(
        rightsRequirementsForSurface(surface).map(
          (requirement) => `${requirement.operation}/${requirement.channel}`,
        ),
      ).toEqual(pairs);
    }
  });

  it('does not let a public-web grant imply free API, paid API, MCP, bulk, or training', () => {
    const rights = snapshot(candidate('DISPLAY_PUBLICLY', 'PUBLIC_WEBSITE', 'web'));
    expect(authorizeSurface('PUBLIC_WEB', [input(rights)]).permitted).toBe(true);
    for (const surface of ['API_FREE', 'API_PAID', 'MCP', 'BULK_EXPORT', 'MODEL_TRAINING'] as const) {
      expect(authorizeSurface(surface, [input(rights)]).permitted, surface).toBe(false);
    }
  });

  it('requires every paid-API intent rather than treating API service as permission to sell', () => {
    const rights = snapshot(
      candidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-serve'),
      candidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-sell'),
    );
    const result = authorizeSurface('API_PAID', [input(rights)]);
    expect(result.permitted).toBe(false);
    expect(result.decisions.map((entry) => [entry.operation, entry.decision.reasonCode])).toContainEqual([
      'REDISTRIBUTE_NORMALIZED',
      'NO_GRANT',
    ]);
  });

  it('does not let direct paid-API grants authorize RapidAPI', () => {
    const rights = snapshot(
      candidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-serve'),
      candidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-sell'),
      candidate('REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API', 'api-redist'),
    );
    expect(authorizeSurface('API_PAID', [input(rights)]).permitted).toBe(true);
    expect(authorizeSurface('RAPIDAPI', [input(rights)]).permitted).toBe(false);
  });

  it('requires an explicit RapidAPI sublicense grant', () => {
    const rights = snapshot(
      candidate('SERVE_API_ACCESS', 'RAPIDAPI_MARKETPLACE', 'rapid-serve'),
      candidate('SELL_API_ACCESS', 'RAPIDAPI_MARKETPLACE', 'rapid-sell'),
      candidate('REDISTRIBUTE_NORMALIZED', 'RAPIDAPI_MARKETPLACE', 'rapid-redist'),
    );
    expect(authorizeSurface('RAPIDAPI', [input(rights)]).permitted).toBe(false);
  });

  it('ANDs every required intent across every provenance contribution', () => {
    const complete = snapshot(
      candidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-serve'),
      candidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'api-sell'),
      candidate('REDISTRIBUTE_NORMALIZED', 'DIRECT_CUSTOMER_API', 'api-redist'),
    );
    const missingRedistribution = snapshot(
      candidate('SERVE_API_ACCESS', 'DIRECT_CUSTOMER_API', 'other-serve'),
      candidate('SELL_API_ACCESS', 'DIRECT_CUSTOMER_API', 'other-sell'),
    );
    const result = authorizeSurface('API_PAID', [
      input(complete, 'evidence-a'),
      input(missingRedistribution, 'evidence-b'),
    ]);
    expect(result.permitted).toBe(false);
    expect(result.decisions).toHaveLength(6);
    expect(
      result.decisions.find(
        (entry) =>
          entry.contributionId === 'evidence-b' &&
          entry.operation === 'REDISTRIBUTE_NORMALIZED',
      )?.decision.reasonCode,
    ).toBe('NO_GRANT');
  });

  it('fails closed when provenance is empty', () => {
    expect(authorizeSurface('PUBLIC_WEB', []).reasonCode).toBe('MISSING_PROVENANCE');
  });
});
