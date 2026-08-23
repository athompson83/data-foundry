/**
 * Where an export's bytes land.
 *
 * AGENTS.md names R2 as the eventual destination for exports. No R2 bucket is
 * configured in this repository and this service makes no network calls, so the
 * builder writes through a small sink interface instead of assuming a cloud
 * target: a caller-supplied directory today, an object store the day one
 * exists, and an in-memory sink for tests that want to compare bytes without
 * touching a filesystem.
 *
 * The sink owns the URI scheme because the manifest has to record where it was
 * published (`dataset_snapshots.manifest_uri` is `NOT NULL`), and only the sink
 * knows.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StorageUriSchema, type StorageUri } from '@data-foundry/canonical-schema';

export interface ExportSink {
  /** Human-readable, for error messages and logs. */
  readonly label: string;
  /** The URI a relative path within this export will be addressable at. */
  uriFor(path: string): StorageUri;
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export interface MemorySink extends ExportSink {
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** Reject `..`, absolute paths and backslashes before they reach a filesystem. */
function assertRelativePath(path: string): void {
  if (path === '' || isAbsolute(path) || path.includes('\\')) {
    throw new TypeError(`Export path "${path}" must be a relative, forward-slashed path.`);
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new TypeError(`Export path "${path}" must not contain empty or traversal segments.`);
    }
  }
}

/**
 * Write into a directory on the local filesystem.
 *
 * `file://` URIs are what `manifest_uri` carries for a local build. They satisfy
 * `StorageUriSchema` (scheme-qualified, not an http URL) exactly as `r2://`
 * would, so nothing downstream has to special-case the local case.
 */
export function createDirectorySink(directory: string): ExportSink {
  const root = resolve(directory);
  return {
    label: `dir:${root}`,
    uriFor(path) {
      assertRelativePath(path);
      return StorageUriSchema.parse(pathToFileURL(join(root, path)).href);
    },
    async write(path, bytes) {
      assertRelativePath(path);
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
  };
}

/**
 * Keep the bytes in memory.
 *
 * Used by the determinism tests, which need to compare two whole builds without
 * a filesystem in the middle deciding anything.
 */
export function createMemorySink(namespace = 'export'): MemorySink {
  const files = new Map<string, Uint8Array>();
  return {
    label: `memory:${namespace}`,
    files,
    uriFor(path) {
      assertRelativePath(path);
      return StorageUriSchema.parse(`memory://${namespace}/${path}`);
    },
    async write(path, bytes) {
      assertRelativePath(path);
      files.set(path, bytes);
      return Promise.resolve();
    },
  };
}
