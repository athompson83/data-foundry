/**
 * In-memory raw evidence store.
 *
 * `@data-foundry/acquisition` ships an R2 adapter and a local-disk adapter. CI
 * needs a third: identical semantics, no filesystem. It is built on the
 * package's own `storeArtifactBytes`, so content-addressing and the
 * "identical bytes are never written twice" rule are inherited rather than
 * re-implemented — an artifact store that got either of those wrong would make
 * every idempotency assertion downstream meaningless.
 */
import {
  parseArtifactContentKey,
  storeArtifactBytes,
  type ArtifactBody,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactStore,
  type StoredArtifact,
} from '@data-foundry/acquisition';
import type { StorageUri } from '@data-foundry/canonical-schema';

export class InMemoryArtifactStore implements ArtifactStore {
  readonly scheme = 'memory';
  readonly #bodies = new Map<string, Uint8Array>();
  readonly #metadata = new Map<string, ArtifactMetadata>();
  readonly #writtenAt = new Map<string, number>();
  /** Write time, injectable so an age-guarded sweep is testable without sleeping. */
  clock: () => number = () => Date.now();

  uriFor(key: string): StorageUri {
    return `memory://${key}`;
  }

  put(request: ArtifactPutRequest): Promise<StoredArtifact> {
    return storeArtifactBytes(
      {
        readHead: (key) => this.head(key),
        exists: (key) => Promise.resolve(this.#bodies.has(key)),
        write: (key, body, metadata) => {
          this.#bodies.set(key, body);
          this.#metadata.set(key, metadata);
          this.#writtenAt.set(key, this.clock());
          return Promise.resolve();
        },
      },
      (key) => this.uriFor(key),
      request,
    );
  }

  head(key: string): Promise<ArtifactMetadata | null> {
    return Promise.resolve(this.#metadata.get(key) ?? null);
  }

  get(key: string): Promise<ArtifactBody | null> {
    const body = this.#bodies.get(key);
    const metadata = this.#metadata.get(key);
    if (body === undefined || metadata === undefined) return Promise.resolve(null);
    return Promise.resolve({ body, metadata });
  }

  list(prefix: string): Promise<readonly string[]> {
    return Promise.resolve(this.keys().filter((key) => key.startsWith(prefix)));
  }

  delete(key: string): Promise<void> {
    this.#bodies.delete(key);
    this.#metadata.delete(key);
    this.#writtenAt.delete(key);
    return Promise.resolve();
  }

  modifiedAt(key: string): Promise<number | null> {
    return Promise.resolve(this.#writtenAt.get(key) ?? null);
  }

  /** Every stored key. Test affordance for asserting the raw-evidence tree. */
  keys(): readonly string[] {
    return [...this.#bodies.keys()].sort();
  }

  /**
   * Only the keys that hold artifact *bytes*, as opposed to the retrieval
   * records that say when those bytes were last re-checked. Counting the two
   * together is how 100% storage amplification hid behind a passing test.
   */
  contentKeys(): readonly string[] {
    return this.keys().filter((key) => parseArtifactContentKey(key) !== null);
  }

  get size(): number {
    return this.#bodies.size;
  }
}
