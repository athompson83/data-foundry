/**
 * REST and MCP must not tell a customer different things.
 *
 * AGENTS.md rule 5 says web, API and MCP read from one canonical query layer,
 * and its testing requirements name "API/MCP parity" outright. Neither surface
 * can prove that on its own: each one's suite only sees its own answers, so
 * both can be internally consistent and still disagree with each other. That is
 * the failure this file exists to catch, and it is the reason it lives in the
 * repository-root `tests/` tree rather than in either app.
 *
 * The comparison is deliberately about CONTENT, not field names. Two surfaces
 * are allowed to shape a response differently — one paginates, the other
 * returns a sheet with a trust summary. What they may not do is publish a
 * different value, a different correction state, a different set of selection
 * warnings, or a different answer to "may this be published at all".
 *
 * Both are built over the SAME `QueryModel` instance and the SAME selection
 * policy. Any divergence is therefore the surfaces', not the data's.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createApiApp, type ApiHandler, type ApiResponse } from '../../apps/api/src/index.js';
import { createMcpServer, type McpServer } from '../../apps/mcp/src/index.js';
import {
  claim,
  createQueryFixtures,
  ts,
  type QueryFixtures,
} from '../../packages/query-model/test/support.js';

/** One instant, so neither surface can differ merely by reading at a different time. */
const AT = ts('2026-07-01T00:00:00Z');

/**
 * A claim whose only evidence comes from an UNREVIEWED source. It is a real
 * row with real evidence and fails on rights alone (rule 1), which is the case
 * that separates a rights gate from a data gap.
 */
const BLOCKED_PROPERTY = 'forum_rumor';

/**
 * The editorial desk, and a property it has contradicted itself about.
 *
 * A parity test over an empty trust surface proves nothing: if every fact
 * carries no warnings and no correction, one surface can drop those fields
 * entirely and still match. So the fixture manufactures a non-empty one —
 * two rival PROPOSED values behind a single override declaration, which
 * `fact-selection` reports as `AMBIGUOUS_EDITORIAL_INTENT` rather than
 * inventing an editorial decision nobody made.
 */
const EDITORIAL_SOURCE = 'editorial.internal';
const CONTESTED_PROPERTY = 'refrigerant';

interface Surfaces extends QueryFixtures {
  readonly app: ApiHandler;
  readonly server: McpServer;
}

let fixtures: Surfaces;

beforeAll(async () => {
  const base = await createQueryFixtures();

  await claim(base, 'blocked', {
    property: BLOCKED_PROPERTY,
    value: 'sounds-like-40-decibels',
    entity_id: base.equipment.id,
  });

  // Two rival values from the desk the override names. PROPOSED, not ACTIVE:
  // a second ACTIVE claim would supersede the standing one and leave a single
  // candidate, and one candidate is not a contradiction.
  for (const value of ['R-32', 'R-454B']) {
    await claim(base, 'editorial', {
      property: CONTESTED_PROPERTY,
      value,
      status: 'PROPOSED',
      entity_id: base.equipment.id,
      valid_from: '2026-02-01T00:00:00Z',
    });
  }

  const policy = {
    at: AT,
    editorialOverrides: [
      {
        source: EDITORIAL_SOURCE,
        reason: 'Refrigerant corrected to the charge shipped from January 2026.',
        // Present in the policy on purpose: it must not reach either surface.
        reviewer: 'j.okafor@example.com',
        properties: [CONTESTED_PROPERTY],
      },
    ],
  } as const;

  const app = createApiApp({
    queryModel: base.qm,
    verticalId: base.vertical.id,
    factSelection: policy,
  });
  const server = createMcpServer({
    queryModel: base.qm,
    vertical: { id: base.vertical.id, slug: 'hvac' },
    policy,
  });

  fixtures = { ...base, app, server };
}, 120_000);

/** The trust surface, reduced to what a customer would actually be told. */
interface Told {
  readonly property: string;
  readonly value: unknown;
  readonly editoriallyCorrected: boolean;
  readonly editorialCorrectionReason: string | null;
  readonly selectionWarnings: readonly string[];
  readonly unresolvedConflict: boolean;
}

const told = (fact: Record<string, unknown>): Told => ({
  property: String(fact['property']),
  value: fact['value'],
  editoriallyCorrected: Boolean(fact['editoriallyCorrected']),
  editorialCorrectionReason: (fact['editorialCorrectionReason'] ?? null) as string | null,
  selectionWarnings: [...((fact['selectionWarnings'] ?? []) as readonly string[])].sort(),
  unresolvedConflict: Boolean(fact['unresolvedConflict']),
});

const byProperty = (rows: readonly Told[]): Told[] =>
  [...rows].sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));

async function restFacts(): Promise<Told[]> {
  const response: ApiResponse = await fixtures.app({
    method: 'GET',
    // A limit above the fact count, so pagination cannot be mistaken for a
    // rights decision — a truncated page and a withheld fact look identical.
    url: `/v1/entities/${fixtures.equipment.id}/facts?limit=100&at=${encodeURIComponent(AT)}`,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const body = response.body as { data: readonly Record<string, unknown>[]; meta?: unknown };
  return byProperty(body.data.map(told));
}

async function mcpFacts(): Promise<Told[]> {
  const call = await fixtures.server.callTool('list_facts', {
    entity_id: fixtures.equipment.id,
    as_of: AT,
  });
  expect(call.isError, JSON.stringify(call.structuredContent)).toBe(false);
  // Tool results are enveloped: `{ ok: true, result }` or `{ ok: false, error }`.
  const envelope = call.structuredContent as {
    ok: boolean;
    result?: { facts: readonly Record<string, unknown>[] };
  };
  expect(envelope.ok, JSON.stringify(call.structuredContent)).toBe(true);
  return byProperty((envelope.result?.facts ?? []).map(told));
}

describe('REST and MCP publish the same facts', () => {
  it('reads something at all, so agreement cannot be two empty lists', async () => {
    const rest = await restFacts();
    expect(rest.length, 'no published facts — this file would prove nothing').toBeGreaterThan(0);
  });

  it('has a non-empty trust surface, so matching cannot mean matching nothing', async () => {
    // Without this, both surfaces can drop `selectionWarnings` and still agree.
    // Verified by mutation: dropping them from one surface passes against a
    // fixture with none, and fails against this one.
    const rest = await restFacts();
    const warnings = rest.flatMap((fact) => fact.selectionWarnings);
    expect(
      warnings,
      'the fixture produced no selection warnings, so the comparison below is vacuous',
    ).toContain('AMBIGUOUS_EDITORIAL_INTENT');
  });

  it('publishes the same properties', async () => {
    const [rest, mcp] = await Promise.all([restFacts(), mcpFacts()]);
    expect(mcp.map((f) => f.property)).toEqual(rest.map((f) => f.property));
  });

  it('publishes the same value and the same trust surface for every one', async () => {
    const [rest, mcp] = await Promise.all([restFacts(), mcpFacts()]);
    // Whole-object equality, not field-by-field: a field added to one surface's
    // projection and not the other is exactly the drift being guarded against,
    // and a per-field loop would silently skip it.
    expect(mcp).toEqual(rest);
  });

  it('withholds the rights-blocked claim from both, not merely from one', async () => {
    const [rest, mcp] = await Promise.all([restFacts(), mcpFacts()]);
    const published = (rows: readonly Told[]): boolean =>
      rows.some((fact) => fact.property === BLOCKED_PROPERTY);

    expect(published(rest), 'REST published a claim backed only by an UNREVIEWED source').toBe(
      false,
    );
    expect(published(mcp), 'MCP published a claim backed only by an UNREVIEWED source').toBe(false);
  });

  it('leaks the reviewer through neither surface', async () => {
    // Each app proves this for itself with a removal proof. This asserts it at
    // the seam: the SAME policy carries the reviewer into BOTH, so a leak that
    // only appears when the two are configured identically still fails here.
    const [restBody, mcpCall] = await Promise.all([
      fixtures.app({
        method: 'GET',
        url: `/v1/entities/${fixtures.equipment.id}/facts?limit=100&at=${encodeURIComponent(AT)}`,
      }),
      fixtures.server.callTool('list_facts', { entity_id: fixtures.equipment.id, as_of: AT }),
    ]);
    for (const [surface, payload] of [
      ['REST', restBody.body],
      ['MCP', mcpCall.structuredContent],
    ] as const) {
      expect(JSON.stringify(payload), `${surface} published the reviewer`).not.toContain(
        'j.okafor',
      );
    }
  });

  it('would notice if one surface stopped applying the rights gate', async () => {
    // The guard above passes trivially if the claim never existed. Prove it is
    // in the database and merely withheld, by reading it through the query
    // layer's ungated path — the one both surfaces deliberately do not use.
    const stored = await fixtures.qm.facts({ entity_id: fixtures.equipment.id });
    expect(
      stored.some((row) => row.fact.property === BLOCKED_PROPERTY),
      'the blocked claim is missing from the store, so withholding proves nothing',
    ).toBe(true);
  });
});
