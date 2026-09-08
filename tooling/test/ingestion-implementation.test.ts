import { describe, expect, it } from 'vitest';
import { hashIngestionImplementation, isIngestionImplementationInput, readIngestionImplementation,
  INGESTION_IMPLEMENTATION_DIRECTORIES, INGESTION_IMPLEMENTATION_EXTRA_INPUTS } from '../lib/ingestion-implementation.js';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BUNDLED_INGESTION_VERTICALS, compileIngestionRuntime } from '../scripts/compile-ingestion-runtime.js';
import { REPO_ROOT } from '../scripts/compile-acquisition-runtime.js';
import { ingestionRuntimeDigest } from '../../services/ingest-worker/src/runtime.js';

describe('processing implementation identity', () => {
  const input = { path: 'services/ingest-worker/src/pipeline-core.ts', content: 'export const normalize = () => 1;\n' };
  it('changes runtime identity for a code fix while retaining identical artifact configuration', async () => {
    const runtime = await compileIngestionRuntime('hvac');
    const original = hashIngestionImplementation([input]);
    const changed = hashIngestionImplementation([{ ...input, content: 'export const normalize = () => 2;\n' }]);
    expect(changed.implementation_digest).not.toBe(original.implementation_digest);
    const { runtime_digest: _digest, ...payload } = runtime;
    const before = { ...payload, ...original }; const after = { ...payload, ...changed };
    expect(after.config).toBe(before.config);
    expect(after.acquisition_runtime_digest).toBe(before.acquisition_runtime_digest);
    expect(ingestionRuntimeDigest(after)).not.toBe(ingestionRuntimeDigest(before));
  });
  it('normalizes LF and path order, and ignores documentation, generated data, tests and offline providers', () => {
    const other = { path: 'packages/normalization/src/alias-normalization.ts', content: 'const rule = true;\nconst value = 1;\n' };
    const original = hashIngestionImplementation([input, other]);
    expect(hashIngestionImplementation([{ ...other, content: other.content.replace(/\n/g, '\r\n') }, input])).toEqual(original);
    expect(hashIngestionImplementation([input, other, { path: 'docs/operations.md', content: 'irrelevant documentation change' },
      { path: 'apps/ingestion-worker/generated/hvac.ingestion-runtime.json', content: 'no hash cycle' },
      { path: 'packages/normalization/src/test/fixture.ts', content: 'not production code' },
      { path: 'packages/extraction/src/providers/pdf-extractor.ts', content: 'unsupported provider' }])).toEqual(original);
  });
  it('covers parser, resolver, rights, store, dependencies, compiler semantics and input additions/removals', async () => {
    const actual = await readIngestionImplementation(REPO_ROOT);
    expect(actual.implementation_inputs).toEqual([...actual.implementation_inputs].sort());
    for (const path of ['packages/extraction/src/providers/json-extractor.ts', 'packages/extraction/src/providers/csv-extractor.ts',
      'services/ingest-worker/src/resolution.ts', 'packages/rights-engine/src/resolver.ts', 'packages/canonical-store/src/store.ts',
      'db/migrations/0029_ingestion_delivery.sql', 'pnpm-lock.yaml', 'tooling/lib/ingestion-implementation.ts', 'tooling/scripts/compile-ingestion-runtime.ts']) {
      expect(actual.implementation_inputs).toContain(path);
    }
    const added = { path: 'packages/normalization/src/new-production-rule.ts', content: 'export const newRule = true;' };
    expect(hashIngestionImplementation([input, added]).implementation_digest).not.toBe(hashIngestionImplementation([input]).implementation_digest);
    expect(isIngestionImplementationInput('../outside.ts')).toBe(false);
    expect(isIngestionImplementationInput('services/ingest-worker/src/fixtures.ts')).toBe(false);
    expect(BUNDLED_INGESTION_VERTICALS).toEqual(['hvac']);
  });
  it('rejects a symlinked input root or nonregular/symlinked extra input before reading it', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'df-implementation-inputs-'));
    const root = join(temporary, 'repo'); const outside = join(temporary, 'outside');
    const rootLink = join(root, 'apps/ingestion-worker/src');
    const extraLink = join(root, 'pnpm-lock.yaml');
    try {
      await mkdir(dirname(rootLink), { recursive: true }); await mkdir(outside);
      await symlink(outside, rootLink, 'junction');
      await expect(readIngestionImplementation(root)).rejects.toThrow('INGESTION_IMPLEMENTATION_SYMLINK_REFUSED');
      await rm(rootLink);
      for (const directory of INGESTION_IMPLEMENTATION_DIRECTORIES) await mkdir(join(root, directory), { recursive: true });
      for (const path of INGESTION_IMPLEMENTATION_EXTRA_INPUTS) {
        if (path === 'pnpm-lock.yaml') continue;
        await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), 'synthetic input\n');
      }
      await symlink(outside, extraLink, 'junction');
      await expect(readIngestionImplementation(root)).rejects.toThrow('INGESTION_IMPLEMENTATION_SYMLINK_REFUSED');
      await rm(extraLink); await mkdir(extraLink);
      await expect(readIngestionImplementation(root)).rejects.toThrow('INGESTION_IMPLEMENTATION_FILE_REQUIRED');
    } finally {
      // Remove test links explicitly before recursive cleanup; resolved cleanup
      // stays in the mkdtemp directory and never follows a junction target.
      for (const link of [rootLink, extraLink]) if ((await lstat(link).catch(() => null))?.isSymbolicLink()) await rm(link);
      if (!resolve(root).startsWith(`${resolve(temporary)}/`) && !resolve(root).startsWith(`${resolve(temporary)}\\`)) throw new Error('TEMP_PATH_INVALID');
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
