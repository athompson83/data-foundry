import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createQueryModel } from '../src/index.js';
import { publicArtifactUrl } from '../src/public-evidence-url.js';
import { addSyntheticEntityEvidence, claim, createFixtures, seedSyntheticSurfaceRights, type Fixtures } from './support.js';
let fixtures: Fixtures;
beforeAll(async () => {
  fixtures = await createFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['MCP']);
  await addSyntheticEntityEvidence(fixtures, fixtures.entity);
  const original = fixtures.sources.manufacturer;
  const artifact = await fixtures.store.recordSourceArtifact({ ...original.artifact, url: `https://${original.source.domain}/spec?api_key=synthetic-do-not-publish`, content_hash: '9'.repeat(64) });
  const record = await fixtures.store.recordSourceRecord({ ...original.record, artifact_id: artifact.id, source_record_key: 'signed-evidence', source_stream: 'fixture_records', raw_payload: { model: 'signed-evidence' } });
  fixtures = { ...fixtures, sources: { ...fixtures.sources, manufacturer: { ...original, artifact, record } } };
  await claim(fixtures, 'manufacturer', { property: 'signed_evidence', value: 'supported', entity_id: fixtures.entity.id });
});
afterAll(async () => { await fixtures?.driver.close(); });
describe('surface evidence references', () => {
  it('requires query-free references rather than guessing every possible credential parameter', () => {
    for (const query of ['auth=opaque', 'jwt=opaque', 'unrecognized=opaque', 'model=123']) {
      expect(publicArtifactUrl(`https://source.example/spec?${query}`)).toBeNull();
    }
    expect(publicArtifactUrl('https://source.example/spec')).toBe('https://source.example/spec');
  });
  it('suppresses a signed artifact URL in both structured attributions and the generated narrative', async () => {
    const explanation = await createQueryModel(fixtures.store).forSurface('MCP').explainFact(fixtures.entity.id, 'signed_evidence' as never);
    expect(explanation?.selected?.attributions[0]).toMatchObject({ artifact_url: null, artifact_content_hash: '9'.repeat(64) });
    expect(explanation?.narrative.length).toBeGreaterThan(0);
    expect(JSON.stringify(explanation)).not.toContain('synthetic-do-not-publish');
    expect(JSON.stringify(explanation)).not.toContain('api_key');
  });
});
