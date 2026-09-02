import { describe, expect, it } from 'vitest';
import {
  evaluateContributionRights,
  evaluateRights,
  scopeIsStrictlyNarrower,
  type RightsCell,
  type RightsDecisionCandidate,
  type RightsEvaluationRequest,
  type RightsSnapshot,
} from '../src/index.js';

const NOW = '2026-08-28T12:00:00.000Z';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const PUBLISHER = '11111111-1111-4111-8111-111111111111';

const request = (
  overrides: Partial<RightsEvaluationRequest> = {},
): RightsEvaluationRequest => ({
  source: {
    id: SOURCE,
    publisherId: PUBLISHER,
    status: 'ACTIVE',
    rightsClassification: 'GREEN',
    killSwitchEngaged: false,
    prohibited: false,
  },
  sourceStatusRequirement: 'ACTIVE',
  acquisitionRoute: 'VENDOR_API',
  accountOrProductPlan: 'commercial',
  jurisdiction: 'US',
  assetClass: 'DATA',
  fieldKey: 'seer2_rating',
  fieldGroupIds: ['efficiency'],
  outputClass: 'NORMALIZED_FACT',
  operation: 'DISPLAY_PUBLICLY',
  channel: 'PUBLIC_WEBSITE',
  asOf: NOW,
  conditionReceipts: [],
  ...overrides,
});

const cell = (overrides: Partial<RightsCell> = {}): RightsCell => ({
  id: 'cell-base',
  publisherId: null,
  sourceId: SOURCE,
  acquisitionRoute: null,
  accountOrProductPlan: null,
  jurisdiction: null,
  assetClass: null,
  fieldKey: null,
  fieldGroupId: null,
  outputClass: null,
  operation: 'DISPLAY_PUBLICLY',
  channel: 'PUBLIC_WEBSITE',
  ...overrides,
});

type BoundCandidate = Omit<RightsDecisionCandidate, 'terms'> & {
  readonly terms: NonNullable<RightsDecisionCandidate['terms']>;
};

const candidate = (
  id: string,
  state: RightsDecisionCandidate['decision']['state'],
  cellOverrides: Partial<RightsCell> = {},
  decisionOverrides: Partial<RightsDecisionCandidate['decision']> = {},
): BoundCandidate => {
  const boundCell = cell({ id: `cell-${id}`, ...cellOverrides });
  return {
  cell: boundCell,
  decision: {
    id,
    cellId: `cell-${id}`,
    state,
    controllingTermsVersionId: `terms-${id}`,
    evidenceArtifactId: `evidence-${id}`,
    clauseRef: 'section 1',
    reviewStatus: 'APPROVED',
    reviewerType: 'HUMAN',
    reviewedBy: 'rights-owner',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    effectiveFrom: '2026-08-01T00:00:00.000Z',
    effectiveUntil: null,
    recheckAt: '2027-08-01T00:00:00.000Z',
    ...decisionOverrides,
  },
  terms: {
    version: {
      id: `terms-${id}`,
      termsCellId: `terms-cell-${id}`,
      evidenceArtifactId: `terms-evidence-${id}`,
      contentSha256: 'a'.repeat(64),
      effectiveFrom: '2026-08-01T00:00:00.000Z',
      effectiveUntil: null,
      recheckAt: '2027-08-01T00:00:00.000Z',
    },
    scope: {
      publisherId: boundCell.publisherId,
      sourceId: boundCell.sourceId,
      acquisitionRoute: boundCell.acquisitionRoute,
      accountOrProductPlan: boundCell.accountOrProductPlan,
      jurisdiction: boundCell.jurisdiction,
    },
    currentVersionId: `terms-${id}`,
    activationState: 'ACTIVE',
    activationActorType: 'HUMAN',
    activationOccurredAt: '2026-08-01T00:00:00.000Z',
  },
  conditions: [],
  activation: {
    decisionId: id,
    cellId: `cell-${id}`,
    sequenceNo: 1,
    actorType: 'HUMAN',
    actor: 'rights-owner',
    occurredAt: '2026-08-01T00:00:00.000Z',
  },
  };
};

const snapshot = (
  candidates: readonly RightsDecisionCandidate[],
  exceptions: RightsSnapshot['denyExceptions'] = [],
): RightsSnapshot => ({ candidates, denyExceptions: exceptions });

describe('fail-closed resolution', () => {
  it('refuses absence as UNKNOWN', () => {
    const result = evaluateRights(request(), snapshot([]));
    expect(result).toMatchObject({ permitted: false, state: 'UNKNOWN', reasonCode: 'NO_GRANT' });
    expect(result.decisionId).toBeNull();
  });

  it('distinguishes an explicit UNKNOWN assessment from absence', () => {
    expect(evaluateRights(request(), snapshot([candidate('unknown', 'UNKNOWN')]))).toMatchObject({
      permitted: false,
      state: 'UNKNOWN',
      reasonCode: 'EXPLICIT_UNKNOWN',
      decisionId: 'unknown',
    });
  });

  it('refuses a malformed snapshot instead of trusting TypeScript casts', () => {
    const malformed = candidate('malformed', 'ALLOW');
    const result = evaluateRights(
      request(),
      snapshot([
        {
          ...malformed,
          cell: { ...malformed.cell, publisherId: PUBLISHER, sourceId: SOURCE },
        },
      ]),
    );
    expect(result).toMatchObject({ permitted: false, reasonCode: 'MALFORMED_SNAPSHOT' });
  });

  it.each([
    ['UNREVIEWED', 'RIGHTS_CLASSIFICATION_BLOCKED'],
    ['RED', 'RIGHTS_CLASSIFICATION_BLOCKED'],
  ] as const)('blocks the coarse %s hard stop before grant resolution', (rightsClassification, reasonCode) => {
    const result = evaluateRights(
      request({ source: { ...request().source, rightsClassification } }),
      snapshot([candidate('allow', 'ALLOW')]),
    );
    expect(result).toMatchObject({ permitted: false, reasonCode });
  });

  it('blocks prohibited, killed, inactive, and unmapped sources', () => {
    const allow = snapshot([candidate('allow', 'ALLOW')]);
    expect(
      evaluateRights(request({ source: { ...request().source, prohibited: true } }), allow).reasonCode,
    ).toBe('SOURCE_PROHIBITED');
    expect(
      evaluateRights(request({ source: { ...request().source, killSwitchEngaged: true } }), allow)
        .reasonCode,
    ).toBe('KILL_SWITCH_ENGAGED');
    expect(
      evaluateRights(request({ source: { ...request().source, status: 'PAUSED' } }), allow).reasonCode,
    ).toBe('SOURCE_STATUS_BLOCKED');
    expect(
      evaluateRights(
        request({ source: { ...request().source, publisherId: null } }),
        allow,
      ).reasonCode,
    ).toBe('PUBLISHER_UNMAPPED');
  });
});

describe('independent intent axes', () => {
  const publicAllow = candidate('public', 'ALLOW', {
    acquisitionRoute: 'VENDOR_API',
    assetClass: 'DATA',
    outputClass: 'NORMALIZED_FACT',
  });

  it.each([
    [{ channel: 'DIRECT_CUSTOMER_API' as const }, 'channel'],
    [{ channel: 'RAPIDAPI_MARKETPLACE' as const }, 'RapidAPI channel'],
    [{ channel: 'MCP_AGENT' as const }, 'MCP channel'],
    [{ channel: 'BULK_DOWNLOAD' as const }, 'bulk channel'],
    [{ channel: 'MODEL_PIPELINE' as const }, 'model channel'],
    [{ operation: 'SELL_API_ACCESS' as const }, 'paid API operation'],
    [{ operation: 'SUBLICENSE_ACCESS' as const }, 'sublicense operation'],
    [{ operation: 'TRAIN_MODELS' as const }, 'training operation'],
    [{ outputClass: 'RAW_RECORD' as const }, 'raw output class'],
    [{ assetClass: 'IMAGE' as const }, 'image asset class'],
    [{ acquisitionRoute: 'BULK_FILE' as const }, 'acquisition route'],
  ])('a public-web allow does not imply the neighboring %s', (overrides, _label) => {
    const result = evaluateRights(request(overrides), snapshot([publicAllow]));
    expect(result).toMatchObject({ permitted: false, state: 'UNKNOWN', reasonCode: 'NO_GRANT' });
  });
});

describe('sticky DENY and explicit exceptions', () => {
  const deny = candidate('publisher-deny', 'DENY', {
    publisherId: PUBLISHER,
    sourceId: null,
  });
  const narrowAllow = candidate('source-allow', 'ALLOW', { fieldKey: 'seer2_rating' });

  it('does not let an ordinary narrower ALLOW override a publisher DENY', () => {
    const result = evaluateRights(request(), snapshot([deny, narrowAllow]));
    expect(result).toMatchObject({ permitted: false, state: 'DENY', reasonCode: 'STICKY_DENY' });
    expect(result.blockingDecisionIds).toEqual(['publisher-deny']);
  });

  it('permits only an independently evidenced, effective, exact-deny, strict-narrow exception', () => {
    const result = evaluateRights(
      request(),
      snapshot([deny, narrowAllow], [
        {
          id: 'exception-link',
          denyDecisionId: 'publisher-deny',
          exceptionDecisionId: 'source-allow',
          evidenceArtifactId: 'independent-exception-evidence',
          clauseRef: 'exception clause 2',
          reviewerType: 'COUNSEL',
          reviewedBy: 'rights-counsel',
          reviewedAt: '2026-08-02T00:00:00.000Z',
          effectiveFrom: '2026-08-02T00:00:00.000Z',
          effectiveUntil: null,
          recheckAt: '2027-08-02T00:00:00.000Z',
        },
      ]),
    );
    expect(result).toMatchObject({ permitted: true, state: 'ALLOW', reasonCode: 'ALLOW' });
    expect(result.exceptionIds).toEqual(['exception-link']);
  });

  it('leaves a second matching DENY sticky when only one is excepted', () => {
    const secondDeny = candidate('route-deny', 'DENY', { acquisitionRoute: 'VENDOR_API' });
    const result = evaluateRights(
      request(),
      snapshot([deny, secondDeny, narrowAllow], [
        {
          id: 'exception-link',
          denyDecisionId: 'publisher-deny',
          exceptionDecisionId: 'source-allow',
          evidenceArtifactId: 'independent-exception-evidence',
          clauseRef: 'exception clause 2',
          reviewerType: 'COUNSEL',
          reviewedBy: 'rights-counsel',
          reviewedAt: '2026-08-02T00:00:00.000Z',
          effectiveFrom: '2026-08-02T00:00:00.000Z',
          effectiveUntil: null,
          recheckAt: '2027-08-02T00:00:00.000Z',
        },
      ]),
    );
    expect(result).toMatchObject({ permitted: false, state: 'DENY' });
    expect(result.blockingDecisionIds).toEqual(['route-deny']);
  });

  it('rejects equal, broader, and cross-operation exception relationships', () => {
    expect(scopeIsStrictlyNarrower(deny.cell, deny.cell, new Map())).toBe(false);
    expect(scopeIsStrictlyNarrower(narrowAllow.cell, deny.cell, new Map())).toBe(false);
    expect(
      scopeIsStrictlyNarrower(
        deny.cell,
        { ...narrowAllow.cell, operation: 'SELL_API_ACCESS' },
        new Map(),
      ),
    ).toBe(false);
  });
});

describe('specificity, immutable terms binding, and review status', () => {
  it('uses the documented lexicographic precedence, not a count of populated dimensions', () => {
    const exactField = candidate('field', 'ALLOW', { fieldKey: 'seer2_rating' });
    const manyLowerAxes = candidate('lower', 'NOT_APPLICABLE', {
      outputClass: 'NORMALIZED_FACT',
      assetClass: 'DATA',
      acquisitionRoute: 'VENDOR_API',
      accountOrProductPlan: 'commercial',
      jurisdiction: 'US',
    });
    expect(evaluateRights(request(), snapshot([manyLowerAxes, exactField]))).toMatchObject({
      permitted: true,
      decisionId: 'field',
    });
  });

  it('fails closed on an equal-specificity ambiguity instead of choosing by id', () => {
    const left = candidate('left', 'ALLOW', { fieldKey: 'seer2_rating' });
    const right = candidate('right', 'ALLOW', { fieldKey: 'seer2_rating' });
    expect(evaluateRights(request(), snapshot([left, right]))).toMatchObject({
      permitted: false,
      reasonCode: 'AMBIGUOUS_SCOPE',
    });
  });

  it.each([
    [
      (entry: BoundCandidate): BoundCandidate => ({
        ...entry,
        terms: { ...entry.terms, currentVersionId: 'different-version' },
      }),
      'TERMS_NOT_CURRENT',
    ],
    [
      (entry: BoundCandidate): BoundCandidate => ({
        ...entry,
        terms: { ...entry.terms, activationState: 'REVOKED' as const },
      }),
      'TERMS_REVOKED',
    ],
    [
      (entry: BoundCandidate): BoundCandidate => ({
        ...entry,
        decision: { ...entry.decision, recheckAt: '2026-08-01T00:00:00.000Z' },
      }),
      'REVIEW_DUE',
    ],
    [
      (entry: BoundCandidate): BoundCandidate => ({
        ...entry,
        decision: { ...entry.decision, reviewerType: 'AUTOMATED' as const },
      }),
      'AUTOMATED_PERMISSION',
    ],
  ])('does not fall back to a broader allow when the specific decision fails %s', (mutate, reasonCode) => {
    const broad = candidate('broad', 'ALLOW');
    const specific = mutate(candidate('specific', 'ALLOW', { fieldKey: 'seer2_rating' }));
    expect(evaluateRights(request(), snapshot([broad, specific]))).toMatchObject({
      permitted: false,
      decisionId: 'specific',
      reasonCode,
    });
  });

  it('refuses a rejected specific ALLOW without falling back to a broader ALLOW', () => {
    const broad = candidate('broad', 'ALLOW');
    const rejected = candidate('rejected', 'ALLOW', { fieldKey: 'seer2_rating' }, {
      reviewStatus: 'REJECTED',
    });

    expect(evaluateRights(request(), snapshot([broad, rejected]))).toMatchObject({
      permitted: false,
      decisionId: 'rejected',
      reasonCode: 'PERMISSION_REVIEW_INVALID',
    });
  });

  it('refuses an expired specific ALLOW without falling back to a broader ALLOW', () => {
    const broad = candidate('broad', 'ALLOW');
    const expired = candidate('expired', 'ALLOW', { fieldKey: 'seer2_rating' }, {
      effectiveUntil: '2026-08-28T11:59:59.999Z',
    });

    expect(evaluateRights(request(), snapshot([broad, expired]))).toMatchObject({
      permitted: false,
      decisionId: 'expired',
      reasonCode: 'DECISION_NOT_EFFECTIVE',
    });
  });

  it('refuses a not-yet-effective specific ALLOW without falling back to a broader ALLOW', () => {
    const broad = candidate('broad', 'ALLOW');
    const pending = candidate('pending', 'ALLOW', { fieldKey: 'seer2_rating' }, {
      effectiveFrom: '2026-08-28T12:00:00.001Z',
    });

    expect(evaluateRights(request(), snapshot([broad, pending]))).toMatchObject({
      permitted: false,
      decisionId: 'pending',
      reasonCode: 'DECISION_NOT_EFFECTIVE',
    });
  });

  it('keeps an active DENY sticky even when its old terms are stale', () => {
    const staleDeny = {
      ...candidate('deny', 'DENY'),
      terms: { ...candidate('deny', 'DENY').terms, currentVersionId: 'new-terms' },
    };
    expect(evaluateRights(request(), snapshot([staleDeny, candidate('allow', 'ALLOW')]))).toMatchObject({
      permitted: false,
      reasonCode: 'STICKY_DENY',
    });
  });

  it('requires current human activation independently of human review', () => {
    const automated = candidate('automated-activation', 'ALLOW');
    expect(
      evaluateRights(
        request(),
        snapshot([
          {
            ...automated,
            activation: { ...automated.activation, actorType: 'AUTOMATED' },
          },
        ]),
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'ACTIVATION_INVALID' });
  });

  it('blocks when the independently reviewed controlling terms are due', () => {
    const due = candidate('terms-due', 'ALLOW');
    expect(
      evaluateRights(
        request(),
        snapshot([
          {
            ...due,
            terms: {
              ...due.terms,
              version: { ...due.terms.version, recheckAt: '2026-08-28T12:00:00.000Z' },
            },
          },
        ]),
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'REVIEW_DUE' });
  });

  it('refuses a decision after its controlling terms scope no longer covers the cell', () => {
    const remapped = candidate('remapped', 'ALLOW');
    expect(
      evaluateRights(
        request(),
        snapshot([
          {
            ...remapped,
            terms: {
              ...remapped.terms,
              scope: {
                ...remapped.terms.scope,
                sourceId: '99999999-9999-4999-8999-999999999999',
              },
            },
          },
        ]),
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'TERMS_SCOPE_MISMATCH' });
  });
});

describe('conditions and multi-provenance', () => {
  it('requires a trusted evaluator, a satisfied receipt, and an audit reference', () => {
    const conditional: RightsDecisionCandidate = {
      ...candidate('conditional', 'CONDITIONAL'),
      conditions: [
        {
          id: 'condition-attribution',
          decisionId: 'conditional',
          conditionKey: 'attribution',
          conditionType: 'ATTRIBUTION',
          evaluatorKey: 'attribution_present',
          evaluatorVersion: '1',
          parametersSha256: 'b'.repeat(64),
          parametersCanonical: '{"text": "Source credit"}',
          parameters: { text: 'Source credit' },
          auditRequired: true,
        },
      ],
    };

    expect(evaluateRights(request(), snapshot([conditional]))).toMatchObject({
      permitted: false,
      reasonCode: 'UNKNOWN_CONDITION_EVALUATOR',
    });
    expect(
      evaluateRights(request(), snapshot([conditional]), {
        trustedConditionEvaluators: ['attribution_present'],
      }),
    ).toMatchObject({ permitted: false, reasonCode: 'CONDITION_UNMET' });
    expect(
      evaluateRights(
        request({
          conditionReceipts: [
            {
              conditionId: 'condition-attribution',
              evaluatorKey: 'attribution_present',
              evaluatorVersion: '1',
              parametersSha256: 'b'.repeat(64),
              parametersCanonical: '{"text": "Source credit"}',
              satisfied: true,
              auditRef: null,
              evaluatedAt: '2026-08-28T11:00:00.000Z',
              validUntil: '2026-08-29T00:00:00.000Z',
            },
          ],
        }),
        snapshot([conditional]),
        { trustedConditionEvaluators: ['attribution_present'] },
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'CONDITION_AUDIT_MISSING' });
    expect(
      evaluateRights(
        request({
          conditionReceipts: [
            {
              conditionId: 'condition-attribution',
              evaluatorKey: 'attribution_present',
              evaluatorVersion: '1',
              parametersSha256: 'b'.repeat(64),
              parametersCanonical: '{"text": "Source credit"}',
              satisfied: true,
              auditRef: 'rendered:credit-block',
              evaluatedAt: '2026-08-28T11:00:00.000Z',
              validUntil: '2026-08-29T00:00:00.000Z',
            },
          ],
        }),
        snapshot([conditional]),
        { trustedConditionEvaluators: ['attribution_present'] },
      ),
    ).toMatchObject({ permitted: true, state: 'CONDITIONAL', reasonCode: 'CONDITIONAL_ALLOW' });

    expect(
      evaluateRights(
        request({
          conditionReceipts: [
            {
              conditionId: 'condition-attribution',
              evaluatorKey: 'attribution_present',
              evaluatorVersion: '1',
              parametersSha256: 'c'.repeat(64),
              parametersCanonical: '{"text": "Source credit"}',
              satisfied: true,
              auditRef: 'rendered:credit-block',
              evaluatedAt: '2026-08-28T11:00:00.000Z',
              validUntil: '2026-08-29T00:00:00.000Z',
            },
          ],
        }),
        snapshot([conditional]),
        { trustedConditionEvaluators: ['attribution_present'] },
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'CONDITION_RECEIPT_INVALID' });

    expect(
      evaluateRights(
        request({
          conditionReceipts: [
            {
              conditionId: 'condition-attribution',
              evaluatorKey: 'attribution_present',
              evaluatorVersion: '1',
              parametersSha256: 'b'.repeat(64),
              parametersCanonical: '{"text": "Different credit"}',
              satisfied: true,
              auditRef: 'rendered:credit-block',
              evaluatedAt: '2026-08-28T11:00:00.000Z',
              validUntil: '2026-08-29T00:00:00.000Z',
            },
          ],
        }),
        snapshot([conditional]),
        { trustedConditionEvaluators: ['attribution_present'] },
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'CONDITION_RECEIPT_INVALID' });

    expect(
      evaluateRights(
        request({
          conditionReceipts: [
            {
              conditionId: 'condition-attribution',
              evaluatorKey: 'attribution_present',
              evaluatorVersion: '1',
              parametersSha256: 'b'.repeat(64),
              parametersCanonical: '{"text": "Source credit"}',
              satisfied: true,
              auditRef: 'rendered:credit-block',
              evaluatedAt: '2026-08-27T11:00:00.000Z',
              validUntil: '2026-08-28T12:00:00.000Z',
            },
          ],
        }),
        snapshot([conditional]),
        { trustedConditionEvaluators: ['attribution_present'] },
      ),
    ).toMatchObject({ permitted: false, reasonCode: 'CONDITION_RECEIPT_STALE' });
  });

  it('blocks the whole output when any provenance contribution is unauthorized', () => {
    const allowed = {
      requirementId: 'public-fact',
      contributionId: 'source-a',
      request: request(),
      snapshot: snapshot([candidate('allow', 'ALLOW')]),
    };
    const blocked = {
      requirementId: 'public-fact',
      contributionId: 'source-b',
      request: request({
        source: {
          ...request().source,
          id: '33333333-3333-4333-8333-333333333333',
          publisherId: '44444444-4444-4444-8444-444444444444',
        },
      }),
      snapshot: snapshot([]),
    };
    const result = evaluateContributionRights([allowed, blocked]);
    expect(result.permitted).toBe(false);
    expect(result.decisions.map((entry) => entry.decision.permitted)).toEqual([true, false]);
  });

  it('refuses an empty contribution set as missing provenance', () => {
    expect(evaluateContributionRights([])).toEqual({
      permitted: false,
      reasonCode: 'MISSING_PROVENANCE',
      decisions: [],
    });
  });

  it('requires every RapidAPI operation as a separate requirement', () => {
    const rapidApiRequest = request({
      channel: 'RAPIDAPI_MARKETPLACE',
      operation: 'SERVE_API_ACCESS',
    });
    const serve = candidate('rapid-serve', 'ALLOW', {
      channel: 'RAPIDAPI_MARKETPLACE',
      operation: 'SERVE_API_ACCESS',
    });
    const result = evaluateContributionRights([
      {
        requirementId: 'rapidapi:serve',
        contributionId: SOURCE,
        request: rapidApiRequest,
        snapshot: snapshot([serve]),
      },
      {
        requirementId: 'rapidapi:sell',
        contributionId: SOURCE,
        request: { ...rapidApiRequest, operation: 'SELL_API_ACCESS' },
        snapshot: snapshot([serve]),
      },
      {
        requirementId: 'rapidapi:sublicense',
        contributionId: SOURCE,
        request: { ...rapidApiRequest, operation: 'SUBLICENSE_ACCESS' },
        snapshot: snapshot([serve]),
      },
    ]);
    expect(result.permitted).toBe(false);
    expect(result.decisions.map((entry) => entry.decision.reasonCode)).toEqual([
      'ALLOW',
      'NO_GRANT',
      'NO_GRANT',
    ]);
  });
});
