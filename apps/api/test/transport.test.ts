/**
 * The socket adapter carries the contract unchanged.
 *
 * `app.ts` is tested without a port everywhere else, which is the point of
 * separating them — but "the handler is right" and "the server sends what the
 * handler decided" are two claims, and only one of them was being tested. This
 * suite makes the second one real: a loopback listener on an OS-assigned port,
 * driven with `node:http`, entirely offline.
 *
 * `node:http` is used as the client too, rather than `fetch`, so no proxy or
 * agent configuration can sit between the assertion and the adapter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { ApiError } from '../src/errors.js';
import type { ApiHandler } from '../src/http.js';
import { startApiServer, type ListeningApiServer } from '../src/server.js';
import { createApiFixtures, ts, type ApiFixtures } from './support.js';
import {
  entityQualityScore,
  type Entity,
} from '../../../packages/canonical-schema/src/index.js';

let fixtures: ApiFixtures;
let listening: ListeningApiServer;
/** Merged into the surviving equipment, so its id answers 301 over the wire. */
let merged: Entity;

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/**
 * One request over a real socket. `target` defaults to the suite's server; the
 * adapter's own failure path needs a second one in front of a handler that
 * throws, and it must be driven exactly the same way to mean anything.
 */
function send(path: string, method = 'GET', target: ListeningApiServer = listening): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      { host: target.host, port: target.port, path, method },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    call.on('error', reject);
    call.end();
  });
}

beforeAll(async () => {
  fixtures = await createApiFixtures();
  listening = await startApiServer(fixtures.app);

  // A merged-away id, because the 301 it produces is the one response on this
  // surface whose meaning lives in a HEADER rather than in the body, and a
  // status line the transport rewrote or a `location` it dropped would leave a
  // client following nothing.
  merged = await fixtures.store.upsertEntity({
    vertical_id: fixtures.vertical.id,
    entity_type: 'equipment',
    canonical_name: 'Carrier Infinity 24ANB7 (duplicate)',
    canonical_slug: 'carrier-infinity-24anb7-transport-dup',
    status: 'ACTIVE',
    quality_score: entityQualityScore(0.4),
    first_seen_at: ts('2026-01-01T00:00:00Z'),
    last_verified_at: null,
  });
  await fixtures.store.mergeEntities({
    from_entity_id: merged.id,
    to_entity_id: fixtures.equipment.id,
    reason: 'MERGE',
    from_slug: merged.canonical_slug,
    judgment_id: null,
  });
}, 300_000);

afterAll(async () => {
  await listening?.close();
  await fixtures?.driver.close();
});

describe('the node:http adapter', () => {
  it('binds an OS-assigned loopback port', () => {
    expect(listening.host).toBe('127.0.0.1');
    expect(listening.port).toBeGreaterThan(0);
  });

  it('serves the handler’s status, headers and body verbatim', async () => {
    const response = await send('/v1/health');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['x-api-version']).toBe('v1');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(response.body)).toMatchObject({ status: 'ok', version: 'v1' });
  });

  it('sends a content-length that matches the bytes it sent', async () => {
    const response = await send(`/v1/entities/${fixtures.equipment.id}`);
    expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(response.body));
  });

  it('answers HEAD with GET’s headers and no body', async () => {
    const get = await send('/v1/health');
    const head = await send('/v1/health', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    // Same content-length as the GET: a HEAD that reported 0 would lie about
    // the resource it is describing.
    expect(head.headers['content-length']).toBe(get.headers['content-length']);
  });

  it('carries the error envelope and its Allow header over the wire', async () => {
    const response = await send('/v1/health', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('GET, HEAD');
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: 'METHOD_NOT_ALLOWED', status: 405 },
    });
  });

  it('does not follow its own redirects — the 301 reaches the client', async () => {
    // The name of this test was right and its assertion was about something
    // else entirely: it fetched an unrouted path and checked for a 404, which
    // is a routing property with no redirect in it (that check now lives below,
    // under its own name). What it claimed to cover is this — the adapter
    // hands a merged-away id's 301 to the client rather than resolving it
    // internally and answering 200 with the surviving entity, which would make
    // a merge invisible to exactly the consumer that needs to see it.
    //
    // `node:http` does not follow redirects on its own, unlike `fetch`, so what
    // arrives here is what the adapter actually sent.
    const response = await send(`/v1/entities/${merged.id}`);
    expect(response.status).toBe(301);
    expect(response.headers['location']).toBe(`/v1/entities/${fixtures.equipment.id}`);
    // The hop chain is in the body, for a client that does not follow it.
    expect(JSON.parse(response.body)).toMatchObject({
      redirect: {
        status: 301,
        location: `/v1/entities/${fixtures.equipment.id}`,
        canonicalEntityId: fixtures.equipment.id,
      },
    });
    expect(Number(response.headers['content-length'])).toBe(Buffer.byteLength(response.body));
  });

  it('carries a routing failure over the wire as the envelope, not a socket error', async () => {
    const response = await send('/v1/nope');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: 'ROUTE_NOT_FOUND', status: 404 },
    });
  });

  it('reports a malformed percent-escape as the client’s error, not the server’s', async () => {
    // Reached over a socket because a raw `%ZZ` cannot survive being written as
    // a JavaScript string literal and passed to the handler directly — the
    // in-process suites all hand the router an already-valid target.
    const response = await send('/v1/entities/%ZZ');
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: 'INVALID_PARAMETER', status: 400 },
    });
  });

  it('never sends a status the body disagrees with', async () => {
    // Every response this adapter sends says its status twice: once in the
    // status line and once inside the envelope. They are only a contract if
    // they are the same number, so it is asserted against itself rather than
    // against a literal, on the answers a client actually meets.
    for (const [path, method] of [
      ['/v1/health', 'GET'],
      ['/v1/nope', 'GET'],
      ['/v1/health', 'POST'],
      ['/v1/entities/%ZZ', 'GET'],
      ['/v2/health', 'GET'],
    ] as const) {
      const response = await send(path, method);
      const body = JSON.parse(response.body) as { error?: { status: number } };
      if (body.error === undefined) continue;
      expect(response.status, `${method} ${path}`).toBe(body.error.status);
    }
  });
});

/**
 * The one place the TRANSPORT, not the app, decides a status.
 *
 * `createApiApp` funnels its own failures into a response, so reaching the
 * adapter's `catch` means the handler threw outright — an `onError` hook that
 * failed inside the app's own error path, or a second handler composed in front
 * of it, `createApiServer` taking an `ApiHandler` precisely so that is possible.
 * Rare, and that is the problem: it was the only path where the status line and
 * the envelope were decided separately, and they only agreed by luck. The body
 * came from `toErrorBody`, which honours an `ApiError`'s own status, while the
 * status line was a literal 500 written five lines earlier — so a thrown 503
 * left over a socket as `500` with `{"status": 503}` inside it, and a client
 * branching on either one was told a different thing about the same failure.
 */
describe('a handler that throws instead of returning a response', () => {
  const serve = async (
    handler: ApiHandler,
    assertions: (response: RawResponse) => void,
  ): Promise<void> => {
    const target = await startApiServer(handler);
    try {
      assertions(await send('/v1/health', 'GET', target));
    } finally {
      await target.close();
    }
  };

  it('sends the status the envelope it is sending claims', async () => {
    await serve(
      () => Promise.reject(new ApiError('SERVICE_UNAVAILABLE', 'The query layer is not reachable.')),
      (response) => {
        const body = JSON.parse(response.body) as { error: { code: string; status: number } };
        expect(body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 });
        expect(response.status).toBe(body.error.status);
      },
    );
  });

  it('still collapses a throwable nobody anticipated to 500, in both places', async () => {
    // The other direction: deriving the status from the envelope must not start
    // trusting whatever was thrown. A bare `Error` carries no status, so the
    // envelope says 500 and so does the status line.
    await serve(
      () => Promise.reject(new Error('pglite: connection closed at /src/driver.ts:41')),
      (response) => {
        const body = JSON.parse(response.body) as { error: { code: string; status: number } };
        expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
        expect(response.status).toBe(body.error.status);
        // The thrown text named a driver, a file and a line; none of it left.
        expect(response.body.toLowerCase()).not.toContain('pglite');
        expect(response.body).not.toContain('.ts:');
      },
    );
  });
});

describe('an answer this adapter cannot put on the wire', () => {
  /**
   * The failure this covers is not a wrong answer; it is NO answer.
   *
   * `JSON.stringify`, the content-length computation and `writeHead` all sat
   * outside the `try`, and `respond` is invoked as `void respond(...)`. So a
   * body that cannot be serialized — a cycle, a `BigInt` — or a header value
   * `node:http` refuses made `respond` reject with nothing listening, and the
   * socket stayed open until the client's own timeout. No status, no envelope,
   * no log: the one shape of failure a caller cannot tell from a hung network.
   *
   * That such a body is itself a bug upstream is exactly why this matters. A
   * transport's job is to answer, and "the layer above me is broken" is an
   * answer it is still able to give.
   */
  const serverFor = async (body: unknown): Promise<ListeningApiServer> =>
    startApiServer(async () => ({ status: 200, headers: {}, body }));

  /**
   * `send` with a deadline, because the failure under test is a socket that
   * never answers. Without one the assertion cannot fail — the test hangs
   * instead, which in CI is a job that burns its whole budget and reports a
   * timeout rather than the defect. Two seconds is far longer than a loopback
   * answer needs and far shorter than any runner's patience.
   */
  const sendBounded = async (target: ListeningApiServer): Promise<RawResponse> => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the adapter never answered')), 2_000);
    });
    try {
      return await Promise.race([send('/v1/health', 'GET', target), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  it('answers 500 rather than hanging on a body that will not serialize', async () => {
    const cyclic: Record<string, unknown> = { entity: 'carrier' };
    cyclic['self'] = cyclic;
    const target = await serverFor(cyclic);
    try {
      const response = await sendBounded(target);
      expect(response.status).toBe(500);
      expect(JSON.parse(response.body)).toMatchObject({
        error: { code: 'INTERNAL_ERROR', status: 500 },
      });
      // The envelope it falls back to must itself be serializable, or the
      // recovery has the same bug as the thing it is recovering from.
      expect(response.headers['content-length']).toBe(
        String(Buffer.byteLength(response.body)),
      );
    } finally {
      await target.close();
    }
  });

  it('answers rather than hanging on a value JSON cannot represent', async () => {
    const target = await serverFor({ tonnage: BigInt(3) });
    try {
      const response = await sendBounded(target);
      expect(response.status).toBe(500);
      expect(JSON.parse(response.body).error.code).toBe('INTERNAL_ERROR');
    } finally {
      await target.close();
    }
  });

  it('leaks nothing about why it could not answer', async () => {
    // A serialization failure quotes the offending structure in its message.
    const cyclic: Record<string, unknown> = { secret: 'postgres://user:hunter2@db.internal' };
    cyclic['self'] = cyclic;
    const target = await serverFor(cyclic);
    try {
      const response = await sendBounded(target);
      expect(response.body).not.toContain('hunter2');
      expect(response.body).not.toContain('circular');
      expect(response.body).not.toContain('Converting');
    } finally {
      await target.close();
    }
  });

  it('still sends an ordinary answer, so the guard has not swallowed the happy path', async () => {
    const target = await serverFor({ ok: true });
    try {
      const response = await sendBounded(target);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
    } finally {
      await target.close();
    }
  });
});
