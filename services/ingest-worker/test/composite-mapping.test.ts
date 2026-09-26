/**
 * Generic mapping constructs added with the second vertical, tested on the
 * real `vehicles` and `hvac` configurations: composite `paths`, composite
 * `source_record_key`, headerless `parsing.columns`, and the publisher entity
 * type read from configuration. None of them names a vertical.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { compileSourcePlans, type SourcePlan } from '../src/compile.js';
import {
  loadVerticalConfig,
  publisherEntityType,
  publisherPredicates,
  type VerticalConfig,
} from '../src/config.js';
import { MappingCompilationError, PipelineConfigurationError } from '../src/errors.js';

let vehicles: VerticalConfig;
let hvac: VerticalConfig;
let plans: SourcePlan[];

beforeAll(async () => {
  vehicles = await loadVerticalConfig('vehicles');
  hvac = await loadVerticalConfig('hvac');
  plans = compileSourcePlans(vehicles);
});

const stream = (sourceKey: string, name: string) => {
  const found = plans.find((plan) => plan.sourceKey === sourceKey)?.streams.find((candidate) => candidate.stream === name);
  if (found === undefined) throw new Error(`no stream ${sourceKey}/${name}`);
  return found;
};

describe('composite paths', () => {
  it('compiles a multi-column alias to one csv_columns field shared by the relationship endpoint', () => {
    const plan = stream('epa-fueleconomy-vehicles', 'configurations');
    const field = plan.schema.fields.find((candidate) => candidate.locate.kind === 'csv_columns');
    expect(field?.locate).toEqual({ kind: 'csv_columns', columns: ['make', 'baseModel', 'year'], separator: ' ' });
    const edge = plan.relationships.find((relationship) => relationship.predicate === 'configuration_of');
    expect(edge?.subject).toEqual({ kind: 'self' });
    expect(edge?.object).toMatchObject({ kind: 'alias', entityType: 'vehicle_model_year', aliasType: 'make_model_year', field: field?.field });
  });

  it('recognises the same composite as the record’s own entity', () => {
    const plan = stream('nhtsa-recalls', 'affected_model_years');
    const makes = plan.relationships.find((relationship) => relationship.predicate === 'makes');
    expect(makes?.subject.kind).toBe('publisher');
    expect(makes?.object).toEqual({ kind: 'self' });
  });

  it('refuses composite paths on a non-CSV source rather than reading one part', () => {
    const broken = {
      ...hvac,
      sourceMappings: {
        sources: [{
          ...hvac.sourceMappings.sources[0],
          records: [{
            ...hvac.sourceMappings.sources[0].records[0],
            aliases: [{ alias_type: 'model_number', paths: ['/model', '/sku'], strong: true }],
          }],
        }],
      },
    };
    expect(() => compileSourcePlans(broken)).toThrow(MappingCompilationError);
  });
});

describe('composite record keys and headerless files', () => {
  it('keys a second projection of one row distinctly from the first', () => {
    expect(stream('epa-fueleconomy-vehicles', 'model_years').schema.record_key.fields).toHaveLength(2);
    expect(stream('epa-fueleconomy-vehicles', 'configurations').schema.record_key.fields).toHaveLength(1);
  });

  it('declares the column names of a headerless file', () => {
    const record = stream('nhtsa-recalls', 'campaigns').schema.record;
    expect(record.kind).toBe('csv_rows');
    if (record.kind !== 'csv_rows') return;
    expect(record.delimiter).toBe('\t');
    expect(Array.isArray(record.header) && record.header[0]).toBe('RECORD_ID');
  });
});

describe('publisher entity type from configuration', () => {
  it('reads each vertical’s own publisher type and predicates', () => {
    expect(publisherEntityType(hvac)).toBe('manufacturer');
    expect(publisherPredicates(hvac)).toEqual(['manufactures']);
    expect(publisherEntityType(vehicles)).toBe('make');
    expect(publisherPredicates(vehicles)).toEqual(['makes']);
  });

  it('refuses one publisher table resolving to two entity types', () => {
    const conflicting = {
      sourceMappings: {
        sources: [{
          records: [{
            relationships: [
              { predicate: 'makes', subject_resolve_with: 'publisher_aliases', subject_type: 'make' },
              { predicate: 'builds', subject_resolve_with: 'publisher_aliases', subject_type: 'manufacturer' },
            ],
          }],
        }],
      },
    };
    expect(() => publisherEntityType(conflicting)).toThrow(PipelineConfigurationError);
  });
});
