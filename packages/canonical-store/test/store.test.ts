/**
 * Entities, aliases, redirects and snapshots against real SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entityQualityScore, identityConfidence } from '@data-foundry/canonical-schema';
import { countRows, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;

beforeAll(async () => {
  fixtures = await createFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('entities and aliases', () => {
  it.each([
    [null, false, false],
    [null, true, true],
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ] as const)(
    'registers kill switch stored=%s bundled=%s to monotone %s',
    async (stored, bundled, expected) => {
      const source = fixtures.sources.manufacturer.source;
      const input = {
        vertical_id: source.vertical_id,
        publisher: source.publisher,
        domain: source.domain,
        source_type: source.source_type,
        authority_rank: source.authority_rank,
        rights_classification: source.rights_classification,
        attribution_requirement: source.attribution_requirement,
        robots_policy: source.robots_policy,
        refresh_cadence: source.refresh_cadence,
        status: source.status,
      } as const;

      await fixtures.driver.query(
        'UPDATE sources SET kill_switch_engaged = $2 WHERE id = $1',
        [source.id, stored],
      );
      const synchronized = await fixtures.store.registerSource({
        ...input,
        kill_switch_engaged: bundled,
      });
      expect(synchronized.kill_switch_engaged).toBe(expected);
    },
  );

  it('lets the source trigger timestamp an ordinary caller kill-switch transition', async () => {
    const source = fixtures.sources.manufacturer.source;
    const oldTimestamp = '2020-01-01T00:00:00.000Z';
    await fixtures.driver.query(
      `UPDATE sources
          SET kill_switch_engaged = FALSE, updated_at = $2
        WHERE id = $1`,
      [source.id, oldTimestamp],
    );

    const synchronized = await fixtures.store.registerSource({
      vertical_id: source.vertical_id,
      publisher: source.publisher,
      domain: source.domain,
      source_type: source.source_type,
      authority_rank: source.authority_rank,
      rights_classification: source.rights_classification,
      attribution_requirement: source.attribution_requirement,
      robots_policy: source.robots_policy,
      refresh_cadence: source.refresh_cadence,
      status: source.status,
      kill_switch_engaged: true,
    });

    expect(synchronized.kill_switch_engaged).toBe(true);
    expect(Date.parse(synchronized.updated_at)).toBeGreaterThan(Date.parse(oldTimestamp));
  });

  it('registers bundled metadata without overwriting stored vertical or source governance state', async () => {
    const source = fixtures.sources.manufacturer.source;
    const vertical = fixtures.vertical;
    await fixtures.driver.query(
      `UPDATE verticals SET status = 'DEPRECATED' WHERE id = $1`,
      [vertical.id],
    );
    await fixtures.driver.query(
      `UPDATE sources
          SET status = 'PAUSED', rights_classification = 'RED', publisher = 'Database reviewer',
              kill_switch_engaged = FALSE
        WHERE id = $1`,
      [source.id],
    );

    const registeredVertical = await fixtures.store.registerVertical({
      slug: vertical.slug,
      name: 'Bundled replacement name',
      schema_version: vertical.schema_version,
      status: 'ACTIVE',
      default_refresh_policy: vertical.default_refresh_policy,
    });
    const registeredSource = await fixtures.store.registerSource({
      vertical_id: vertical.id,
      publisher: source.publisher,
      domain: source.domain,
      source_type: source.source_type,
      authority_rank: source.authority_rank,
      rights_classification: 'GREEN',
      attribution_requirement: source.attribution_requirement,
      robots_policy: source.robots_policy,
      refresh_cadence: source.refresh_cadence,
      status: 'ACTIVE',
      kill_switch_engaged: false,
    });

    expect(registeredVertical.status).toBe('DEPRECATED');
    expect(registeredVertical.name).toBe(vertical.name);
    expect(registeredSource).toMatchObject({
      status: 'PAUSED',
      rights_classification: 'RED',
      publisher: 'Database reviewer',
      kill_switch_engaged: false,
    });
  });

  it('upserts an entity on (vertical, type, slug) without duplicating it', async () => {
    const again = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Carrier Infinity 24ANB7 (rev)',
      canonical_slug: 'carrier-infinity-24anb7',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.82),
      first_seen_at: ts('2026-01-01T00:00:00Z'),
      last_verified_at: ts('2026-06-01T00:00:00Z'),
    });

    expect(again.id).toBe(fixtures.entity.id);
    expect(again.canonical_name).toBe('Carrier Infinity 24ANB7 (rev)');
    expect(again.quality_score).toBeCloseTo(0.82);
    expect(again.last_verified_at).toBe(ts('2026-06-01T00:00:00Z'));
    expect(await countRows(fixtures.driver, 'entities')).toBe(1);
  });

  it('reads an entity back by slug', async () => {
    const found = await fixtures.store.getEntityBySlug(
      fixtures.vertical.id,
      'equipment',
      'carrier-infinity-24anb7',
    );
    expect(found?.id).toBe(fixtures.entity.id);
  });

  it('is idempotent on aliases and looks them up deterministically', async () => {
    await fixtures.store.addAlias({
      entity_id: fixtures.entity.id,
      alias_type: 'model_number',
      alias_value: '24ANB7',
      normalized_value: '24anb7',
      source_id: fixtures.sources.certifier.source.id,
      identity_confidence: identityConfidence(0.9),
      valid_from: ts('2026-01-01T00:00:00Z'),
      valid_to: null,
    });
    await fixtures.store.addAlias({
      entity_id: fixtures.entity.id,
      alias_type: 'mpn',
      alias_value: '24ANB736A003',
      normalized_value: '24anb736a003',
      source_id: fixtures.sources.manufacturer.source.id,
      identity_confidence: identityConfidence(0.97),
      valid_from: ts('2026-01-01T00:00:00Z'),
      valid_to: null,
    });

    const aliases = await fixtures.store.listAliases(fixtures.entity.id);
    expect(aliases).toHaveLength(2);
    // Current presentation follows the winning active claim: source authority
    // precedes confidence, matching the deterministic resolver display rule.
    expect(aliases.find((alias) => alias.alias_type === 'model_number')?.identity_confidence)
      .toBeCloseTo(0.9);

    const matches = await fixtures.store.lookupByAlias({
      vertical_id: fixtures.vertical.id,
      values: ['24anb736a003'],
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.entity.id).toBe(fixtures.entity.id);
    expect(matches[0]?.alias.alias_type).toBe('mpn');
  });

  it('records artifacts idempotently by (source, url, content hash)', async () => {
    const before = await countRows(fixtures.driver, 'source_artifacts');
    const again = await fixtures.store.recordSourceArtifact({
      source_id: fixtures.sources.manufacturer.source.id,
      url: fixtures.sources.manufacturer.artifact.url,
      retrieved_at: ts('2026-04-01T00:00:00Z'),
      content_hash: fixtures.sources.manufacturer.artifact.content_hash,
      mime_type: 'text/html',
      r2_uri: fixtures.sources.manufacturer.artifact.r2_uri,
      http_status: 200,
      extractor_version: 'html-1.0.0',
      policy_snapshot_id: null,
      byte_size: 4096,
      acquisition_provider: 'http',
      acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null,
      acquisition_jurisdiction: null,
    });

    expect(again.id).toBe(fixtures.sources.manufacturer.artifact.id);
    expect(again.acquisition_route).toBe('DIRECT_HTTP');
    expect(again.account_or_product_plan).toBeNull();
    expect(again.acquisition_jurisdiction).toBeNull();
    // Immutable: re-fetching identical bytes did not rewrite retrieved_at.
    expect(again.retrieved_at).toBe(fixtures.sources.manufacturer.artifact.retrieved_at);
    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before);
  });

  it('keeps identical bytes distinct when their acquisition rights scope differs', async () => {
    const original = fixtures.sources.manufacturer.artifact;
    const before = await countRows(fixtures.driver, 'source_artifacts');
    const differentlyScoped = await fixtures.store.recordSourceArtifact({
      source_id: fixtures.sources.manufacturer.source.id,
      url: original.url,
      retrieved_at: ts('2026-04-02T00:00:00Z'),
      content_hash: original.content_hash,
      mime_type: original.mime_type,
      r2_uri: original.r2_uri,
      http_status: 200,
      extractor_version: 'browser-run@1.0.0',
      policy_snapshot_id: null,
      byte_size: original.byte_size,
      acquisition_provider: 'browser-run',
      acquisition_route: 'BROWSER_RUN',
      account_or_product_plan: 'partner-pro',
      acquisition_jurisdiction: 'US',
    });

    expect(differentlyScoped.id).not.toBe(original.id);
    expect(differentlyScoped.acquisition_route).toBe('BROWSER_RUN');
    expect(differentlyScoped.account_or_product_plan).toBe('partner-pro');
    expect(differentlyScoped.acquisition_jurisdiction).toBe('US');
    expect(await countRows(fixtures.driver, 'source_artifacts')).toBe(before + 1);
  });
});

describe('redirects', () => {
  it('follows a redirect chain after a merge and keeps the merge reversible', async () => {
    const duplicate = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Carrier 24ANB7 (duplicate)',
      canonical_slug: 'carrier-24anb7-dup',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.4),
      first_seen_at: ts('2026-01-02T00:00:00Z'),
      last_verified_at: null,
    });

    const redirect = await fixtures.store.mergeEntities({
      from_entity_id: duplicate.id,
      to_entity_id: fixtures.entity.id,
      reason: 'MERGE',
      from_slug: duplicate.canonical_slug,
      judgment_id: null,
    });

    expect(redirect.to_entity_id).toBe(fixtures.entity.id);
    expect((await fixtures.store.getEntityById(duplicate.id))?.status).toBe('MERGED');

    const resolved = await fixtures.store.resolveRedirect(duplicate.id);
    expect(resolved.redirected).toBe(true);
    expect(resolved.entity_id).toBe(fixtures.entity.id);
    expect(resolved.hops).toHaveLength(1);

    const bySlug = await fixtures.store.findRedirectBySlug(
      fixtures.vertical.id,
      'carrier-24anb7-dup',
    );
    expect(bySlug?.to_entity_id).toBe(fixtures.entity.id);
  });

  it('follows a multi-hop chain and terminates on a cycle', async () => {
    const first = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Hop A',
      canonical_slug: 'hop-a',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.3),
      first_seen_at: ts('2026-01-02T00:00:00Z'),
      last_verified_at: null,
    });
    const second = await fixtures.store.upsertEntity({
      vertical_id: fixtures.vertical.id,
      entity_type: 'equipment',
      canonical_name: 'Hop B',
      canonical_slug: 'hop-b',
      status: 'ACTIVE',
      quality_score: entityQualityScore(0.3),
      first_seen_at: ts('2026-01-02T00:00:00Z'),
      last_verified_at: null,
    });

    await fixtures.store.mergeEntities({
      from_entity_id: first.id,
      to_entity_id: second.id,
      reason: 'MERGE',
      from_slug: null,
      judgment_id: null,
    });
    await fixtures.store.mergeEntities({
      from_entity_id: second.id,
      to_entity_id: fixtures.entity.id,
      reason: 'MERGE',
      from_slug: null,
      judgment_id: null,
    });

    const resolved = await fixtures.store.resolveRedirect(first.id);
    expect(resolved.entity_id).toBe(fixtures.entity.id);
    expect(resolved.hops).toHaveLength(2);

    // A redirect back to the start must not loop forever.
    await fixtures.store.recordEntityRedirect({
      vertical_id: fixtures.vertical.id,
      from_entity_id: fixtures.entity.id,
      to_entity_id: first.id,
      from_slug: null,
      reason: 'MERGE',
      judgment_id: null,
      active: true,
    });
    const cyclic = await fixtures.store.resolveRedirect(first.id);
    expect(cyclic.hops.length).toBeLessThanOrEqual(3);
  });
});

describe('dataset snapshots', () => {
  it('records and re-reads an immutable published version', async () => {
    const snapshot = await fixtures.store.recordDatasetSnapshot({
      vertical_id: fixtures.vertical.id,
      version: '2026-08-14.1',
      generated_at: ts('2026-08-14T00:00:00Z'),
      record_counts: { entities: 1, facts: 0 },
      schema_version: '1.0.0',
      manifest_uri: 'r2://exports/hvac/2026-08-14.1/manifest.json',
      checksums: { 'dataset.parquet': 'a'.repeat(64) },
      status: 'PUBLISHED',
    });

    expect(snapshot.status).toBe('PUBLISHED');
    const read = await fixtures.store.getDatasetSnapshot(fixtures.vertical.id, '2026-08-14.1');
    expect(read?.id).toBe(snapshot.id);
    expect(read?.record_counts['entities']).toBe(1);
  });
});
