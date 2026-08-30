/**
 * The only file that knows what a socket is.
 *
 * `node:http` and nothing else — no framework, per AGENTS.md's scope control.
 * Everything interesting (routing, status codes, the error envelope) lives in
 * `app.ts` and is exercised without binding a port; this adapter's whole job is
 * `IncomingMessage` → `ApiRequest` and `ApiResponse` → `ServerResponse`. Keeping
 * it that thin is what makes a second transport (a Cloudflare `fetch` handler)
 * a new adapter rather than a second copy of the API.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toErrorBody, type ApiErrorBody } from './errors.js';
import {
  JSON_CONTENT_TYPE,
  type ApiHandler,
  type ApiRequest,
  type ApiRequestAccess,
} from './http.js';

/**
 * The response this adapter sends when it has no handler answer to send.
 *
 * Status line and envelope come out of one call, because they are one decision.
 * They used to be two: the body came from `toErrorBody`, which honours an
 * `ApiError`'s own status, while the status line was a literal 500 written
 * above the `try` — so a handler that threw a 503 was sent as `500` carrying
 * `{"status": 503}`, and a client had two answers and no rule for choosing
 * between them. `toErrorBody` already decides what the failure IS; reading the
 * status back out of it is what makes the two impossible to disagree, rather
 * than a pair of literals someone has to remember to change together.
 */
function transportFailure(error: unknown): { readonly status: number; readonly body: ApiErrorBody } {
  const body = toErrorBody(error);
  return { status: body.error.status, body };
}

function toApiRequest(message: IncomingMessage): ApiRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? (value[0] ?? '') : value;
  }
  return { method: message.method ?? 'GET', url: message.url ?? '/', headers };
}

async function respond(
  handler: ApiHandler,
  message: IncomingMessage,
  response: ServerResponse,
  access?: ApiRequestAccess,
): Promise<void> {
  // This surface reads; it never accepts a payload. Draining rather than
  // ignoring keeps a client that sent one from stalling on backpressure.
  message.resume();

  const unanswered = transportFailure(new Error('handler did not run'));
  let status = unanswered.status;
  let headers: Record<string, string> = { 'content-type': JSON_CONTENT_TYPE };
  let body: unknown = unanswered.body;
  try {
    const result = await handler(toApiRequest(message), undefined, access);
    status = result.status;
    headers = { ...result.headers };
    body = result.body;
  } catch (error) {
    // `createApiApp` funnels its own failures, so reaching here means the
    // handler itself threw. Still an envelope, never a stack trace — and the
    // status line is taken from that envelope, not decided a second time.
    const failure = transportFailure(error);
    status = failure.status;
    body = failure.body;
  }

  // Serializing and writing are inside the guard too, and that is the point.
  //
  // They used to sit below it, and `respond` is invoked as `void respond(...)`.
  // So a body that will not serialize — a cycle, a `BigInt` — or a header value
  // `node:http` refuses made this function reject with nothing listening: no
  // status, no envelope, no log, and a socket held open until the client's own
  // timeout. That is the one failure a caller cannot tell apart from a dead
  // network, and it is worse than any wrong answer.
  //
  // Such a body is a bug upstream. It is still this adapter's job to answer:
  // "the layer above me is broken" is a thing a transport can say.
  try {
    write(response, message, status, headers, body);
  } catch {
    // What keeps the caller's side of this safe is `toErrorBody`, which
    // replaces any non-`ApiError` message with the opaque one — a
    // serialization failure quotes the structure that failed, and a
    // `writeHead` failure quotes the header value, so neither may be
    // forwarded. Verified: passing the real cause here instead changes no
    // assertion, because that substitution is what does the work.
    //
    // A fresh `Error` is used anyway, so the fallback envelope is built from a
    // value known to serialize rather than from the one that just did not.
    //
    // HONEST GAP: the cause is then dropped. `createApiApp` has an `onError`
    // operator channel, but it sits above this adapter and cannot see a
    // failure that happens while writing. An operator sees a 500 with no
    // reason. Wiring one through `createApiServer` is a real improvement and a
    // wider change than this fix.
    const failure = transportFailure(new Error('response could not be serialized'));
    if (response.headersSent) {
      // Past the point of an envelope: bytes are already on the wire and the
      // declared content-length is now a lie. Ending the socket is the only
      // honest signal left — a truncated response a client can detect, rather
      // than one it waits on forever.
      response.destroy();
      return;
    }
    write(response, message, failure.status, { 'content-type': JSON_CONTENT_TYPE }, failure.body);
  }
}

/** Status line, content-length and body, or it throws and nothing was sent. */
function write(
  response: ServerResponse,
  message: IncomingMessage,
  status: number,
  headers: Record<string, string>,
  body: unknown,
): void {
  const payload = JSON.stringify(body ?? null);
  // `JSON.stringify` returns undefined for a value it cannot represent at the
  // top level — a bare `undefined`, a function, a symbol. `'null'` is the
  // honest rendering, and it keeps content-length truthful.
  const text = payload ?? 'null';
  response.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(text)) });
  // HEAD carries GET's headers, including content-length, and no body.
  response.end((message.method ?? 'GET').toUpperCase() === 'HEAD' ? undefined : text);
}

export function createApiServer(handler: ApiHandler, access?: ApiRequestAccess): Server {
  return createServer((message, response) => {
    void respond(handler, message, response, access);
  });
}

export interface ListeningApiServer {
  readonly server: Server;
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

/**
 * Bind and listen. `port: 0` asks the OS for a free port, which is what tests
 * use — a fixed port makes a suite fail on whatever else happens to be running.
 */
export function startApiServer(
  handler: ApiHandler,
  options: {
    readonly port?: number;
    readonly host?: string;
    /** Trusted deployment identity. Never inferred from an HTTP header. */
    readonly access?: ApiRequestAccess;
  } = {},
): Promise<ListeningApiServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createApiServer(handler, options.access);
  return new Promise<ListeningApiServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address() as AddressInfo | null;
      resolve({
        server,
        port: address?.port ?? 0,
        host,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
          }),
      });
    });
  });
}
