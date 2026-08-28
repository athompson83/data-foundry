import type { StorageUri } from '@data-foundry/canonical-schema';
import { nodeFileSystem, type WritableFileSystem } from '../fs.js';
import { ArtifactStoreError } from '../errors.js';
import {
  storeArtifactBytes,
  parseArtifactMetadata,
  type ArtifactBody,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactStore,
  type StoredArtifact,
} from './artifact-store.js';
import { artifactMetadataKey } from './keys.js';

/**
 * Local-disk raw evidence store for development and CI.
 *
 * Same key layout as R2 (`raw/{vertical}/{source}/content/{aa}/{hash}` for the
 * bytes, `raw/{vertical}/{source}/retrieved/{yyyy}/{mm}/{dd}/{hash}.json` for
 * each fetch), rooted at `.data` — so an offline pipeline run produces a tree
 * that can be diffed against, or uploaded to, the real bucket without rewriting
 * keys.
 *
 * Metadata lives in a `<key>.meta.json` sidecar because a POSIX filesystem has
 * nowhere else to put it, and dropping it would leave the bytes unexplainable.
 */
export const DEFAULT_LOCAL_ARTIFACT_ROOT = '.data';

export interface LocalFsArtifactStoreOptions {
  readonly baseDir?: string | undefined;
  readonly fs?: WritableFileSystem | undefined;
}

export class LocalFsArtifactStore implements ArtifactStore {
  readonly scheme = 'file';
  readonly baseDir: string;
  readonly #fs: WritableFileSystem;

  constructor(options: LocalFsArtifactStoreOptions = {}) {
    this.baseDir = (options.baseDir ?? DEFAULT_LOCAL_ARTIFACT_ROOT).replace(/[\\/]+$/, '');
    this.#fs = options.fs ?? nodeFileSystem;
  }

  /** Absolute-ish path for a key, with forward slashes so it is comparable across platforms. */
  pathFor(key: string): string {
    return `${this.baseDir}/${key}`;
  }

  uriFor(key: string): StorageUri {
    const path = this.pathFor(key).replace(/\\/g, '/');
    // `file://` + an absolute-looking path. Windows drive letters keep their colon,
    // which is legal in a file URI path.
    return `file://${path.startsWith('/') ? '' : '/'}${encodeURI(path)}`;
  }

  put(request: ArtifactPutRequest): Promise<StoredArtifact> {
    return storeArtifactBytes(
      {
        readHead: (key) => this.head(key),
        exists: (key) => this.#fs.exists(this.pathFor(artifactMetadataKey(key))),
        write: async (key, body, metadata) => {
          const path = this.pathFor(key);
          await this.#fs.mkdir(path.slice(0, path.lastIndexOf('/')));
          await this.#fs.writeFile(path, body);
          await this.#fs.writeFile(
            this.pathFor(artifactMetadataKey(key)),
            new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`),
          );
        },
      },
      (key) => this.uriFor(key),
      request,
    );
  }

  async head(key: string): Promise<ArtifactMetadata | null> {
    const metadataPath = this.pathFor(artifactMetadataKey(key));
    if (!(await this.#fs.exists(metadataPath))) return null;
    const raw = await this.#fs.readFile(metadataPath);
    try {
      return parseArtifactMetadata(JSON.parse(new TextDecoder().decode(raw)) as unknown);
    } catch (cause) {
      throw new ArtifactStoreError(
        `Corrupt artifact metadata sidecar at ${metadataPath}: ${String(cause)}`,
      );
    }
  }

  async get(key: string): Promise<ArtifactBody | null> {
    const metadata = await this.head(key);
    if (metadata === null) return null;
    const path = this.pathFor(key);
    if (!(await this.#fs.exists(path))) return null;
    return { body: await this.#fs.readFile(path), metadata };
  }

  /** Object keys under a prefix. Metadata sidecars are storage, not objects. */
  async list(prefix: string): Promise<readonly string[]> {
    // listFiles() returns forward-slash paths; baseDir may not be, so strip a
    // root that actually matches rather than leaking absolute paths as keys.
    const root = `${this.baseDir.replace(/\\/g, '/')}/`;
    const paths = await this.#fs.listFiles(this.pathFor(prefix));
    return paths
      .filter((path) => !path.endsWith('.meta.json'))
      .map((path) => (path.startsWith(root) ? path.slice(root.length) : path))
      .sort();
  }

  /** Removes the bytes and their sidecar together: half an object is worse than none. */
  async delete(key: string): Promise<void> {
    await this.#fs.remove(this.pathFor(key));
    await this.#fs.remove(this.pathFor(artifactMetadataKey(key)));
  }

  /** Write time of an object, for age-guarded orphan sweeps. */
  modifiedAt(key: string): Promise<number | null> {
    return this.#fs.modifiedAt(this.pathFor(key));
  }
}
