import type { StorageUri } from '@data-foundry/canonical-schema';
import { AcquisitionConfigurationError } from '../errors.js';
import {
  metadataFromRecord,
  metadataToRecord,
  storeArtifactBytes,
  type ArtifactBody,
  type ArtifactMetadata,
  type ArtifactPutRequest,
  type ArtifactStore,
  type StoredArtifact,
} from './artifact-store.js';

/**
 * R2 raw evidence store, written against the S3-compatible object contract
 * rather than against a specific SDK.
 *
 * The client is injected, so this file typechecks and unit-tests with no
 * credentials, no network and no `@aws-sdk` dependency; production wires in a
 * thin adapter over `S3Client` or the Workers R2 binding. Keeping the surface at
 * three methods is deliberate — anything richer would start encoding R2
 * specifics into a store the pipeline is supposed to be able to swap.
 */

export interface S3ObjectHead {
  readonly contentLength: number;
  readonly contentType?: string | undefined;
  readonly metadata?: Readonly<Record<string, string>> | undefined;
}

export interface S3ObjectBody extends S3ObjectHead {
  readonly body: Uint8Array;
}

export interface S3PutObjectInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface S3CompatibleObjectClient {
  /** Resolve to `null` for a missing key rather than throwing. */
  headObject(input: { readonly bucket: string; readonly key: string }): Promise<S3ObjectHead | null>;
  putObject(input: S3PutObjectInput): Promise<void>;
  getObject(input: { readonly bucket: string; readonly key: string }): Promise<S3ObjectBody | null>;
}

export interface R2ArtifactStoreOptions {
  readonly bucket: string;
  readonly client: S3CompatibleObjectClient;
  /** Optional key prefix, e.g. a per-environment namespace. */
  readonly prefix?: string | undefined;
}

export class R2ArtifactStore implements ArtifactStore {
  readonly scheme = 'r2';
  readonly bucket: string;
  readonly #client: S3CompatibleObjectClient;
  readonly #prefix: string;

  constructor(options: R2ArtifactStoreOptions) {
    if (options.bucket.trim() === '') {
      throw new AcquisitionConfigurationError('R2ArtifactStore requires a bucket name.');
    }
    this.bucket = options.bucket;
    this.#client = options.client;
    this.#prefix = (options.prefix ?? '').replace(/^\/+|\/+$/g, '');
  }

  uriFor(key: string): StorageUri {
    return `r2://${this.bucket}/${this.#absolute(key)}`;
  }

  put(request: ArtifactPutRequest): Promise<StoredArtifact> {
    return storeArtifactBytes(
      {
        readHead: (key) => this.head(key),
        write: async (key, body, metadata) => {
          await this.#client.putObject({
            bucket: this.bucket,
            key: this.#absolute(key),
            body,
            contentType: metadata.mime_type,
            metadata: metadataToRecord(metadata),
          });
        },
      },
      (key) => this.uriFor(key),
      request,
    );
  }

  async head(key: string): Promise<ArtifactMetadata | null> {
    const head = await this.#client.headObject({ bucket: this.bucket, key: this.#absolute(key) });
    if (head === null) return null;
    return metadataFromRecord(head.metadata);
  }

  async get(key: string): Promise<ArtifactBody | null> {
    const object = await this.#client.getObject({ bucket: this.bucket, key: this.#absolute(key) });
    if (object === null) return null;
    const metadata = metadataFromRecord(object.metadata);
    if (metadata === null) return null;
    return { body: object.body, metadata };
  }

  #absolute(key: string): string {
    return this.#prefix === '' ? key : `${this.#prefix}/${key}`;
  }
}

/**
 * In-memory S3-compatible client. Not a mock: it is the store CI uses to prove
 * the R2 adapter's idempotency and key layout without credentials.
 */
export class InMemoryObjectClient implements S3CompatibleObjectClient {
  readonly #objects = new Map<string, S3ObjectBody>();
  /** Every `putObject` call, in order — lets a test assert that a dedupe wrote nothing. */
  readonly writes: string[] = [];

  headObject(input: { bucket: string; key: string }): Promise<S3ObjectHead | null> {
    return Promise.resolve(this.#objects.get(this.#id(input)) ?? null);
  }

  putObject(input: S3PutObjectInput): Promise<void> {
    const id = this.#id(input);
    this.writes.push(id);
    this.#objects.set(id, {
      body: input.body,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
      metadata: input.metadata,
    });
    return Promise.resolve();
  }

  getObject(input: { bucket: string; key: string }): Promise<S3ObjectBody | null> {
    return Promise.resolve(this.#objects.get(this.#id(input)) ?? null);
  }

  keys(): readonly string[] {
    return [...this.#objects.keys()].sort();
  }

  get size(): number {
    return this.#objects.size;
  }

  #id(input: { bucket: string; key: string }): string {
    return `${input.bucket}/${input.key}`;
  }
}
