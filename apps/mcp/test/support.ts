/**
 * MCP fixtures, layered on the query layer's own PGlite + real-migrations
 * harness.
 *
 * Nothing here mocks the query model. The whole claim this app makes is that it
 * reads through the canonical query layer and inherits its gates, and a stubbed
 * query layer would let every one of those gates pass vacuously. So the tests
 * boot a real Postgres (PGlite), apply the real `db/migrations`, and drive the
 * dispatcher against the same fixtures `packages/query-model` uses.
 *
 * Three things are added on top of those fixtures, each because a guarantee
 * needs a state to be true about:
 *
 *   * `sound_level_db`, claimed ONLY by the UNREVIEWED source — so "a RED or
 *     UNREVIEWED source must not have its facts surfaced" (rule 1) has
 *     something to suppress;
 *   * an editorial override on `refrigerant` whose declared reason is clean but
 *     whose REVIEWER is a named person — so the reviewer-identity guarantee has
 *     an identity to leak;
 *   * a two-hop relationship chain — so traversal depth is observable.
 */
import {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  relate,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { createMcpServer, type McpServer } from '../src/index.js';
import type { FactSelectionPolicy } from '../src/query-layer.js';

export {
  addSyntheticEntityEvidence,
  claim,
  createQueryFixtures,
  relate,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';

/** Fixed read instant, so `asOf` and every selection are deterministic. */
export const AT = ts('2026-07-01T00:00:00Z');

/** The editorial desk fixture's domain, which the override is scoped to. */
export const EDITORIAL_SOURCE = 'editorial.internal';

/**
 * A real person's name, in the shape a real policy would carry it. The whole
 * point is that this string exists in the selection policy and must not exist
 * in any tool result.
 */
export const REVIEWER = 'j.okafor@example.com';

/** Customer-visible, and deliberately says nothing about who wrote it. */
export const CORRECTION_REASON =
  'Refrigerant corrected to the charge shipped from January 2026; the catalogue sheet still ' +
  'listed the pre-transition blend.';

/** The same correction, written the way that must be refused. */
export const POISONED_REASON = `Corrected by ${REVIEWER} after a supplier call.`;

export function policyWithOverride(reason: string): FactSelectionPolicy {
  return {
    at: AT,
    editorialOverrides: [
      {
        source: EDITORIAL_SOURCE,
        reason,
        reviewer: REVIEWER,
        properties: ['refrigerant'],
      },
    ],
  };
}

export interface McpFixtures extends QueryFixtures {
  /** Server with the well-behaved editorial override applied. */
  readonly server: McpServer;
  /** Server with no editorial override at all. */
  readonly plainServer: McpServer;
  readonly policy: FactSelectionPolicy;
}

export async function createMcpFixtures(): Promise<McpFixtures> {
  const base = await createQueryFixtures();
  await seedSyntheticSurfaceRights(base, ['MCP']);
  for (const entity of [base.equipment, base.heatPump, base.motor, base.rival]) {
    await addSyntheticEntityEvidence(base, entity);
  }

  // Rule 1: a claim whose only backing source is UNREVIEWED. It is a real fact
  // row with real evidence — it fails on rights alone, which is the case that
  // matters.
  await claim(base, 'blocked', {
    property: 'sound_level_db',
    value: 99,
    value_type: 'number',
    unit: 'dB',
    entity_id: base.equipment.id,
    valid_from: '2026-02-01T00:00:00Z',
  });

  // The editorial desk's rival claim. The override below only decides between
  // claims that already exist; it cannot conjure a value no source asserted.
  //
  // PROPOSED, not ACTIVE, and for a structural reason: appending a second
  // ACTIVE claim about the same property supersedes the standing one, leaving a
  // single eligible candidate — and with one candidate there is no rival for an
  // editorial override to overrule, so the selection never reaches the override
  // at all. A retained rival claim is exactly the state ADR-0002 describes.
  await claim(base, 'editorial', {
    property: 'refrigerant',
    value: 'R-32',
    status: 'PROPOSED',
    entity_id: base.equipment.id,
    valid_from: '2026-02-01T00:00:00Z',
  });

  await relate(base, base.equipment, 'replaced_by', base.heatPump);
  await relate(base, base.heatPump, 'uses_part', base.motor);

  const policy = policyWithOverride(CORRECTION_REASON);

  const vertical = { id: base.vertical.id, slug: 'hvac' } as const;
  const server = createMcpServer({
    queryModel: base.qm,
    vertical,
    policy,
    canonicalUrlBase: 'https://example.test/hvac',
  });
  const plainServer = createMcpServer({
    queryModel: base.qm,
    vertical,
    policy: { at: AT },
  });

  return { ...base, server, plainServer, policy };
}

/** Unwrap a successful call, failing loudly with the error if it was not. */
export function resultOf<T>(call: {
  readonly isError: boolean;
  readonly structuredContent: unknown;
}): T {
  const structured = call.structuredContent as
    | { ok: true; result: T }
    | { ok: false; error: { code: string; message: string } };
  if (!structured.ok) {
    throw new Error(`expected success, got ${structured.error.code}: ${structured.error.message}`);
  }
  return structured.result;
}

/** Unwrap a failed call the same way. */
export function errorOf(call: { readonly structuredContent: unknown }): {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
} {
  const structured = call.structuredContent as
    | { ok: true }
    | {
        ok: false;
        error: {
          code: string;
          message: string;
          details: Record<string, unknown>;
          retryable: boolean;
        };
      };
  if (structured.ok) throw new Error('expected a failure result, got a success');
  return structured.error;
}
