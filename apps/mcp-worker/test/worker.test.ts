import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isSpecType, specTypeSchemas } from '@modelcontextprotocol/server';
import { createMcpServer, TOOL_NAMES } from '@data-foundry/mcp';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import type { SqlDriver, SqlParam, SqlRow } from '@data-foundry/canonical-store';
import type { UsageEvent } from '@data-foundry/usage-events';
import {
  resetMcpDeployments,
  serveMcpRequest,
  type McpServeOptions,
  type QueueBinding,
} from '../src/index.js';
import {
  HOSTNAME,
  ORIGIN,
  PROTOCOL_VERSION,
  envFor,
  fixtureRuntime,
  legacyInitialize,
  mcpRequest,
  modernBody,
  recordingQueue,
  seedKey,
} from './support.js';

let fixtures: QueryFixtures;
const openFixtureDriver = async () => fixtures.driver;
const serveOptions: McpServeOptions = { openDriver: openFixtureDriver, runtime: fixtureRuntime };

type JsonRpcEnvelope = {
  readonly jsonrpc: '2.0';
  readonly id?: unknown;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
};

async function json(response: Response): Promise<JsonRpcEnvelope> {
  return await response.json() as JsonRpcEnvelope;
}

function structured(response: JsonRpcEnvelope): unknown {
  return (response.result as { readonly structuredContent?: unknown } | undefined)?.structuredContent;
}

interface NotificationSchemaJson {
  readonly anyOf?: readonly {
    readonly properties?: {
      readonly method?: { readonly const?: unknown };
    };
  }[];
}

interface SchemaWithRuntimeJson {
  readonly '~standard': {
    readonly jsonSchema: { readonly input: () => unknown };
  };
}

function notificationMethods(schema: unknown): readonly string[] {
  // SDK 2.0.0 types the registry as StandardSchemaV1Sync even though its
  // runtime objects also implement the standard JSON Schema extension. Keep
  // that declaration mismatch isolated to this parity-test extractor.
  const json = (
    schema as SchemaWithRuntimeJson
  )['~standard'].jsonSchema.input() as NotificationSchemaJson;
  return (json.anyOf ?? []).map((branch) => branch.properties?.method?.const).filter(
    (method): method is string => typeof method === 'string',
  ).sort();
}

const CLIENT_NOTIFICATION_PARAMS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'notifications/cancelled': { requestId: 'cancelled-request' },
  'notifications/progress': { progressToken: 'progress-token', progress: 1 },
  'notifications/initialized': {},
  'notifications/roots/list_changed': {},
};

const SERVER_ONLY_NOTIFICATION_PARAMS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'notifications/message': { level: 'info', data: 'server-origin message' },
  'notifications/resources/updated': { uri: 'https://data.example.test/resource' },
  'notifications/resources/list_changed': {},
  'notifications/tools/list_changed': {},
  'notifications/prompts/list_changed': {},
  'notifications/subscriptions/acknowledged': { notifications: {} },
  'notifications/elicitation/complete': { elicitationId: 'server-elicitation' },
};

// `specTypeSchemas.ClientNotification` is the public SDK 2.0.0 exposure of
// ClientNotificationSchema. Derive the exercised direction set from the pinned
// official schema, while the literal fixture maps make unexpected SDK drift
// visible instead of silently blessing a new method.
const CLIENT_NOTIFICATION_METHODS = notificationMethods(specTypeSchemas.ClientNotification);
const SERVER_NOTIFICATION_METHODS = notificationMethods(specTypeSchemas.ServerNotification);
const SERVER_ONLY_NOTIFICATION_METHODS = SERVER_NOTIFICATION_METHODS.filter(
  (method) => !CLIENT_NOTIFICATION_METHODS.includes(method),
);

beforeAll(async () => {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(fixtures, ['PUBLIC_WEB', 'MCP']);
  for (const entity of [fixtures.equipment, fixtures.heatPump, fixtures.motor, fixtures.rival]) {
    await addSyntheticEntityEvidence(fixtures, entity);
  }
});

afterEach(() => {
  resetMcpDeployments();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await fixtures.driver.close();
});

describe('Streamable HTTP lifecycle and executable tool parity', () => {
  it('serves bounded legacy initialize and current discovery/list/call from the SDK', async () => {
    const key = await seedKey(fixtures, 'mcp-lifecycle');
    const { queue, sent } = recordingQueue();

    const initialized = await serveMcpRequest(
      legacyInitialize(key.secret), envFor(queue), serveOptions,
    );
    expect(initialized.status).toBe(200);
    expect(initialized.headers.get('content-type')).toContain('text/event-stream');

    const discovered = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('server/discover')),
      envFor(queue),
      serveOptions,
    );
    expect(discovered.status).toBe(200);
    expect((await json(discovered)).result).toBeDefined();

    const listed = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/list')),
      envFor(queue),
      serveOptions,
    );
    expect(listed.status).toBe(200);
    const listEnvelope = await json(listed);
    const tools = (listEnvelope.result as { readonly tools: readonly { readonly name: string }[] }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);

    const args = {
      entity_id: fixtures.equipment.id,
      as_of: '2026-08-01T00:00:00.000Z',
    };
    const called = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/call', { name: 'list_facts', arguments: args })),
      envFor(queue),
      serveOptions,
    );
    expect(called.status).toBe(200);
    const calledEnvelope = await json(called);

    const direct = await createMcpServer({
      queryModel: fixtures.qm,
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      policy: fixtureRuntime.fact_selection as never,
      canonicalUrlBase: 'https://data.example.test/data/hvac',
    }).callTool('list_facts', args);
    expect(structured(calledEnvelope)).toEqual(direct.structuredContent);

    expect(sent.map((event) => event.route_key)).toEqual([
      'mcp.server_discover',
      'mcp.server_discover',
      'mcp.tools_list',
      'mcp.tools_call',
    ]);
    expect(sent.every((event) =>
      'schema_version' in event && event.access_tier === 'MCP' && event.billing_source === 'NONE'
    )).toBe(true);
  });

  it('acknowledges a valid current notification with 202 and does not invent billable consumption', async () => {
    const key = await seedKey(fixtures, 'mcp-notification');
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(
        key.secret,
        modernBody('notifications/cancelled', { requestId: 'cancelled-request' }, null),
      ),
      envFor(queue),
      serveOptions,
    );
    expect({ status: response.status, body: await response.text() }).toEqual({
      status: 202,
      body: '',
    });
    expect(sent).toEqual([]);
  });

  it('accepts only closed-set, id-free modern notifications', async () => {
    const key = await seedKey(fixtures, 'mcp-notification-shape');
    const { queue, sent } = recordingQueue();
    const requestShapedNotification = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('notifications/cancelled', {
        requestId: 'cancelled-request',
      })),
      envFor(queue),
      serveOptions,
    );
    const unknownNotification = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('notifications/not-supported', {}, null)),
      envFor(queue),
      serveOptions,
    );

    expect(requestShapedNotification.status).toBe(400);
    expect(unknownNotification.status).toBe(400);
    expect(sent.map((event) => event.route_key)).toEqual([
      'mcp.protocol_failure',
      'mcp.protocol_failure',
    ]);
  });

  it('pins the complete SDK client and server-only notification directions', () => {
    expect(CLIENT_NOTIFICATION_METHODS).toEqual(Object.keys(CLIENT_NOTIFICATION_PARAMS).sort());
    expect(SERVER_ONLY_NOTIFICATION_METHODS).toEqual(
      Object.keys(SERVER_ONLY_NOTIFICATION_PARAMS).sort(),
    );
  });

  it.each(CLIENT_NOTIFICATION_METHODS)(
    'accepts SDK client-to-server notification %s',
    async (method) => {
      const params = CLIENT_NOTIFICATION_PARAMS[method];
      if (params === undefined) throw new Error(`missing client notification fixture: ${method}`);
      expect(isSpecType.ClientNotification({ method, params })).toBe(true);
      const key = await seedKey(fixtures, `mcp-client-notification-${method.replaceAll('/', '-')}`);
      const { queue, sent } = recordingQueue();
      const response = await serveMcpRequest(
        mcpRequest(key.secret, modernBody(method, params, null)),
        envFor(queue),
        serveOptions,
      );
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 202,
        body: '',
      });
      expect(sent).toEqual([]);
    },
  );

  it.each(SERVER_ONLY_NOTIFICATION_METHODS)(
    'rejects SDK server-to-client notification %s',
    async (method) => {
      const params = SERVER_ONLY_NOTIFICATION_PARAMS[method];
      if (params === undefined) throw new Error(`missing server notification fixture: ${method}`);
      expect(isSpecType.ServerNotification({ method, params })).toBe(true);
      const key = await seedKey(fixtures, `mcp-server-notification-${method.replaceAll('/', '-')}`);
      const { queue, sent } = recordingQueue();
      const response = await serveMcpRequest(
        mcpRequest(key.secret, modernBody(method, params, null)),
        envFor(queue),
        serveOptions,
      );
      expect(response.status).toBe(400);
      expect(sent.map((event) => event.route_key)).toEqual(['mcp.protocol_failure']);
    },
  );

  it('does not reopen the database driver for each request in one warm isolate', async () => {
    const key = await seedKey(fixtures, 'mcp-warm-isolate');
    const { queue } = recordingQueue();
    const openDriver = vi.fn(openFixtureDriver);
    const options = { ...serveOptions, openDriver };
    for (let index = 0; index < 2; index += 1) {
      const response = await serveMcpRequest(
        mcpRequest(key.secret, modernBody('tools/list', {}, index)),
        envFor(queue),
        options,
      );
      expect(response.status).toBe(200);
    }
    expect(openDriver).toHaveBeenCalledTimes(1);
  });
});

describe('pre-SDK request guards and authorization', () => {
  it('rejects a wrong Host or present Origin before opening a database driver', async () => {
    const openDriver = vi.fn(async () => { throw new Error('must not open'); });
    const options = { ...serveOptions, openDriver };
    const wrongHost = await serveMcpRequest(
      mcpRequest(undefined, modernBody('tools/list'), { hostname: 'attacker.test' }),
      envFor(recordingQueue().queue),
      options,
    );
    const wrongOrigin = await serveMcpRequest(
      mcpRequest(undefined, modernBody('tools/list'), { origin: 'https://attacker.test' }),
      envFor(recordingQueue().queue),
      options,
    );
    expect(wrongHost.status).toBe(403);
    expect(wrongOrigin.status).toBe(403);
    expect(openDriver).not.toHaveBeenCalled();
  });

  it('allows an absent Origin for non-browser clients', async () => {
    const key = await seedKey(fixtures, 'mcp-originless');
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/list'), { origin: null }),
      envFor(recordingQueue().queue),
      serveOptions,
    );
    expect(response.status).toBe(200);
  });

  it('accepts only one-vertical MCP/NONE keys and rejects direct/RapidAPI credentials', async () => {
    const direct = await seedKey(fixtures, 'mcp-direct-key', {
      accessTier: 'API_PAID', billingSource: 'DIRECT',
    });
    const rapid = await seedKey(fixtures, 'mcp-rapid-key', {
      accessTier: 'RAPIDAPI', billingSource: 'RAPIDAPI',
    });
    const [other] = await fixtures.driver.query<{ id: string }>(
      `insert into verticals (slug, name, schema_version, status, default_refresh_policy)
       values ('mcp-other', 'MCP Other', '1', 'ACTIVE', '{}'::jsonb) returning id`,
    );
    if (other === undefined) throw new Error('other vertical insert failed');
    const crossVertical = await seedKey(fixtures, 'mcp-cross-vertical', { verticalId: other.id });
    const { queue, sent } = recordingQueue();

    for (const secret of [undefined, direct.secret, rapid.secret, crossVertical.secret]) {
      const response = await serveMcpRequest(
        mcpRequest(secret, modernBody('tools/list')),
        envFor(queue),
        serveOptions,
      );
      expect(response.status).toBe(secret === undefined ? 401 : 403);
      expect(await json(response)).toMatchObject({ jsonrpc: '2.0', id: null, error: {} });
    }
    expect(sent).toEqual([]);
  });

  it('revocation takes effect on the very next request', async () => {
    const key = await seedKey(fixtures, 'mcp-key-revocation');
    const { queue, sent } = recordingQueue();
    const request = (): Request => mcpRequest(key.secret, modernBody('tools/list'));
    expect((await serveMcpRequest(request(), envFor(queue), serveOptions)).status).toBe(200);
    await fixtures.driver.query('update api_keys set revoked_at = now() where id = $1', [key.apiKeyId]);
    expect((await serveMcpRequest(request(), envFor(queue), serveOptions)).status).toBe(401);
    expect(sent).toHaveLength(1);
  });

  it.each([
    ['content type', { contentType: 'text/plain' }, 415],
    ['accept', { accept: 'application/json' }, 406],
    ['protocol header', { protocolVersion: '2025-11-25' }, 400],
    ['method mirror', { methodHeader: 'resources/list' }, 400],
    ['name mirror', { nameHeader: 'search_entities' }, 400],
  ] as const)('rejects an invalid %s opaquely and meters only a fixed failure class', async (_label, overrides, status) => {
    const key = await seedKey(fixtures, `mcp-guard-${_label.replace(' ', '-')}`);
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(
        key.secret,
        modernBody('tools/call', { name: 'get_entity', arguments: { identifier: fixtures.equipment.id } }),
        overrides,
      ),
      envFor(queue),
      serveOptions,
    );
    expect(response.status).toBe(status);
    expect(await json(response)).toMatchObject({ jsonrpc: '2.0', id: null, error: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.route_key).toBe('mcp.protocol_failure');
  });

  it('rejects batches, claimless non-initialize legacy calls, oversized bodies, GET, and DELETE', async () => {
    const key = await seedKey(fixtures, 'mcp-shape-guards');
    const { queue, sent } = recordingQueue();
    const batch = await serveMcpRequest(
      mcpRequest(key.secret, [modernBody('tools/list')]), envFor(queue), serveOptions,
    );
    const claimless = await serveMcpRequest(
      mcpRequest(
        key.secret,
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { protocolVersion: null, methodHeader: null },
      ),
      envFor(queue),
      serveOptions,
    );
    const oversized = await serveMcpRequest(
      mcpRequest(key.secret, 'x'.repeat(262_145)), envFor(queue), serveOptions,
    );
    const get = await serveMcpRequest(
      mcpRequest(key.secret, '', { method: 'GET' }), envFor(queue), serveOptions,
    );
    const deleted = await serveMcpRequest(
      mcpRequest(key.secret, '', { method: 'DELETE' }), envFor(queue), serveOptions,
    );
    expect(batch.status).toBe(400);
    expect(claimless.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(get.status).toBe(405);
    expect(deleted.status).toBe(405);
    expect(sent.map((event) => event.route_key)).toEqual([
      'mcp.protocol_failure',
      'mcp.protocol_failure',
      'mcp.protocol_failure',
    ]);
  });

  it('returns the SDK protocol error for an authenticated unsupported method', async () => {
    const key = await seedKey(fixtures, 'mcp-unsupported');
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('resources/list')),
      envFor(queue),
      serveOptions,
    );
    expect(response.status).toBe(404);
    expect((await json(response)).error?.code).toBe(-32601);
    expect(sent[0]?.route_key).toBe('mcp.protocol_failure');
  });

  it('rejects a no-id tools/call before tool SQL and meters the fixed protocol-failure route', async () => {
    const key = await seedKey(fixtures, 'mcp-no-id-call');
    const privateIdentifier = 'must-never-reach-query-7194';
    const observedQueries: { readonly sql: string; readonly params?: readonly SqlParam[] }[] = [];
    const guardedDriver: SqlDriver = {
      label: fixtures.driver.label,
      dialect: fixtures.driver.dialect,
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params?: readonly SqlParam[],
      ): Promise<R[]> => {
        observedQueries.push({ sql, ...(params === undefined ? {} : { params }) });
        return await fixtures.driver.query<R>(sql, params);
      },
      exec: fixtures.driver.exec.bind(fixtures.driver),
      transaction: fixtures.driver.transaction.bind(fixtures.driver),
      close: async () => undefined,
    };
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/call', {
        name: 'get_entity',
        arguments: { identifier: privateIdentifier },
      }, null)),
      envFor(queue),
      { runtime: fixtureRuntime, openDriver: async () => guardedDriver },
    );

    expect(response.status).toBe(400);
    expect(sent.map((event) => event.route_key)).toEqual(['mcp.protocol_failure']);
    expect(JSON.stringify(observedQueries)).not.toContain(privateIdentifier);
  });

  it('keeps initialize on the bounded legacy path and rejects a modern initialize claim', async () => {
    const key = await seedKey(fixtures, 'mcp-modern-initialize');
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'modern-client', version: '1.0.0' },
      })),
      envFor(queue),
      serveOptions,
    );

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ jsonrpc: '2.0', id: null, error: {} });
    expect(sent.map((event) => event.route_key)).toEqual(['mcp.protocol_failure']);
  });
});

describe('surface-rights freshness and non-implication', () => {
  it('observes a later rights-terms revocation on the next call in a warm deployment', async () => {
    const local = await createQueryFixtures();
    try {
      await seedSyntheticSurfaceRights(local, ['PUBLIC_WEB', 'MCP']);
      await addSyntheticEntityEvidence(local, local.equipment);
      const key = await seedKey(local, 'mcp-rights-revocation');
      const { queue } = recordingQueue();
      const options: McpServeOptions = {
        runtime: fixtureRuntime,
        openDriver: async () => local.driver,
      };
      const call = (): Request => mcpRequest(
        key.secret,
        modernBody('tools/call', {
          name: 'get_entity', arguments: { identifier: local.equipment.id },
        }),
      );

      const first = await serveMcpRequest(call(), envFor(queue), options);
      expect(JSON.stringify(await json(first))).toContain(local.equipment.canonical_name);

      const versions = await local.driver.query<{ id: string }>(
        `select version.id
           from rights_terms_versions version
           join rights_terms_cells cell on cell.id = version.terms_cell_id
          where cell.source_id = $1`,
        [local.sources.manufacturer.source.id],
      );
      for (const version of versions) {
        await local.driver.query(
          `select revoke_rights_terms($1, 'HUMAN', 'test-fixture', 'test revocation', now())`,
          [version.id],
        );
      }

      const second = await serveMcpRequest(call(), envFor(queue), options);
      const serialized = JSON.stringify(await json(second));
      expect(serialized).not.toContain(local.equipment.canonical_name);
      expect(serialized).not.toContain(local.sources.manufacturer.source.domain);
    } finally {
      resetMcpDeployments();
      await local.driver.close();
    }
  });

  it('does not treat PUBLIC_WEB permission as MCP permission', async () => {
    const local = await createQueryFixtures();
    try {
      await seedSyntheticSurfaceRights(local, ['PUBLIC_WEB']);
      await addSyntheticEntityEvidence(local, local.equipment);
      const key = await seedKey(local, 'mcp-neighbor-rights');
      const response = await serveMcpRequest(
        mcpRequest(key.secret, modernBody('tools/call', {
          name: 'get_entity', arguments: { identifier: local.equipment.id },
        })),
        envFor(recordingQueue().queue),
        { runtime: fixtureRuntime, openDriver: async () => local.driver },
      );
      const serialized = JSON.stringify(await json(response));
      expect(serialized).not.toContain(local.equipment.canonical_name);
      expect(serialized).not.toContain(local.sources.manufacturer.source.domain);
    } finally {
      resetMcpDeployments();
      await local.driver.close();
    }
  });

  it('observes a decision re-review deadline without an isolate restart', async () => {
    const local = await createQueryFixtures();
    try {
      const recheckAt = new Date(Date.now() + 4_000);
      await seedSyntheticSurfaceRights(local, ['MCP'], undefined, {
        decisionRecheckAt: recheckAt.toISOString() as never,
      });
      await addSyntheticEntityEvidence(local, local.equipment);
      const key = await seedKey(local, 'mcp-review-expiry');
      const options: McpServeOptions = {
        runtime: fixtureRuntime,
        openDriver: async () => local.driver,
      };
      const call = (): Request => mcpRequest(key.secret, modernBody('tools/call', {
        name: 'get_entity', arguments: { identifier: local.equipment.id },
      }));
      expect(JSON.stringify(await json(
        await serveMcpRequest(call(), envFor(recordingQueue().queue), options),
      ))).toContain(local.equipment.canonical_name);

      await new Promise((resolve) => setTimeout(resolve, Math.max(0, recheckAt.getTime() - Date.now() + 100)));
      expect(JSON.stringify(await json(
        await serveMcpRequest(call(), envFor(recordingQueue().queue), options),
      ))).not.toContain(local.equipment.canonical_name);
    } finally {
      resetMcpDeployments();
      await local.driver.close();
    }
  });
});

describe('privacy-safe analytics handoff', () => {
  it('logs an opaque correlation for an unexpected tool failure without caller or tool material', async () => {
    const key = await seedKey(fixtures, 'mcp-tool-failure-log');
    const privateFailure = 'private-query-failure-7159';
    const privateRpcId = 'private-rpc-id-2054';
    const failingDriver: SqlDriver = {
      label: fixtures.driver.label,
      dialect: fixtures.driver.dialect,
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params?: readonly SqlParam[],
      ): Promise<R[]> => {
        if (/\bFROM facts\b/i.test(sql)) throw new Error(privateFailure);
        return await fixtures.driver.query<R>(sql, params);
      },
      exec: fixtures.driver.exec.bind(fixtures.driver),
      // Surface reads now deliberately start at a repeatable-read transaction
      // boundary. Fail that boundary itself so this regression continues to
      // exercise the worker's opaque tool-error path without depending on one
      // internal fact-query string.
      transaction: async <T>(): Promise<T> => {
        throw new Error(privateFailure);
      },
      close: async () => undefined,
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { queue, sent } = recordingQueue();
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/call', {
        name: 'list_facts',
        arguments: {
          entity_id: fixtures.equipment.id,
          as_of: '2026-08-01T00:00:00.000Z',
        },
      }, privateRpcId)),
      envFor(queue),
      { runtime: fixtureRuntime, openDriver: async () => failingDriver },
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(await json(response))).toContain('INTERNAL_ERROR');
    expect(sent.map((event) => event.route_key)).toEqual(['mcp.tools_call']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logs = JSON.stringify(errorSpy.mock.calls);
    for (const forbidden of [
      'list_facts',
      privateFailure,
      privateRpcId,
      fixtures.equipment.id,
      key.secret,
      key.tokenHash,
      key.tokenPrefix,
      `https://${HOSTNAME}/mcp`,
    ]) {
      expect(logs, forbidden).not.toContain(forbidden);
    }
    const details = errorSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(details).toMatchObject({
      classification: 'MCP_TOOL_FAILURE',
      code: 'INTERNAL_ERROR',
    });
    expect(Object.keys(details ?? {}).sort()).toEqual(['classification', 'code', 'correlationId']);
    expect(details?.['correlationId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('awaits Queue acceptance and emits only the fixed MCP/NONE usage shape', async () => {
    const key = await seedKey(fixtures, 'mcp-queue-await');
    let accept: (() => void) | undefined;
    const sent: UsageEvent[] = [];
    const queue: QueueBinding = {
      send: async (value: unknown) => {
        sent.push(value as UsageEvent);
        await new Promise<void>((resolve) => { accept = resolve; });
      },
    };
    let resolved = false;
    const rpcId = 'private-rpc-id-791';
    const responsePromise = serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/call', {
        name: 'get_entity',
        arguments: { identifier: fixtures.equipment.id },
      }, rpcId)),
      envFor(queue),
      serveOptions,
    ).then((response) => { resolved = true; return response; });

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(resolved).toBe(false);
    accept?.();
    expect((await responsePromise).status).toBe(200);

    const event = sent[0];
    expect(event).toMatchObject({
      tenant_id: key.tenantId,
      api_key_id: key.apiKeyId,
      vertical_id: fixtures.vertical.id,
      route_key: 'mcp.tools_call',
      method: 'POST',
      rows_served: 0,
      schema_version: 2,
      access_tier: 'MCP',
      billing_source: 'NONE',
    });
    expect(Object.keys(event ?? {}).sort()).toEqual([
      'schema_version', 'id', 'tenant_id', 'api_key_id', 'vertical_id', 'occurred_at',
      'route_key', 'method', 'status', 'rows_served', 'duration_ms', 'access_tier',
      'billing_source',
    ].sort());
    const serialized = JSON.stringify(event);
    for (const forbidden of [
      key.secret,
      key.tokenHash,
      key.tokenPrefix,
      rpcId,
      'get_entity',
      fixtures.equipment.id,
      `https://${HOSTNAME}/mcp`,
      ORIGIN,
      PROTOCOL_VERSION,
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('fails opaquely with 503 when Queue acceptance fails and does not log caller material', async () => {
    const key = await seedKey(fixtures, 'mcp-queue-failure');
    const privateFailure = 'queue-private-failure-398';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await serveMcpRequest(
      mcpRequest(key.secret, modernBody('tools/call', {
        name: 'get_entity', arguments: { identifier: fixtures.equipment.id },
      })),
      envFor({ send: async () => { throw new Error(privateFailure); } }),
      serveOptions,
    );
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32003, message: 'Service unavailable.' },
    });
    const logs = JSON.stringify(errorSpy.mock.calls);
    for (const forbidden of [privateFailure, key.secret, fixtures.equipment.id, 'get_entity']) {
      expect(logs).not.toContain(forbidden);
    }
  });
});
