import { mintApiKey, type ApiAccessTier, type ApiBillingSource } from '@data-foundry/api-keys';
import type { QueryFixtures } from '../../../packages/query-model/test/support.js';
import type { UsageEvent } from '@data-foundry/usage-events';
import {
  MCP_RUNTIMES,
  type McpWorkerEnv,
  type McpWorkerRuntime,
  type QueueBinding,
} from '../src/index.js';
import { HVAC_FIELDS } from '../../../packages/query-model/test/support.js';

export const PROTOCOL_VERSION = '2026-07-28';
export const HOSTNAME = 'mcp.example.test';
export const ORIGIN = 'https://client.example.test';

export const fixtureRuntime: McpWorkerRuntime = {
  ...(MCP_RUNTIMES['hvac'] as McpWorkerRuntime),
  // Query fixtures intentionally have a compact field vocabulary. The seam
  // proves the adapter delegates to that compiled vocabulary rather than
  // importing test-only HVAC behavior into production code.
  fields: HVAC_FIELDS,
  canonical_url_prefix: '/data/hvac',
};

export interface SeededKey {
  readonly secret: string;
  readonly tenantId: string;
  readonly apiKeyId: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
}

export async function seedKey(
  fixtures: QueryFixtures,
  slug: string,
  options: {
    readonly accessTier?: ApiAccessTier;
    readonly billingSource?: ApiBillingSource;
    readonly verticalId?: string;
    readonly environment?: 'live' | 'test';
  } = {},
): Promise<SeededKey> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status)
     values ($1, $1, 'ACTIVE') returning id`,
    [slug],
  );
  if (tenant === undefined) throw new Error('tenant insert returned no row');

  const minted = await mintApiKey(options.environment ?? 'test');
  const [key] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      tenant.id,
      minted.tokenHash,
      minted.tokenPrefix,
      `${slug} key`,
      options.verticalId ?? fixtures.vertical.id,
      options.accessTier ?? 'MCP',
      options.billingSource ?? 'NONE',
    ],
  );
  if (key === undefined) throw new Error('key insert returned no row');
  return {
    secret: minted.secret,
    tenantId: tenant.id,
    apiKeyId: key.id,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
  };
}

export function recordingQueue(): { readonly queue: QueueBinding; readonly sent: UsageEvent[] } {
  const sent: UsageEvent[] = [];
  return {
    queue: {
      send: async (message: unknown) => {
        sent.push(message as UsageEvent);
      },
    },
    sent,
  };
}

export function envFor(queue?: QueueBinding): McpWorkerEnv {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    POSTGRES_URL: 'postgres://fixture/db',
    VERTICAL_SLUG: 'hvac',
    API_KEY_ENVIRONMENT: 'test',
    MCP_HOSTNAME: HOSTNAME,
    MCP_ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_ORIGIN: 'https://data.example.test',
    ...(queue === undefined ? {} : { USAGE_EVENTS_QUEUE: queue }),
  };
}

export function modernBody(
  method: string,
  params: Readonly<Record<string, unknown>> = {},
  id: string | number | null = 'request-1',
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    ...(id === null ? {} : { id }),
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
}

export function mcpRequest(
  secret: string | undefined,
  body: unknown,
  options: {
    readonly method?: string;
    readonly hostname?: string;
    readonly origin?: string | null;
    readonly contentType?: string;
    readonly accept?: string;
    readonly protocolVersion?: string | null;
    readonly methodHeader?: string | null;
    readonly nameHeader?: string | null;
    readonly url?: string;
  } = {},
): Request {
  const headers = new Headers({
    host: options.hostname ?? HOSTNAME,
    'content-type': options.contentType ?? 'application/json; charset=utf-8',
    accept: options.accept ?? 'application/json, text/event-stream',
  });
  if (secret !== undefined) headers.set('authorization', `Bearer ${secret}`);
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  if (options.protocolVersion !== null) {
    headers.set('mcp-protocol-version', options.protocolVersion ?? PROTOCOL_VERSION);
  }
  const record = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const bodyMethod = typeof record?.['method'] === 'string' ? record['method'] : undefined;
  if (options.methodHeader !== null && (options.methodHeader ?? bodyMethod) !== undefined) {
    headers.set('mcp-method', options.methodHeader ?? bodyMethod ?? '');
  }
  const params = record?.['params'];
  const bodyName = params !== null && typeof params === 'object' && !Array.isArray(params)
    ? (params as Record<string, unknown>)['name']
    : undefined;
  if (
    options.nameHeader !== null &&
    (options.nameHeader !== undefined || typeof bodyName === 'string')
  ) {
    headers.set('mcp-name', options.nameHeader ?? String(bodyName));
  }

  return new Request(options.url ?? `https://${HOSTNAME}/mcp`, {
    method: options.method ?? 'POST',
    headers,
    ...((options.method ?? 'POST') === 'GET' || (options.method ?? 'POST') === 'DELETE'
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

export function legacyInitialize(secret: string): Request {
  return mcpRequest(
    secret,
    {
      jsonrpc: '2.0',
      id: 'legacy-init',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fixture-client', version: '1.0.0' },
      },
    },
    { protocolVersion: null, methodHeader: null, nameHeader: null },
  );
}
