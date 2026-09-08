/** Build-time processing identity. This module must never enter a Worker import graph. */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const INGESTION_IMPLEMENTATION_DIRECTORIES = [
  'apps/ingestion-worker/src',
  'services/ingest-worker/src',
  'packages/acquisition/src',
  'packages/canonical-schema/src',
  'packages/canonical-store/src',
  'packages/extraction/src',
  'packages/normalization/src',
  'packages/provenance/src',
  'packages/query-model/src',
  'packages/rights-engine/src',
  'packages/source-registry/src',
  'db/migrations',
] as const;

// These entrypoints/providers are not part of the admitted production artifact
// processor. Compiler configuration loading is deliberately included below.
const EXCLUDED_INPUTS = new Set([
  'apps/ingestion-worker/src/index.ts',
  'apps/ingestion-worker/src/operation-alerts.ts',
  'apps/ingestion-worker/src/private-canary.ts',
  'apps/ingestion-worker/src/synthetic-ingestion.ts',
  'services/ingest-worker/src/artifact-store.ts',
  'services/ingest-worker/src/cli.ts',
  'services/ingest-worker/src/fixtures.ts',
  'services/ingest-worker/src/index.ts',
  'services/ingest-worker/src/pipeline.ts',
  'packages/acquisition/src/fs.ts',
  'packages/acquisition/src/providers/fixture.ts',
  'packages/acquisition/src/storage/local-fs-artifact-store.ts',
  'packages/extraction/src/providers/html-dom.ts',
  'packages/extraction/src/providers/html-extractor.ts',
  'packages/extraction/src/providers/pdf-extractor.ts',
  'packages/extraction/src/registry.ts',
]);
export const INGESTION_IMPLEMENTATION_EXTRA_INPUTS = [
  'tooling/lib/ingestion-implementation.ts',
  'tooling/scripts/compile-ingestion-runtime.ts',
  'tooling/scripts/compile-acquisition-runtime.ts',
  'pnpm-lock.yaml',
  'tsconfig.base.json',
  ...INGESTION_IMPLEMENTATION_DIRECTORIES.filter(directory => directory.endsWith('/src'))
    .map(directory => `${directory.slice(0, -4)}/package.json`),
] as const;
const EXTRA_INPUTS = new Set<string>(INGESTION_IMPLEMENTATION_EXTRA_INPUTS);
const MAX_FILES = 512;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export function isIngestionImplementationInput(path: string): boolean {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').some(part => part === '..')) return false;
  if (EXTRA_INPUTS.has(path)) return true;
  if (EXCLUDED_INPUTS.has(path) || /(?:^|\/)(?:test|tests|fixtures|generated|node_modules)(?:\/|$)/.test(path)
    || /\.(?:test|spec)\.ts$/.test(path)) return false;
  return INGESTION_IMPLEMENTATION_DIRECTORIES.some(directory => path.startsWith(`${directory}/`))
    && (path.endsWith('.ts') || (path.startsWith('db/migrations/') && path.endsWith('.sql')));
}

export interface IngestionImplementationInput { readonly path: string; readonly content: string }
export interface IngestionImplementationIdentity {
  readonly implementation_digest: string;
  readonly implementation_inputs: readonly string[];
}
export function hashIngestionImplementation(inputs: readonly IngestionImplementationInput[]): IngestionImplementationIdentity {
  const selected = inputs.filter(input => isIngestionImplementationInput(input.path)).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (selected.length === 0 || selected.length > MAX_FILES || new Set(selected.map(input => input.path)).size !== selected.length) {
    throw new Error('INGESTION_IMPLEMENTATION_INPUTS_INVALID');
  }
  let total = 0;
  const files = selected.map(input => {
    const text = input.content.replace(/\r\n?/g, '\n');
    const size = Buffer.byteLength(text, 'utf8');
    total += size;
    if (size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('INGESTION_IMPLEMENTATION_LIMIT');
    return { path: input.path, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
  });
  // Hash both the ordered input manifest and selection/compiler semantics. The
  // helper and compiler source bytes are themselves inputs, with no Git HEAD or
  // generated artifact input that could cause a self-referential hash cycle.
  const payload = { version: 1, directories: INGESTION_IMPLEMENTATION_DIRECTORIES,
    exclusions: [...EXCLUDED_INPUTS].sort(), extraInputs: [...EXTRA_INPUTS].sort(), files };
  return { implementation_digest: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
    implementation_inputs: files.map(file => file.path) };
}

/** Missing inputs and symlinks fail compilation instead of narrowing identity. */
export async function readIngestionImplementation(repositoryRoot: string): Promise<IngestionImplementationIdentity> {
  const paths = new Set<string>(INGESTION_IMPLEMENTATION_EXTRA_INPUTS);
  const checkedDirectories = new Set<string>();
  const requireDirectory = async (directory: string): Promise<void> => {
    if (checkedDirectories.has(directory)) return;
    const info = await lstat(directory);
    if (info.isSymbolicLink()) throw new Error('INGESTION_IMPLEMENTATION_SYMLINK_REFUSED');
    if (!info.isDirectory()) throw new Error('INGESTION_IMPLEMENTATION_DIRECTORY_REQUIRED');
    checkedDirectories.add(directory);
  };
  const requireParents = async (path: string): Promise<void> => {
    await requireDirectory(repositoryRoot);
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) await requireDirectory(join(repositoryRoot, ...parts.slice(0, index)));
  };
  const walk = async (directory: string): Promise<void> => {
    await requireParents(directory);
    await requireDirectory(join(repositoryRoot, directory));
    for (const entry of await readdir(join(repositoryRoot, directory), { withFileTypes: true })) {
      if (['test', 'tests', 'fixtures', 'generated', 'node_modules'].includes(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('INGESTION_IMPLEMENTATION_SYMLINK_REFUSED');
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && isIngestionImplementationInput(path)) paths.add(path);
      if (paths.size > MAX_FILES) throw new Error('INGESTION_IMPLEMENTATION_LIMIT');
    }
  };
  for (const directory of INGESTION_IMPLEMENTATION_DIRECTORIES) await walk(directory);
  const inputs: IngestionImplementationInput[] = [];
  let total = 0;
  for (const path of [...paths].sort()) {
    await requireParents(path);
    const info = await lstat(join(repositoryRoot, path));
    if (info.isSymbolicLink()) throw new Error('INGESTION_IMPLEMENTATION_SYMLINK_REFUSED');
    if (!info.isFile()) throw new Error('INGESTION_IMPLEMENTATION_FILE_REQUIRED');
    if (info.size > MAX_FILE_BYTES || total + info.size > MAX_TOTAL_BYTES) throw new Error('INGESTION_IMPLEMENTATION_LIMIT');
    const bytes = await readFile(join(repositoryRoot, path));
    total += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) throw new Error('INGESTION_IMPLEMENTATION_LIMIT');
    inputs.push({ path, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
  }
  return hashIngestionImplementation(inputs);
}
