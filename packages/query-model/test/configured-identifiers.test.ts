import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AliasNormalizationSpecSchema, identityConfidence, relationshipConfidence } from '@data-foundry/canonical-schema';
import { createQueryModel, type QueryModel } from '../src/index.js';
import { addSourceFixture, addSyntheticEntityEvidence, claim, createFixtures, seedSyntheticSurfaceRights, ts, type Fixtures } from './support.js';
import { AliasNormalizer } from '../../../services/ingest-worker/src/identifiers.js';
import { compileAliasNormalization } from '../../normalization/src/alias-normalization.js';

let fixtures: Fixtures;
let qm: QueryModel;
let ownerId: string;
let collisionId: string;
let aliasId: string;
let laboratoryId: string;
beforeAll(async () => {
  fixtures = await createFixtures();
  const config = parse(await readFile(new URL('./fixtures/synthetic-laboratory.yaml', import.meta.url), 'utf8'));
  const vertical = await fixtures.store.upsertVertical({ ...fixtures.vertical, slug: config.slug, name: 'Synthetic Laboratory', status: 'DRAFT' });
  fixtures = { ...fixtures, vertical };
  const manufacturer = await addSourceFixture(fixtures, { key: 'lab-a', publisher: 'Synthetic Lab A', domain: 'lab-a.example', source_type: 'OTHER', authority_rank: 90, rights: 'GREEN' });
  const certifier = await addSourceFixture(fixtures, { key: 'lab-b', publisher: 'Synthetic Lab B', domain: 'lab-b.example', source_type: 'OTHER', authority_rank: 90, rights: 'GREEN' });
  fixtures = { ...fixtures, sources: { ...fixtures.sources, manufacturer, certifier } };
  const spec = AliasNormalizationSpecSchema.parse(config.identifier_normalization);
  const writeConfig = { domainNormalization: { identifier_rules: spec.rules } };
  const normalizer = new AliasNormalizer(writeConfig);
  qm = createQueryModel(fixtures.store, { fields: config.fields, identifier_normalization: compileAliasNormalization(writeConfig) });
  const owner = await fixtures.store.upsertEntity({
    ...fixtures.entity, vertical_id: vertical.id, entity_type: 'specimen', canonical_name: 'Copper specimen', canonical_slug: 'copper-specimen',
  });
  ownerId = owner.id;
  const alias = await fixtures.store.addAlias({
    entity_id: owner.id, alias_type: 'accession', alias_value: 'LAB:ab 12/00', normalized_value: normalizer.normalize('accession', 'LAB:ab 12/00'),
    source_id: fixtures.sources.manufacturer.source.id, identity_confidence: identityConfidence(0.99),
    valid_from: ts('2026-01-01'), valid_to: null,
  });
  expect(alias.normalized_value).toBe('AB1200');
  expect(alias.alias_value).toBe('LAB:ab 12/00');
  aliasId = alias.id;
  await addSyntheticEntityEvidence(fixtures, owner);
  await claim(fixtures, 'manufacturer', { entity_id: owner.id, property: 'specimen_material', value: 'copper' });
  const laboratory = await fixtures.store.upsertEntity({ ...owner, entity_type: 'laboratory', canonical_name: 'Synthetic Laboratory', canonical_slug: 'synthetic-laboratory' });
  laboratoryId = laboratory.id;
  await fixtures.store.upsertRelationshipWithEvidence({ vertical_id: vertical.id, subject_entity_id: owner.id, predicate: config.relationship_predicates[0], object_entity_id: laboratory.id, confidence: relationshipConfidence(0.9), valid_from: ts('2026-01-01'), recorded_at: ts('2026-01-01'), status: 'ACTIVE' }, [{ artifact_id: manufacturer.artifact.id, source_record_id: manufacturer.record.id, source_value: 'Copper specimen tested by Synthetic Laboratory', locator_type: 'WHOLE_DOCUMENT', locator_value: '', observed_at: ts('2026-01-01') }]);
  const collision = await fixtures.store.upsertEntity({
    ...fixtures.entity, vertical_id: vertical.id, entity_type: 'specimen', canonical_name: 'Structural code collision', canonical_slug: 'structural-collision',
  });
  collisionId = collision.id;
  await fixtures.store.addAlias({
    entity_id: collision.id, alias_type: 'structural_code', alias_value: 'AB1200', normalized_value: 'AB1200',
    source_id: fixtures.sources.certifier.source.id, identity_confidence: identityConfidence(0.99),
    valid_from: ts('2026-01-01'), valid_to: null,
  });
});
afterAll(async () => { await fixtures?.driver.close(); });

describe('declared identifier lookup', () => {
  it.each(['LAB:ab-12/00', 'ＬＡＢ：ａｂ－１２／００', ' LAB:ab\u00ad-12\u200b/00\t'])('uses prefix/NFKC/format rules for %s in direct and search reads', async (value) => {
    const direct = await qm.lookupIdentifier({ vertical_id: fixtures.vertical.id, value });
    expect(direct.entities.map((view) => view.entity.id)).toEqual([ownerId]);
    const searched = await qm.search({ vertical_id: fixtures.vertical.id, text: value });
    expect(searched.hits.filter((hit) => hit.match_kind === 'EXACT_IDENTIFIER').map((hit) => hit.entity.id)).toEqual([ownerId]);
  });
  it('does not apply a prefix chain across alias types or remove structural separators', async () => {
    expect((await qm.lookupIdentifier({ vertical_id: fixtures.vertical.id, alias_type: 'structural_code', value: 'AB-1200' })).entities).toEqual([]);
    expect((await qm.lookupIdentifier({ vertical_id: fixtures.vertical.id, alias_type: 'structural_code', value: 'AB1200' })).entities.map((view) => view.entity.id)).toEqual([collisionId]);
  });
  it('does not grant a denied surface access when normalization resolves an alias', async () => {
    const surface = qm.forSurface('PUBLIC_WEB');
    expect((await surface.lookupIdentifier({ vertical_id: fixtures.vertical.id, value: 'LAB:ab-12/00' })).entities).toEqual([]);
    expect((await surface.search({ vertical_id: fixtures.vertical.id, text: 'LAB:ab-12/00' })).hits).toEqual([]);
  });
  it('keeps source scope explicit without silently choosing an identity', async () => {
    const lookup = { vertical_id: fixtures.vertical.id, alias_type: 'accession', value: 'LAB:ab-12/00' };
    expect((await qm.lookupIdentifier({ ...lookup, source_id: fixtures.sources.manufacturer.source.id })).entities.map((view) => view.entity.id)).toEqual([ownerId]);
    expect((await qm.lookupIdentifier({ ...lookup, source_id: fixtures.sources.certifier.source.id })).entities).toEqual([]);
    const competing = await fixtures.store.addAlias({ entity_id: collisionId as never, alias_type: 'accession', alias_value: 'AB1200', normalized_value: 'AB1200', source_id: fixtures.sources.certifier.source.id, identity_confidence: identityConfidence(0.9), valid_from: ts('2026-01-01'), valid_to: null });
    expect((await qm.lookupIdentifier(lookup)).entities.map((view) => view.entity.id).sort()).toEqual([ownerId, collisionId].sort());
    expect((await qm.lookupIdentifier({ ...lookup, source_id: fixtures.sources.certifier.source.id })).entities.map((view) => view.entity.id)).toEqual([collisionId]);
    await fixtures.store.addAlias({ ...competing, valid_to: ts('2026-08-01') });
  });
  it('serves the second vertical fields and relationships through the unchanged query model', async () => {
    const result = await qm.search({ vertical_id: fixtures.vertical.id, entity_type: 'specimen', filters: [{ property: 'specimen_material', op: 'in', values: ['copper'] }] });
    expect(result.hits.map((hit) => hit.entity.id)).toEqual([ownerId]);
    expect((await qm.facets({ vertical_id: fixtures.vertical.id })).find((facet) => facet.property === 'specimen_material')?.values).toEqual([{ value: 'copper', count: 1 }]);
    expect((await qm.relationships({ entity_id: ownerId as never, predicate: 'tested_by' })).edges.map((edge) => edge.neighbor.id)).toEqual([laboratoryId]);
  });
  it('finds every current source behind a shared alias, independent of its display representative', async () => {
    const value = 'SHARED22';
    const scopedOwner = await fixtures.store.upsertEntity({ ...fixtures.entity, vertical_id: fixtures.vertical.id, entity_type: 'specimen', canonical_name: 'Shared source specimen', canonical_slug: 'shared-source-specimen' });
    const alias = await fixtures.store.stageSourceAlias({
      entity_id: scopedOwner.id, alias_type: 'accession', alias_value: value,
      normalized_value: value, source_id: fixtures.sources.manufacturer.source.id,
      identity_confidence: identityConfidence(0.96), valid_from: ts('2026-01-01'), valid_to: null,
    });
    for (const source of [fixtures.sources.manufacturer, fixtures.sources.certifier]) {
      const sourceClaim = await fixtures.store.recordSourceAliasClaim({
        entity_alias_id: alias.id, asserted_alias_value: value, asserted_normalized_value: value,
        identity_confidence: identityConfidence(0.96), source_record_id: source.record.id,
        locator_type: 'JSON_POINTER', locator_value: '/accession',
      });
      await fixtures.store.recordEntityEvidence({
        entity_id: scopedOwner.id, artifact_id: source.artifact.id,
        source_record_id: source.record.id, entity_alias_claim_id: sourceClaim.id,
        contribution_role: 'ALIAS', locator_type: 'JSON_POINTER', locator_value: '/accession',
        observed_at: ts('2026-01-01'),
      });
    }
    const lookup = { vertical_id: fixtures.vertical.id, alias_type: 'accession', value: `LAB:${value}` };
    for (const source of [fixtures.sources.manufacturer, fixtures.sources.certifier]) {
      expect((await qm.lookupIdentifier({ ...lookup, source_id: source.source.id })).entities.map((view) => view.entity.id)).toEqual([scopedOwner.id]);
    }
    const record = fixtures.sources.certifier.record;
    await fixtures.driver.transaction((tx) => fixtures.store.reconcileSourceRecord({
      source_id: record.source_id, artifact_id: record.artifact_id,
      source_record_key: record.source_record_key, source_stream: record.source_stream ?? 'fixture_records',
      entity_type: record.entity_type, raw_payload: { ...record.raw_payload, revision: 'replacement' },
      normalized_payload: record.normalized_payload, extraction_confidence: record.extraction_confidence,
      extractor_version: record.extractor_version,
    }, tx, 'e'.repeat(64), ts('2026-08-30')));
    expect((await qm.lookupIdentifier({ ...lookup, source_id: record.source_id })).entities).toEqual([]);
    expect((await qm.lookupIdentifier({ ...lookup, source_id: fixtures.sources.manufacturer.source.id })).entities.map((view) => view.entity.id)).toEqual([scopedOwner.id]);
    await fixtures.store.addAlias({ ...alias, valid_to: ts('2026-08-31') });
  });
  it('preserves compiled identifiers in authorized and shared-snapshot surface reads', async () => {
    await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB', 'API_PAID', 'RAPIDAPI', 'MCP'], ['manufacturer']);
    for (const channel of ['PUBLIC_WEB', 'API_PAID', 'RAPIDAPI', 'MCP'] as const) {
      const run = async (surface: ReturnType<QueryModel['forSurface']>) => {
        expect((await surface.lookupIdentifier({ vertical_id: fixtures.vertical.id, value: 'LAB:ab-12/00' })).entities.map((view) => view.entity.id)).toEqual([ownerId]);
        expect((await surface.search({ vertical_id: fixtures.vertical.id, text: 'LAB:ab-12/00' })).hits[0]?.match_kind).toBe('EXACT_IDENTIFIER');
      };
      await run(qm.forSurface(channel));
      await qm.withSurfaceSnapshot((snapshot) => run(qm.forSurface(channel, {}, snapshot)));
    }
  });
  it('does not revive an alias after its curated claim is withdrawn', async () => {
    const alias = (await fixtures.store.listAliases(ownerId as never)).find((item) => item.id === aliasId)!;
    await fixtures.store.addAlias({ ...alias, valid_to: ts('2026-08-01') });
    expect((await qm.lookupIdentifier({ vertical_id: fixtures.vertical.id, value: 'LAB:ab-12/00' })).entities).toEqual([]);
    expect((await qm.search({ vertical_id: fixtures.vertical.id, text: 'LAB:ab-12/00' })).hits.filter((hit) => hit.match_kind === 'EXACT_IDENTIFIER')).toEqual([]);
  });
});
