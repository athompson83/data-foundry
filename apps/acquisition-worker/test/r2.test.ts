import { describe, expect, it } from 'vitest';
import { createR2ObjectClient, type R2BucketBinding } from '../src/r2.js';

describe('native R2 adapter', () => {
  it('maps metadata, bytes, pagination, and deletion without an SDK', async () => {
    const calls: string[] = [];
    const bucket: R2BucketBinding = {
      head: () => Promise.resolve({ size: 3, customMetadata: { x: 'y' } }),
      get: () => Promise.resolve({ size: 3, customMetadata: { x: 'y' }, bytes: () => Promise.resolve(new Uint8Array([1, 2, 3])) }),
      put: (key) => { calls.push(`put:${key}`); return Promise.resolve({}); },
      list: ({ cursor }) => Promise.resolve(
        cursor === undefined
          ? { objects: [{ key: 'b' }], truncated: true, cursor: 'next' }
          : { objects: [{ key: 'a' }], truncated: false },
      ),
      delete: (key) => { calls.push(`delete:${key}`); return Promise.resolve(); },
    };
    const client = createR2ObjectClient(bucket);
    expect((await client.getObject({ bucket: 'raw', key: 'x' }))?.body).toEqual(new Uint8Array([1, 2, 3]));
    await client.putObject({ bucket: 'raw', key: 'x', body: new Uint8Array([1]), contentType: 'text/plain', metadata: {} });
    expect(await client.listObjects({ bucket: 'raw', prefix: '' })).toEqual(['a', 'b']);
    await client.deleteObject({ bucket: 'raw', key: 'x' });
    expect(calls).toEqual(['put:x', 'delete:x']);
  });
});
