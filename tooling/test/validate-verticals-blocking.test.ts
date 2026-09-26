/**
 * `entity_resolution.blocking_keys` is a closed, declarative vocabulary.
 *
 * A key the platform could not interpret used to block nothing, silently: the
 * resolver returned null for it and proposed no candidates. The gate must now
 * say no — and must still say yes to HVAC's real declaration. Rejection cases
 * use throwaway configs, never the real vertical.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { parseBlockingKeys } from '../../services/ingest-worker/src/blocking.js';
import {
  validateBlockingKeys,
  validateVertical,
  VERTICALS_DIR,
  type VerticalConfig,
} from '../validators/validate-verticals.js';

const temporaryDirectories: string[] = [];
afterAll(async () => {
  await Promise.all(temporaryDirectories.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A synthetic second vertical, inline — not a `verticals/` directory. */
const vehicles = (blockingKeys: unknown): VerticalConfig =>
  ({
    slug: 'vehicles',
    name: 'Vehicles',
    schema_version: '0.1.0',
    status: 'DRAFT',
    default_refresh_policy: { cadence: 'MONTHLY', max_staleness_hours: 720, priority: 50 },
    entity_types: ['make', 'vehicle_model_year', 'epa_vehicle_configuration', 'recall_campaign'],
    relationship_predicates: ['makes', 'affected_by'],
    alias_types: [
      { type: 'epa_vehicle_id', applies_to: ['epa_vehicle_configuration'], strong: true },
      { type: 'nhtsa_campaign_number', applies_to: ['recall_campaign'], strong: true },
    ],
    entity_resolution: { blocking_keys: blockingKeys },
  }) as VerticalConfig;

const VEHICLE_KEYS = [
  {
    key: 'same_make',
    entity_type: 'vehicle_model_year',
    kind: 'related_entity',
    predicate: 'makes',
    role: 'object',
    reject_mismatch_as: 'makes',
  },
  {
    key: 'make_model_year',
    entity_type: 'vehicle_model_year',
    kind: 'property_values',
    properties: ['model_name', 'model_year'],
  },
  { key: 'epa_vehicle_id', entity_type: 'epa_vehicle_configuration', kind: 'alias', alias_type: 'epa_vehicle_id' },
  {
    key: 'campaign_year_prefix',
    entity_type: 'recall_campaign',
    kind: 'alias',
    alias_type: 'nhtsa_campaign_number',
    prefix_length: 3,
  },
];

describe('blocking-key vocabulary', () => {
  it("accepts HVAC's declared keys and keeps their block labels", async () => {
    const raw = parseYaml(await readFile(join(VERTICALS_DIR, 'hvac', 'vertical.yaml'), 'utf8'));
    expect(validateBlockingKeys(raw)).toEqual([]);
    const parsed = parseBlockingKeys(raw.entity_resolution.blocking_keys, {
      entityTypes: raw.entity_types,
      relationshipPredicates: raw.relationship_predicates,
      aliasTypes: raw.alias_types,
    });
    expect(parsed.keys.map((key) => [key.key, key.kind])).toEqual([
      ['normalized_manufacturer', 'related_entity'],
      ['model_number_prefix_6', 'alias'],
      ['product_type_and_capacity_band', 'property_values'],
    ]);
  });

  it('accepts a second vertical expressed in the same vocabulary', () => {
    expect(validateBlockingKeys(vehicles(VEHICLE_KEYS))).toEqual([]);
  });

  it('rejects an undeclared bare key instead of silently blocking nothing', () => {
    const errors = validateBlockingKeys(vehicles(['make_model_year']));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/blocking_keys\[0\]: undeclared blocking key "make_model_year"/);
  });

  it.each([
    [{ ...VEHICLE_KEYS[1], kind: 'vector_similarity' }, /kind: "vector_similarity" is not a blocking key kind/],
    [{ ...VEHICLE_KEYS[0], predicate: 'manufactures' }, /predicate: "manufactures" is not a declared relationship predicate/],
    [{ ...VEHICLE_KEYS[0], role: 'sideways' }, /role: must be subject or object/],
    [{ ...VEHICLE_KEYS[2], alias_type: 'model_number' }, /alias_type: "model_number" is not a declared alias type/],
    [{ ...VEHICLE_KEYS[2], alias_type: 'nhtsa_campaign_number' }, /does not apply to epa_vehicle_configuration/],
    [{ ...VEHICLE_KEYS[3], prefix_length: 0 }, /prefix_length: must be a positive integer/],
    [{ ...VEHICLE_KEYS[1], entity_type: 'equipment_model' }, /entity_type: "equipment_model" is not a declared entity type/],
    [{ ...VEHICLE_KEYS[1], properties: [] }, /properties: must be a non-empty list/],
    [{ ...VEHICLE_KEYS[1], prefix_length: 3 }, /prefix_length: not a field of kind property_values/],
  ])('rejects %j', (key, message) => {
    const errors = validateBlockingKeys(vehicles([key]));
    expect(errors.join('\n')).toMatch(message);
  });

  it('rejects a duplicate key label', () => {
    const errors = validateBlockingKeys(vehicles([VEHICLE_KEYS[2], VEHICLE_KEYS[2]]));
    expect(errors.join('\n')).toMatch(/duplicate blocking key "epa_vehicle_id"/);
  });

  it('fails the vertical gate on an undeclared key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'data-foundry-blocking-'));
    temporaryDirectories.push(dir);
    await writeFile(join(dir, 'vertical.yaml'), stringifyYaml(vehicles(['make_model_year'])), 'utf8');
    const problems = await validateVertical(dir, '2026-09-26T00:00:00.000Z');
    expect(problems.map((problem) => problem.message)).toContainEqual(
      expect.stringMatching(/undeclared blocking key "make_model_year"/),
    );
  });
});
