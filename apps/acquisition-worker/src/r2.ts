import type {
  S3CompatibleObjectClient,
  S3ObjectBody,
  S3ObjectHead,
  S3PutObjectInput,
} from '@data-foundry/acquisition';

export interface R2ObjectLike {
  readonly size: number;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  bytes(): Promise<Uint8Array>;
}

export interface R2ObjectsLike {
  readonly objects: readonly { readonly key: string }[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

export interface R2BucketBinding {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    body: Uint8Array,
    options: {
      readonly httpMetadata: { readonly contentType: string };
      readonly customMetadata: Readonly<Record<string, string>>;
    },
  ): Promise<unknown>;
  list(options: { readonly prefix: string; readonly cursor?: string }): Promise<R2ObjectsLike>;
  delete(key: string): Promise<void>;
}

const head = (object: R2ObjectLike): S3ObjectHead => ({
  contentLength: object.size,
  ...(object.httpMetadata?.contentType === undefined
    ? {}
    : { contentType: object.httpMetadata.contentType }),
  ...(object.customMetadata === undefined ? {} : { metadata: object.customMetadata }),
});

/** Thin native-R2 adapter for the acquisition package's storage contract. */
export function createR2ObjectClient(bucket: R2BucketBinding): S3CompatibleObjectClient {
  return {
    async headObject(input): Promise<S3ObjectHead | null> {
      const object = await bucket.head(input.key);
      return object === null ? null : head(object);
    },
    async getObject(input): Promise<S3ObjectBody | null> {
      const object = await bucket.get(input.key);
      return object === null ? null : { ...head(object), body: await object.bytes() };
    },
    async putObject(input: S3PutObjectInput): Promise<void> {
      await bucket.put(input.key, input.body, {
        httpMetadata: { contentType: input.contentType },
        customMetadata: input.metadata,
      });
    },
    async listObjects(input): Promise<readonly string[]> {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({
          prefix: input.prefix,
          ...(cursor === undefined ? {} : { cursor }),
        });
        keys.push(...page.objects.map(({ key }) => key));
        cursor = page.truncated ? page.cursor : undefined;
        if (page.truncated && cursor === undefined) {
          throw new Error('R2 returned a truncated page without a cursor');
        }
      } while (cursor !== undefined);
      return keys.sort();
    },
    async deleteObject(input): Promise<void> {
      await bucket.delete(input.key);
    },
  };
}
