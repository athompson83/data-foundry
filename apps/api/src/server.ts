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
import { JSON_CONTENT_TYPE, type ApiHandler, type ApiRequest } from './http.js';

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
): Promise<void> {
  // This surface reads; it never accepts a payload. Draining rather than
  // ignoring keeps a client that sent one from stalling on backpressure.
  message.resume();

  const unanswered = transportFailure(new Error('handler did not run'));
  let status = unanswered.status;
  let headers: Record<string, string> = { 'content-type': JSON_CONTENT_TYPE };
  let body: unknown = unanswered.body;
  try {
    const result = await handler(toApiRequest(message));
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

  const payload = JSON.stringify(body ?? null);
  headers['content-length'] = String(Buffer.byteLength(payload));
  response.writeHead(status, headers);
  // HEAD carries GET's headers, including content-length, and no body.
  response.end((message.method ?? 'GET').toUpperCase() === 'HEAD' ? undefined : payload);
}

export function createApiServer(handler: ApiHandler): Server {
  return createServer((message, response) => {
    void respond(handler, message, response);
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
  options: { readonly port?: number; readonly host?: string } = {},
): Promise<ListeningApiServer> {
  const host = options.host ?? '127.0.0.1';
  const server = createApiServer(handler);
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
