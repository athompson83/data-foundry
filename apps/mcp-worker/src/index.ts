/** Deployable Cloudflare Streamable HTTP adapter for the pure MCP contract. */
import { authenticate, type AuthFailure } from '@data-foundry/access-auth';
import { buildUsageEvent, type UsageEvent } from '@data-foundry/usage-events';
import { validateHostHeader } from '@modelcontextprotocol/server';
import {
  getMcpDeployment,
  resetMcpDeployments,
  type BuildMcpDeploymentOptions,
  type McpWorkerRuntime,
} from './composition.js';
import {
  McpWorkerConfigurationError,
  resolveMcpWorkerConfig,
  type McpWorkerEnv,
} from './env.js';
import { guardProtocolRequest, type McpRouteKey } from './protocol.js';
import { MCP_RUNTIMES } from '../generated/runtime-registry.js';

export {
  getMcpDeployment,
  resetMcpDeployments,
  type BuildMcpDeploymentOptions,
  type McpDeployment,
  type McpWorkerRuntime,
} from './composition.js';
export {
  McpWorkerConfigurationError,
  resolveMcpWorkerConfig,
  type DeploymentEnvironment,
  type HyperdriveBinding,
  type McpWorkerEnv,
  type QueueBinding,
  type ResolvedMcpWorkerConfig,
} from './env.js';
export { MAX_MCP_BODY_BYTES, MCP_PROTOCOL_VERSION, type McpRouteKey } from './protocol.js';
export { BUNDLED_MCP_VERTICALS, MCP_RUNTIMES } from '../generated/runtime-registry.js';

interface RpcError {
  readonly code: number;
  readonly message: string;
}

function rpcError(
  status: number,
  error: RpcError,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const serialized = JSON.stringify({ jsonrpc: '2.0', id: null, error });
  return new Response(serialized, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(new TextEncoder().encode(serialized).byteLength),
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

const forbidden = (): Response => rpcError(403, { code: -32002, message: 'Forbidden.' });
const unauthorized = (): Response => rpcError(401, { code: -32001, message: 'Unauthorized.' });
const protocolFailure = (status: number): Response =>
  rpcError(status, { code: -32600, message: 'Invalid request.' });
const unavailable = (): Response =>
  rpcError(503, { code: -32003, message: 'Service unavailable.' }, { 'retry-after': '30' });

const AUTHENTICATION_FAILURES = new Set<AuthFailure['reason']>([
  'MISSING_CREDENTIAL',
  'MALFORMED_CREDENTIAL',
  'UNKNOWN_KEY',
  'REVOKED',
  'EXPIRED',
  'WRONG_ENVIRONMENT',
]);

function authFailure(failure: AuthFailure): Response {
  return AUTHENTICATION_FAILURES.has(failure.reason) ? unauthorized() : forbidden();
}

function validOrigin(request: Request, allowed: ReadonlySet<string>): boolean {
  const value = request.headers.get('origin');
  if (value === null) return true;
  try {
    const parsed = new URL(value);
    return parsed.origin === value && allowed.has(value);
  } catch {
    return false;
  }
}

function validHost(request: Request, hostname: string): boolean {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.hostname.toLowerCase() !== hostname) return false;
  return validateHostHeader(request.headers.get('host'), [hostname]).ok;
}

async function publishUsage(env: McpWorkerEnv, event: UsageEvent): Promise<void> {
  if (env.USAGE_EVENTS_QUEUE === undefined) throw new Error('usage queue is not bound');
  await env.USAGE_EVENTS_QUEUE.send(event);
}

interface AuthenticatedUsage {
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly verticalId: string;
  readonly accessTier: 'MCP';
  readonly billingSource: 'NONE';
}

async function meterResponse(
  response: Response,
  env: McpWorkerEnv,
  auth: AuthenticatedUsage,
  routeKey: McpRouteKey,
  startedAt: number,
): Promise<Response> {
  const event = buildUsageEvent({
    tenantId: auth.tenantId,
    apiKeyId: auth.apiKeyId,
    verticalId: auth.verticalId,
    routeKey,
    method: 'POST',
    status: response.status,
    rowsServed: 0,
    durationMs: Math.max(0, Date.now() - startedAt),
    accessTier: auth.accessTier,
    billingSource: auth.billingSource,
  });
  try {
    await publishUsage(env, event);
    return response;
  } catch {
    // Do not log the platform error: an adapter or test double may include
    // request material in its message. Fixed server-created values are enough
    // to correlate the failed handoff.
    console.error('[mcp-worker] usage event publish failed', {
      eventId: event.id,
      routeKey: event.route_key,
    });
    await response.body?.cancel().catch(() => undefined);
    return unavailable();
  }
}

export interface McpServeOptions {
  readonly openDriver?: BuildMcpDeploymentOptions['openDriver'];
  /** Test/compiler seam; deployed requests always use the generated registry. */
  readonly runtime?: McpWorkerRuntime;
}

export async function serveMcpRequest(
  request: Request,
  env: McpWorkerEnv,
  options: McpServeOptions = {},
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const config = resolveMcpWorkerConfig(env);
    if (!validHost(request, config.hostname) || !validOrigin(request, config.allowedOrigins)) {
      return forbidden();
    }

    const runtime = options.runtime ?? MCP_RUNTIMES[config.verticalSlug];
    if (runtime === undefined) {
      throw new McpWorkerConfigurationError('No compiled MCP runtime exists for this vertical.');
    }
    const url = new URL(request.url);
    if (url.pathname !== runtime.server.endpoint || url.search !== '' || url.hash !== '') {
      return rpcError(404, { code: -32601, message: 'Not found.' });
    }

    const deployment = await getMcpDeployment({
      env,
      runtime,
      ...(options.openDriver === undefined ? {} : { openDriver: options.openDriver }),
      onToolError: (context) => {
        console.error('[mcp-worker] tool execution failed', context);
      },
      onProtocolError: () => {
        console.error('[mcp-worker] SDK protocol failure');
      },
    });
    const auth = await authenticate(deployment.driver, request.headers.get('authorization'), {
      verticalId: deployment.verticalId,
      environment: config.apiKeyEnvironment,
      expectedBillingSource: 'NONE',
      now: new Date(),
    });
    if (!auth.ok) return authFailure(auth);
    // The closed classification vocabulary makes NONE exactly MCP/NONE. Keep
    // the explicit check here so a future vocabulary expansion cannot silently
    // broaden this adapter's credential class.
    if (auth.accessTier !== 'MCP' || auth.billingSource !== 'NONE') return forbidden();
    const mcpAuth: AuthenticatedUsage = {
      tenantId: auth.tenantId,
      apiKeyId: auth.apiKeyId,
      verticalId: auth.verticalId,
      accessTier: auth.accessTier,
      billingSource: auth.billingSource,
    };

    if (request.method.toUpperCase() !== 'POST') {
      return rpcError(
        405,
        { code: -32600, message: 'Method not allowed.' },
        { allow: 'POST' },
      );
    }

    const guarded = await guardProtocolRequest(request);
    if (!guarded.ok) {
      return await meterResponse(
        protocolFailure(guarded.status),
        env,
        mcpAuth,
        'mcp.protocol_failure',
        startedAt,
      );
    }

    const response = await deployment.handler.fetch(request, { parsedBody: guarded.parsedBody });
    if (guarded.notification) return response;
    const routeKey = guarded.routeKey ?? 'mcp.protocol_failure';
    return await meterResponse(response, env, mcpAuth, routeKey, startedAt);
  } catch (error) {
    console.error(
      error instanceof McpWorkerConfigurationError
        ? '[mcp-worker] configuration unavailable'
        : '[mcp-worker] startup unavailable',
    );
    return unavailable();
  }
}

export default {
  fetch: (request: Request, env: McpWorkerEnv): Promise<Response> =>
    serveMcpRequest(request, env),
};
