import { describe, expect, it } from 'vitest';
import { RightsViolationError } from '@data-foundry/canonical-schema';
import { AcquisitionConfigurationError, FixtureNotFoundError } from '../src/errors.js';
import { InMemoryFileSystem } from '../src/fs.js';
import { sha256Hex } from '../src/hashing.js';
import { FixtureAcquisitionProvider } from '../src/providers/fixture.js';
import {
  BODY,
  CountingFileSystem,
  ETAG,
  FIXTURE_DIR,
  LAST_MODIFIED,
  TARGET_URL,
  compliantEntry,
  makeHarness,
  makeRequest,
} from './helpers.js';

describe('fixture provider — reading a real fixture directory', () => {
  it('serves the declared body, status and mime type', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const result = await provider.fetch(makeRequest());

    expect(result.outcome).toBe('FETCHED');
    expect(result.artifacts[0]?.mime_type).toBe('application/json');
    expect(result.artifacts[0]?.http_status).toBe(200);
    expect(result.artifacts[0]?.content_hash).toBe(sha256Hex(BODY));
    expect(result.artifacts[0]?.acquisition_provider).toBe('fixture');
  });

  it('returns related resources, so crawl-shaped sources can be replayed offline', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const result = await provider.fetch(makeRequest());

    expect(result.artifacts.map((artifact) => artifact.url)).toEqual([
      TARGET_URL,
      'https://www.ratings-directory.example.org/certified/units-page-2.json',
    ]);
  });

  it('infers a mime type from the file extension when none is declared', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const result = await provider.fetch(
      makeRequest({ url: 'https://www.ratings-directory.example.org/certified/index.html' }),
    );
    expect(result.artifacts[0]?.mime_type).toBe('text/html');
  });

  it('honours a declared error status by refusing to treat it as evidence', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const result = await provider.fetch(
      makeRequest({ url: 'https://www.ratings-directory.example.org/certified/retired.json' }),
    );
    expect(result.outcome).toBe('EMPTY');
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('410');
  });

  it('answers 304 when the caller replays matching validators', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const first = await provider.fetch(makeRequest());
    expect(first.outcome).toBe('FETCHED');

    const second = await provider.fetch(makeRequest());
    expect(second.outcome).toBe('NOT_MODIFIED');
    expect(second.artifacts).toEqual([]);
  });

  it('matches Last-Modified when the caller has no ETag', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    const result = await provider.fetch(
      makeRequest({ conditional: { lastModified: LAST_MODIFIED } }),
    );
    expect(result.outcome).toBe('NOT_MODIFIED');
  });

  it('lists the URLs it can serve, so fixture coverage is assertable', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    expect(await provider.urls()).toHaveLength(4);
  });
});

describe('fixture provider — configuration and failure modes', () => {
  it('requires either a directory or an inline manifest', () => {
    const harness = makeHarness();
    expect(() => new FixtureAcquisitionProvider({ deps: harness.deps })).toThrow(
      AcquisitionConfigurationError,
    );
  });

  it('raises rather than silently inventing data for an undeclared URL', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    await expect(
      provider.fetch(makeRequest({ url: 'https://www.ratings-directory.example.org/certified/missing.json' })),
    ).rejects.toBeInstanceOf(FixtureNotFoundError);
  });

  it('can be told to answer 404 instead, for negative-path pipeline tests', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
      missingAs404: true,
    });

    const result = await provider.fetch(
      makeRequest({ url: 'https://www.ratings-directory.example.org/certified/missing.json' }),
    );
    expect(result.outcome).toBe('EMPTY');
    expect(result.diagnostics.join(' ')).toContain('404');
  });

  it('rejects a malformed manifest by naming the file', async () => {
    const harness = makeHarness();
    const files = new InMemoryFileSystem({ 'fx/manifest.json': '{"nope": true}' });
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: 'fx',
      fs: files,
    });

    await expect(provider.fetch(makeRequest())).rejects.toThrow(/fx\/manifest\.json/);
  });

  it('accepts an inline manifest, for tests that do not deserve a directory', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      manifest: {
        version: 1,
        entries: [{ url: TARGET_URL, body: BODY, mimeType: 'application/json', headers: { etag: ETAG } }],
      },
    });

    const result = await provider.fetch(makeRequest());
    expect(result.artifacts[0]?.content_hash).toBe(sha256Hex(BODY));
  });

  it('tolerates a trailing slash and host casing when matching a fixture', async () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      manifest: { version: 1, entries: [{ url: 'https://www.ratings-directory.example.org/certified/', body: 'x' }] },
    });

    const result = await provider.fetch(
      makeRequest({ url: 'https://WWW.ratings-directory.example.org/certified' }),
    );
    expect(result.artifacts).toHaveLength(1);
  });

  it('never opens a file when the rights gate refuses', async () => {
    const harness = makeHarness({ entry: compliantEntry({ rights_classification: 'RED' }) });
    const files = new CountingFileSystem(new InMemoryFileSystem());
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
      fs: files,
    });

    await expect(provider.fetch(makeRequest())).rejects.toBeInstanceOf(RightsViolationError);
    expect(files.reads).toEqual([]);
  });

  it('serves every acquisition method, so any source can be replayed offline', () => {
    const harness = makeHarness();
    const provider = new FixtureAcquisitionProvider({
      deps: harness.deps,
      directory: FIXTURE_DIR,
    });

    expect(provider.methods).toContain('DIRECT_HTTP');
    expect(provider.methods).toContain('BROWSER_RUN');
    expect(provider.methods).toContain('CRAWL4AI');
  });
});
