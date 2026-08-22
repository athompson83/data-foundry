/**
 * The declared contract must be the one the dispatcher honours.
 *
 * This is the classic MCP defect: a tool advertises `limit` as at most 50, the
 * handler happily runs with 5000, and nothing says so until a caller trusts the
 * declaration. The declaration is the only thing a model has to reason with, so
 * a schema nothing enforces is worse than no schema — it is a promise.
 *
 * Four separate claims are proved here, because they fail independently:
 *
 *   1. IDENTITY — the published JSON Schema is generated from the very Zod
 *      object the dispatcher parses with. Not "consistent with"; generated
 *      from. There is no second artefact to drift.
 *   2. ENFORCEMENT — every constraint the published schema states is actually
 *      applied. This walks the published document and, for each declared
 *      bound, pattern, enum and type, sends a value that violates it and
 *      requires the dispatcher to refuse. It is driven by the schema rather
 *      than by a list, so a constraint added later is covered without anyone
 *      remembering to add a case.
 *   3. COMPLETENESS — every property the schema advertises is actually
 *      accepted, and the baselines below name every one of them. A schema that
 *      advertises an argument the validator strips is the same lie in the other
 *      direction.
 *   4. ERROR COMPLETENESS — no tool answers with a code it did not declare.
 *      `errorCodes` is the other half of the published contract and the only
 *      thing a client has to write its error handling against; a tool that can
 *      emit a code missing from that list has told the client the case cannot
 *      happen. Claim 1 already checks the list contains nothing invented. That
 *      is the easy direction, and it is why this file used to pass while
 *      `compare_entities` returned `REVIEWER_IDENTITY_BLOCKED` — a code its
 *      declaration did not mention — to anyone whose vertical had an override
 *      reason naming its reviewer.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AT,
  POISONED_REASON,
  createMcpFixtures,
  errorOf,
  policyWithOverride,
  type McpFixtures,
} from './support.js';
import {
  MCP_TOOL_ERROR_CODES,
  TOOLS,
  createMcpServer,
  publishInputSchema,
  type McpServer,
} from '../src/index.js';
import { ENTITY_ID_FIELD, IDENTIFIER_FIELD } from '../src/canonical-schemas.js';
import entitiesSchema from '../../../schemas/canonical/entities.schema.json' with { type: 'json' };
import factsSchema from '../../../schemas/canonical/facts.schema.json' with { type: 'json' };

let fixtures: McpFixtures;

beforeAll(async () => {
  fixtures = await createMcpFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

type Json = Record<string, unknown>;

/**
 * One valid call per tool, naming EVERY declared property. Anything the schema
 * advertises must appear here, and the first test fails if it does not.
 */
function baselines(): Readonly<Record<string, Json>> {
  return {
    search_entities: {
      query: '24ANB7',
      entity_type: 'equipment',
      filters: [{ property: 'seer2_rating', op: 'exists' }],
      include_retired: false,
      include_facets: false,
      limit: 5,
      offset: 0,
    },
    get_entity: {
      identifier: '24ANB7',
      entity_type: 'equipment',
      include_facts: true,
    },
    list_facts: {
      entity_id: fixtures.equipment.id,
      properties: ['tonnage'],
      as_of: AT,
    },
    compare_entities: {
      entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
      properties: ['tonnage'],
    },
    traverse_relationships: {
      entity_id: fixtures.equipment.id,
      predicate: 'replaced_by',
      direction: 'out',
      depth: 2,
      limit: 10,
    },
    explain_fact: {
      entity_id: fixtures.equipment.id,
      property: 'seer2_rating',
      as_of: AT,
    },
  };
}

describe('claim 1: the published schema is generated from the validator', () => {
  it('regenerates byte-identically from the tool’s own Zod object', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema, tool.name).toEqual(publishInputSchema(tool.input));
    }
  });

  it('is a self-describing, serializable JSON Schema document', () => {
    for (const tool of TOOLS) {
      expect(tool.inputSchema['$schema'], tool.name).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
      expect(tool.inputSchema['type'], tool.name).toBe('object');
      // Round-trips: a transport serializes this, so nothing exotic may hide in it.
      expect(JSON.parse(JSON.stringify(tool.inputSchema)), tool.name).toEqual(tool.inputSchema);
    }
  });

  it('derives its identifier constraints from the generated canonical exports', () => {
    // Not a retyped regex: the same pattern the canonical model publishes, so
    // `pnpm schemas:check` failing is the only way these can disagree.
    const entities = entitiesSchema as { properties: Record<string, Json> };
    const facts = factsSchema as { properties: Record<string, Json> };
    expect(ENTITY_ID_FIELD.pattern).toBe(entities.properties['id']?.['pattern']);
    expect(IDENTIFIER_FIELD.pattern).toBe(facts.properties['property']?.['pattern']);

    const listFacts = TOOLS.find((tool) => tool.name === 'list_facts');
    const entityId = (listFacts?.inputSchema['properties'] as Json)['entity_id'] as Json;
    expect(entityId['pattern']).toBe(entities.properties['id']?.['pattern']);
  });

  it('declares only error codes the error model knows', () => {
    for (const tool of TOOLS) {
      for (const code of tool.errors) {
        expect(MCP_TOOL_ERROR_CODES, tool.name).toContain(code);
      }
    }
  });
});

describe('claim 3: every advertised property is accepted', () => {
  it('has a baseline naming exactly the declared properties of every tool', () => {
    const base = baselines();
    for (const tool of TOOLS) {
      const declared = Object.keys(tool.inputSchema['properties'] as Json).sort();
      expect(Object.keys(base[tool.name] ?? {}).sort(), tool.name).toEqual(declared);
    }
  });

  it('accepts each baseline, so a later rejection is caused by the mutation', async () => {
    const base = baselines();
    for (const tool of TOOLS) {
      const call = await fixtures.server.callTool(tool.name, base[tool.name]);
      expect(call.isError, `${tool.name}: ${JSON.stringify(call.structuredContent)}`).toBe(false);
    }
  });

  it('rejects the whole call when one unadvertised property is added', async () => {
    const base = baselines();
    for (const tool of TOOLS) {
      const error = errorOf(
        await fixtures.server.callTool(tool.name, { ...base[tool.name], not_a_real_argument: 1 }),
      );
      expect(error.code, tool.name).toBe('INVALID_ARGUMENTS');
      expect(tool.inputSchema['additionalProperties'], tool.name).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Claim 2: every declared constraint is enforced
 * ------------------------------------------------------------------ */

interface Violation {
  readonly property: string;
  readonly value: unknown;
  readonly constraint: string;
}

const LONG = 'a'.repeat(2048);

/** Values that must fail, derived from what the published schema declares. */
function violationsFor(property: string, schema: Json): Violation[] {
  const found: Violation[] = [];
  const push = (value: unknown, constraint: string): void => {
    found.push({ property, value, constraint });
  };
  const type = schema['type'];

  if (Array.isArray(schema['enum'])) push('__definitely_not_a_member__', 'enum');

  if (type === 'string') {
    push(42, 'type: string');
    const pattern = schema['pattern'];
    if (typeof pattern === 'string') push('NOT A VALID VALUE!!', 'pattern');
    const maxLength = schema['maxLength'];
    if (typeof maxLength === 'number') push(LONG.slice(0, maxLength + 1), 'maxLength');
    const minLength = schema['minLength'];
    if (typeof minLength === 'number' && minLength > 0) push('', 'minLength');
  }

  if (type === 'integer' || type === 'number') {
    push('not a number', `type: ${String(type)}`);
    const maximum = schema['maximum'];
    if (typeof maximum === 'number') push(maximum + 1, 'maximum');
    const minimum = schema['minimum'];
    if (typeof minimum === 'number') push(minimum - 1, 'minimum');
    if (type === 'integer') push(1.5, 'integer');
  }

  if (type === 'boolean') push('yes', 'type: boolean');

  if (type === 'array') {
    push('not an array', 'type: array');
    const minItems = schema['minItems'];
    if (typeof minItems === 'number' && minItems > 0) push([], 'minItems');
    const items = schema['items'];
    if (items !== null && typeof items === 'object') {
      const itemPattern = (items as Json)['pattern'];
      if (typeof itemPattern === 'string') push(['NOT A VALID VALUE!!'], 'items.pattern');
      if ((items as Json)['type'] === 'object') push([{ nonsense: true }], 'items.shape');
    }
    const maxItems = schema['maxItems'];
    if (typeof maxItems === 'number') {
      push(Array.from({ length: maxItems + 1 }, () => 'x'), 'maxItems');
    }
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Claim 4: no tool answers with an undeclared code
 * ------------------------------------------------------------------ */

/** A well-formed id nothing in this catalogue holds. */
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const OTHER_UNKNOWN_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Argument values that provoke a failure, keyed by the property they replace.
 *
 * Keyed by property rather than by tool so that a tool added later is swept by
 * whatever its declared arguments happen to be, without anyone remembering to
 * extend a list. A property with no entry here contributes its baseline value.
 */
const PROVOCATIONS: Readonly<Record<string, unknown>> = {
  entity_id: UNKNOWN_ID,
  entity_ids: [UNKNOWN_ID, OTHER_UNKNOWN_ID],
  identifier: 'nothing-in-this-catalogue',
  property: 'warranty_years',
  properties: ['warranty_years'],
  filters: [{ property: 'blower_speed', op: 'exists' }],
  as_of: '1970-01-01T00:00:00.000Z',
};

describe('claim 4: no tool answers with a code it does not declare', () => {
  /**
   * Every failure these fixtures can provoke, on two servers: the ordinary one
   * and one whose editorial override reason names its own reviewer. The second
   * is not an exotic case — it is a vertical config with a badly worded reason,
   * and it is the state that made `compare_entities` refuse with a code it had
   * not published.
   */
  const observed = new Map<string, Set<string>>();

  it('holds for every tool, on every scenario these fixtures can provoke', async () => {
    const base = baselines();
    const poisoned: McpServer = createMcpServer({
      queryModel: fixtures.qm,
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      policy: policyWithOverride(POISONED_REASON),
    });

    for (const tool of TOOLS) {
      const codes = new Set<string>();
      const baseline = base[tool.name] as Json;
      const properties = Object.keys(tool.inputSchema['properties'] as Json);

      const scenarios: Json[] = [
        baseline,
        // Missing everything: whatever the schema requires is absent.
        {},
        ...properties
          .filter((property) => property in PROVOCATIONS)
          .map((property) => ({ ...baseline, [property]: PROVOCATIONS[property] })),
      ];

      for (const server of [fixtures.server, poisoned]) {
        for (const args of scenarios) {
          const call = await server.callTool(tool.name, args);
          if (!call.isError) continue;
          const code = errorOf(call).code;
          codes.add(code);
          expect(
            tool.errors,
            `${tool.name} answered ${code} for ${JSON.stringify(args)}, which its declared ` +
              'errorCodes do not include — a client cannot handle a case it was told cannot happen',
          ).toContain(code);
        }
      }
      observed.set(tool.name, codes);
    }
  });

  it('provoked enough distinct failures that the sweep is not vacuous', () => {
    const codes = new Set([...observed.values()].flatMap((set) => [...set]));
    expect([...codes].sort()).toEqual(
      expect.arrayContaining([
        'ENTITY_NOT_FOUND',
        'INVALID_ARGUMENTS',
        'PROPERTY_NOT_RECORDED',
        'REVIEWER_IDENTITY_BLOCKED',
        'TOO_FEW_ENTITIES',
        'UNKNOWN_FIELD',
      ]),
    );
    // The specific pairing the sweep exists for: a tool that reads a fact sheet
    // only indirectly, through `compare`, still refuses on a reviewer leak.
    expect(observed.get('compare_entities')).toContain('REVIEWER_IDENTITY_BLOCKED');
  });
});

describe('claim 2: every declared constraint is enforced', () => {
  it('finds constraints to check, so the walk cannot pass vacuously', () => {
    const total = TOOLS.flatMap((tool) =>
      Object.entries(tool.inputSchema['properties'] as Json).flatMap(([property, schema]) =>
        violationsFor(property, schema as Json),
      ),
    );
    expect(total.length).toBeGreaterThan(30);
  });

  for (const tool of TOOLS) {
    it(`${tool.name} refuses every value its schema declares invalid`, async () => {
      const base = baselines()[tool.name] as Json;
      const properties = tool.inputSchema['properties'] as Json;

      for (const [property, schema] of Object.entries(properties)) {
        for (const violation of violationsFor(property, schema as Json)) {
          const label = `${tool.name}.${property} violating ${violation.constraint}`;
          const call = await fixtures.server.callTool(tool.name, {
            ...base,
            [property]: violation.value,
          });
          expect(call.isError, label).toBe(true);
          const error = errorOf(call);
          expect(error.code, label).toBe('INVALID_ARGUMENTS');
          const issues = error.details['issues'] as readonly { path: string }[];
          expect(
            issues.some((issue) => issue.path === property || issue.path.startsWith(`${property}.`)),
            `${label} — issues were ${JSON.stringify(issues)}`,
          ).toBe(true);
        }
      }
    });
  }
});
