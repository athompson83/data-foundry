import { describe, expect, it } from 'vitest';
import { CANONICAL_OBJECT_SCHEMAS } from '../src/registry.js';
import { IsoDateTimeSchema, SlugSchema, IdentifierSchema } from '../src/primitives.js';
import { EntityIdSchema } from '../src/ids.js';
import { FactSchema } from '../src/objects/facts.js';
import { SourceSchema } from '../src/objects/sources.js';
import { resolutionSideIsValid } from '../src/objects/resolution.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const TS = '2026-08-14T00:00:00.000Z';

describe('canonical object registry', () => {
  it('covers every table the migrations create', () => {
    expect(Object.keys(CANONICAL_OBJECT_SCHEMAS).sort()).toEqual(
      [
        'dataset_snapshots',
        'entities',
        'entity_aliases',
        'entity_redirects',
        'fact_evidence',
        'fact_verifications',
        'facts',
        'ingestion_jobs',
        'job_status',
        'media_assets',
        'relationship_evidence',
        'relationships',
        'resolution_candidates',
        'resolution_judgments',
        'source_artifacts',
        'source_records',
        'sources',
        'verticals',
      ].sort(),
    );
  });
});

describe('primitives', () => {
  it('accepts ISO-8601 timestamps with Z or an offset', () => {
    expect(IsoDateTimeSchema.safeParse(TS).success).toBe(true);
    expect(IsoDateTimeSchema.safeParse('2026-08-14T02:00:00+02:00').success).toBe(true);
    expect(IsoDateTimeSchema.safeParse('2026-08-14').success).toBe(false);
    expect(IsoDateTimeSchema.safeParse('14/08/2026').success).toBe(false);
  });

  it('constrains slugs to URL-safe lowercase', () => {
    expect(SlugSchema.safeParse('carrier-infinity-24anb7').success).toBe(true);
    expect(SlugSchema.safeParse('Carrier_Infinity').success).toBe(false);
    expect(SlugSchema.safeParse('-leading').success).toBe(false);
  });

  it('constrains vertical-defined identifiers to snake_case', () => {
    expect(IdentifierSchema.safeParse('seer2_rating').success).toBe(true);
    expect(IdentifierSchema.safeParse('SEER2').success).toBe(false);
    expect(IdentifierSchema.safeParse('2_stage').success).toBe(false);
  });

  it('rejects a non-UUID entity id', () => {
    expect(EntityIdSchema.safeParse(UUID).success).toBe(true);
    expect(EntityIdSchema.safeParse('entity-42').success).toBe(false);
  });
});

describe('facts', () => {
  const base = {
    id: UUID,
    entity_id: UUID,
    property: 'seer2_rating',
    normalized_value: 16,
    value_type: 'number',
    output_kind: 'NORMALIZED_FACT',
    unit: null,
    valid_from: TS,
    valid_to: null,
    status: 'ACTIVE',
    confidence: 0.9,
    supersedes_fact_id: null,
    recorded_at: TS,
    created_at: TS,
  };

  it('parses a well-formed fact', () => {
    expect(FactSchema.safeParse(base).success).toBe(true);
  });

  it('accepts scalar, array and flat-map canonical values', () => {
    for (const value of [16, 'R-410A', true, null, ['a', 'b'], { min: 1, max: 2 }]) {
      expect(FactSchema.safeParse({ ...base, normalized_value: value }).success).toBe(true);
    }
  });

  it('rejects a nested value that belongs in raw_payload', () => {
    const nested = { spec: { voltage: { min: 208 } } };
    expect(FactSchema.safeParse({ ...base, normalized_value: nested }).success).toBe(false);
  });

  it('rejects an out-of-range confidence', () => {
    expect(FactSchema.safeParse({ ...base, confidence: 1.4 }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(FactSchema.safeParse({ ...base, status: 'DELETED' }).success).toBe(false);
  });
});

describe('sources', () => {
  it('requires rights metadata to be present', () => {
    const parsed = SourceSchema.safeParse({
      id: UUID,
      vertical_id: UUID,
      publisher: 'Federated HVAC Ratings Council',
      domain: 'ratings-directory.example.org',
      source_type: 'CERTIFICATION_BODY',
      authority_rank: 95,
      refresh_cadence: 'WEEKLY',
      status: 'PROPOSED',
      created_at: TS,
      updated_at: TS,
      // rights_classification, attribution_requirement and robots_policy omitted
    });
    expect(parsed.success).toBe(false);
  });

  it('bounds authority_rank to 0-100 and keeps it off the unit interval', () => {
    const base = {
      id: UUID,
      vertical_id: UUID,
      publisher: 'Federated HVAC Ratings Council',
      domain: 'ratings-directory.example.org',
      source_type: 'CERTIFICATION_BODY',
      rights_classification: 'GREEN',
      attribution_requirement: { required: false, text: null, url: null },
      robots_policy: {
        respect_robots: true,
        user_agent: 'data-foundry-bot',
        crawl_delay_seconds: 2,
        disallowed_paths: [],
        allowed_paths: [],
        robots_url: null,
        snapshot_hash: null,
        snapshot_at: null,
      },
      refresh_cadence: 'WEEKLY',
      status: 'ACTIVE',
      kill_switch_engaged: false,
      created_at: TS,
      updated_at: TS,
    };
    expect(SourceSchema.safeParse({ ...base, authority_rank: 95 }).success).toBe(true);
    expect(SourceSchema.safeParse({ ...base, authority_rank: 101 }).success).toBe(false);
    expect(SourceSchema.safeParse({ ...base, authority_rank: 0.95 }).success).toBe(false);
  });
});

describe('resolution candidate sides', () => {
  it('requires exactly one of entity or source record per side', () => {
    expect(resolutionSideIsValid({ entity_id: EntityIdSchema.parse(UUID), source_record_id: null })).toBe(true);
    expect(resolutionSideIsValid({ entity_id: null, source_record_id: null })).toBe(false);
  });
});
