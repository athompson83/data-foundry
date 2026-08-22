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
 *
 * TWO GUARDS, NOT ONE. `told()` below reduces each fact to what a customer is
 * told, and that reduction maps an ABSENT field to the same value as a falsy
 * one: no `editoriallyCorrected` reads as `false`, no `unresolvedConflict`
 * reads as `false`, no `editorialCorrectionReason` reads as `null`, no
 * `selectionWarnings` reads as `[]`. So a comparison of `Told` objects alone
 * cannot tell "both surfaces say false" apart from "one surface stopped saying
 * it", and a mutation that deletes a field passes whenever the real value
 * happens to be falsy. Hence:
 *
 *   1. KEY PRESENCE is asserted on the RAW payloads, before any reduction, so a
 *      dropped field fails whatever its value would have been; and
 *   2. the FIXTURE carries a true value for every one of the four trust fields,
 *      so a mutation that hard-codes the falsy value fails too.
 *
 * Neither guard is sufficient alone. Both are verified by mutation — see the
 * fixture notes on `CONTESTED_PROPERTY` and `CORRECTED_PROPERTY`.
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

/**
 * The same desk, and a property it has corrected CLEANLY.
 *
 * `CONTESTED_PROPERTY` cannot also carry the correction: two rival values
 * behind one override is what produces `AMBIGUOUS_EDITORIAL_INTENT`, and that
 * warning fires INSTEAD of a correction — `editorially_corrected` stays false
 * and the reason stays null. So the two trust states need two properties. Here
 * a single PROPOSED editorial value stands behind a single override
 * declaration, which is a well-formed correction: the desk's value publishes,
 * `editoriallyCorrected` is true, the public reason travels with it, and the
 * source-selected rivals it displaced are retained, which is what makes
 * `unresolvedConflict` true.
 *
 * Without this, three of the four trust fields were `false`/`null` on every
 * fact in the fixture, and a mutation deleting them from one surface passed.
 */
const CORRECTED_PROPERTY = 'seer2_rating';
const CORRECTED_VALUE = 16.5;
const CORRECTION_REASON =
  'SEER2 corrected to the AHRI-certified rating for the as-shipped coil pairing.';

/** In the policy on purpose: it must not reach either surface. */
const REVIEWER = 'j.okafor@example.com';

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

  // ONE editorial value, so the override has a single thing to stand behind and
  // the selection is a correction rather than an ambiguity. PROPOSED for the
  // same reason as above: an ACTIVE claim would supersede the manufacturer's
  // and leave nothing for the correction to have displaced.
  await claim(base, 'editorial', {
    property: CORRECTED_PROPERTY,
    value: CORRECTED_VALUE,
    value_type: 'number',
    status: 'PROPOSED',
    entity_id: base.equipment.id,
    valid_from: '2026-02-01T00:00:00Z',
  });

  const policy = {
    at: AT,
    editorialOverrides: [
      {
        source: EDITORIAL_SOURCE,
        reason: 'Refrigerant corrected to the charge shipped from January 2026.',
        reviewer: REVIEWER,
        properties: [CONTESTED_PROPERTY],
      },
      {
        source: EDITORIAL_SOURCE,
        reason: CORRECTION_REASON,
        reviewer: REVIEWER,
        properties: [CORRECTED_PROPERTY],
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

/**
 * The four fields whose ABSENCE `told()` cannot distinguish from a falsy value.
 * Asserted present on the raw payload of every fact, on both surfaces.
 */
const TRUST_KEYS = [
  'editoriallyCorrected',
  'editorialCorrectionReason',
  'selectionWarnings',
  'unresolvedConflict',
] as const;

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

/** The REST payload, unreduced. Key presence is only observable here. */
async function restRaw(): Promise<readonly Record<string, unknown>[]> {
  const response: ApiResponse = await fixtures.app({
    method: 'GET',
    // A limit above the fact count, so pagination cannot be mistaken for a
    // rights decision — a truncated page and a withheld fact look identical.
    url: `/v1/entities/${fixtures.equipment.id}/facts?limit=100&at=${encodeURIComponent(AT)}`,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const body = response.body as { data: readonly Record<string, unknown>[]; meta?: unknown };
  return body.data;
}

/** The MCP payload, unreduced. */
async function mcpRaw(): Promise<readonly Record<string, unknown>[]> {
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
  return envelope.result?.facts ?? [];
}

async function restFacts(): Promise<Told[]> {
  return byProperty((await restRaw()).map(told));
}

async function mcpFacts(): Promise<Told[]> {
  return byProperty((await mcpRaw()).map(told));
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

  it('carries a TRUE value for every trust field, so a falsy hard-code cannot pass', async () => {
    // The other half of the vacuity fix. `told()` maps an absent field onto the
    // falsy value, so a surface that hard-codes `editoriallyCorrected: false`
    // or `unresolvedConflict: false` matches a fixture where those are false
    // everywhere. Each assertion below names the fact that makes its field bite.
    const rest = await restFacts();
    const corrected = rest.find((fact) => fact.property === CORRECTED_PROPERTY);
    expect(corrected, `${CORRECTED_PROPERTY} is missing, so the correction guards are vacuous`)
      .toBeDefined();
    expect(corrected?.editoriallyCorrected, 'no editorially corrected fact in the fixture').toBe(
      true,
    );
    expect(corrected?.editorialCorrectionReason).toBe(CORRECTION_REASON);
    expect(
      rest.some((fact) => fact.unresolvedConflict),
      'no fact carries an unresolved conflict, so that comparison is vacuous',
    ).toBe(true);
    expect(
      rest.flatMap((fact) => fact.selectionWarnings),
      'the fixture produced no selection warnings, so that comparison is vacuous',
    ).toContain('AMBIGUOUS_EDITORIAL_INTENT');
  });

  it('carries every trust key on every fact, present rather than merely falsy', async () => {
    // Asserted on the RAW payloads. `told()` cannot see the difference between
    // a field that is absent and a field that is false, so a mutation deleting
    // `editoriallyCorrected` from one surface is invisible to the equality
    // check below on any fact whose real value is false. This sees it.
    const [rest, mcp] = await Promise.all([restRaw(), mcpRaw()]);
    for (const [surface, rows] of [
      ['REST', rest],
      ['MCP', mcp],
    ] as const) {
      expect(rows.length, `${surface} returned no facts`).toBeGreaterThan(0);
      for (const row of rows) {
        for (const key of TRUST_KEYS) {
          expect(
            Object.hasOwn(row, key),
            `${surface} dropped "${key}" from ${String(row['property'])}`,
          ).toBe(true);
        }
      }
    }
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
