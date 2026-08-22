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
import { startApiServer, type ListeningApiServer } from '../src/server.js';
import { createApiFixtures, type ApiFixtures } from './support.js';

let fixtures: ApiFixtures;
let listening: ListeningApiServer;

interface RawResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function send(path: string, method = 'GET'): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const call = httpRequest(
      { host: listening.host, port: listening.port, path, method },
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
    const response = await send('/v1/nope');
    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
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
});
