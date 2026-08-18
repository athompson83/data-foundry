import type { StorageUri } from '@data-foundry/canonical-schema';
import { nodeFileSystem, type WritableFileSystem } from '../fs.js';
import { ArtifactStoreError } from '../errors.js';
import {
  storeArtifactBytes,
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
 * Same key layout as R2 (`raw/{vertical}/{source}/{yyyy}/{mm}/{dd}/{hash}`),
 * rooted at `.data` — so an offline pipeline run produces a tree that can be
 * diffed against, or uploaded to, the real bucket without rewriting keys.
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
      return JSON.parse(new TextDecoder().decode(raw)) as ArtifactMetadata;
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
}
