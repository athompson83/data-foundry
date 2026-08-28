/**
 * The whole pipeline, through the one function `wrangler dev` and a deployed
 * Worker actually call: parse the credential, authenticate, execute the
 * route, publish a usage event, answer — without ever coupling the response
 * to whether the queue accepted the event.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createQueryFixtures, type QueryFixtures } from '../../../packages/query-model/test/support.js';
import { mintApiKey } from '@data-foundry/api-keys';
import type { UsageEvent } from '@data-foundry/usage-events';
import { serveRequest, resetDeployments, RUNTIMES, type VerticalRuntime, type QueueBinding } from '../src/index.js';

let fixtures: QueryFixtures;
const runtime = RUNTIMES['hvac'] as VerticalRuntime;

const envFor = (queue?: QueueBinding) => ({
  POSTGRES_URL: 'postgres://fixture/db',
  VERTICAL_SLUG: 'hvac',
  API_KEY_ENVIRONMENT: 'test',
  ...(queue === undefined ? {} : { USAGE_EVENTS_QUEUE: queue }),
});

const openFixtureDriver = async () => fixtures.driver;

/** `waitUntil` that actually waits, so a test can assert on what it awaited. */
function immediateContext(): { ctx: { waitUntil(p: Promise<unknown>): void }; settle: () => Promise<void> } {
  let pending: Promise<unknown> = Promise.resolve();
  return {
    ctx: {
      waitUntil(promise: Promise<unknown>) {
        pending = promise;
      },
    },
    settle: async () => {
      await pending;
    },
  };
}

function recordingQueue(): { queue: QueueBinding; sent: UsageEvent[] } {
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

async function mintKeyFor(tenantSlug: string): Promise<{
  secret: string;
  tokenHash: string;
  tokenPrefix: string;
  tenantId: string;
  apiKeyId: string;
}> {
  const [tenant] = await fixtures.driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ($1, $2, 'ACTIVE') returning id`,
    [tenantSlug, tenantSlug],
  );
  const tenantId = tenant?.id;
  if (tenantId === undefined) throw new Error('tenant insert returned no row');
  const minted = await mintApiKey('test');
  const [key] = await fixtures.driver.query<{ id: string }>(
    `insert into api_keys (tenant_id, token_hash, token_prefix, label, vertical_id)
     values ($1, $2, $3, $4, $5) returning id`,
    [tenantId, minted.tokenHash, minted.tokenPrefix, `${tenantSlug} key`, fixtures.vertical.id],
  );
  const apiKeyId = key?.id;
  if (apiKeyId === undefined) throw new Error('key insert returned no row');
  return {
    secret: minted.secret,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    tenantId,
    apiKeyId,
  };
}

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures.driver.close();
});

afterEach(() => {
  resetDeployments();
  vi.restoreAllMocks();
});

describe('an authorized request executes and is metered', () => {
  it('runs the route, returns its answer, and publishes a matching usage event', async () => {
    const key = await mintKeyFor('acme-e2e');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();

    const request = new Request(`https://edge.invalid/v1/entities/${fixtures.equipment.id}`, {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    await settle();

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    const event = sent[0];
    expect(event).toMatchObject({
      tenant_id: key.tenantId,
      api_key_id: key.apiKeyId,
      vertical_id: fixtures.vertical.id,
      route_key: 'entities.detail',
      method: 'GET',
      status: 200,
    });
    // The event names only the closed route key, never the id that was asked for.
    expect(JSON.stringify(event)).not.toContain(fixtures.equipment.id);
    expect(Object.keys(event ?? {}).sort()).toEqual(
      ['id', 'tenant_id', 'api_key_id', 'vertical_id', 'occurred_at', 'route_key', 'method', 'status', 'rows_served', 'duration_ms'].sort(),
    );
  });
});

describe('an unauthorized request never reaches the route or gets metered', () => {
  it('answers 401 without publishing anything', async () => {
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();

    const request = new Request('https://edge.invalid/v1/health');
    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    await settle();

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('answers 403 for a key scoped to a different vertical, without publishing anything', async () => {
    const [other] = await fixtures.driver.query<{ id: string }>(
      `insert into verticals (slug, name, schema_version, status, default_refresh_policy)
       values ('other-index-vertical', 'Other', '1', 'ACTIVE', '{}'::jsonb) returning id`,
    );
    const otherVerticalId = other?.id;
    if (otherVerticalId === undefined) throw new Error('vertical insert returned no row');
    const minted = await mintApiKey('test');
    const [tenant] = await fixtures.driver.query<{ id: string }>(
      `insert into api_tenants (slug, name, status) values ('scope-e2e', 'scope-e2e', 'ACTIVE') returning id`,
    );
    const tenantId = tenant?.id;
    if (tenantId === undefined) throw new Error('tenant insert returned no row');
    await fixtures.driver.query(
      `insert into api_keys (tenant_id, token_hash, token_prefix, label, vertical_id)
       values ($1, $2, $3, 'scoped', $4)`,
      [tenantId, minted.tokenHash, minted.tokenPrefix, otherVerticalId],
    );

    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const request = new Request('https://edge.invalid/v1/health', {
      headers: { authorization: `Bearer ${minted.secret}` },
    });
    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    await settle();

    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

describe('an unsupported method is not a usage event', () => {
  it('answers 405 after authentication but does not enqueue a message the consumer must reject', async () => {
    const key = await mintKeyFor('acme-post');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const request = new Request('https://edge.invalid/v1/health?should=never-persist', {
      method: 'POST',
      headers: { authorization: `Bearer ${key.secret}` },
    });

    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    await settle();

    expect(response.status).toBe(405);
    expect(sent).toEqual([]);
  });
});

describe('metering isolation and privacy', () => {
  it('registers waitUntil before the request promise resolves', async () => {
    const key = await mintKeyFor('acme-wait-order');
    const { queue } = recordingQueue();
    let registered = false;
    const response = await serveRequest(
      new Request('https://edge.invalid/v1/health', {
        headers: { authorization: `Bearer ${key.secret}` },
      }),
      envFor(queue),
      { waitUntil: () => { registered = true; } },
      openFixtureDriver,
    );

    expect(response.status).toBe(200);
    expect(registered).toBe(true);
  });

  it('never replaces an already-computed API response when waitUntil registration throws', async () => {
    const key = await mintKeyFor('acme-wait-throws');
    const { queue } = recordingQueue();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await serveRequest(
      new Request('https://edge.invalid/v1/health', {
        headers: { authorization: `Bearer ${key.secret}` },
      }),
      envFor(queue),
      { waitUntil: () => { throw new Error('context closed'); } },
      openFixtureDriver,
    );

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      '[edge] usage event scheduling failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('persists none of the request target, query, credential, headers, or response details', async () => {
    const key = await mintKeyFor('acme-privacy');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const privatePath = 'customer-private-slug-7491';
    const privateQuery = 'query-secret-2864';
    const privateHeader = 'header-secret-9032';
    const request = new Request(`https://edge.invalid/v1/${privatePath}?q=${privateQuery}`, {
      headers: {
        authorization: `Bearer ${key.secret}`,
        'x-customer-context': privateHeader,
      },
    });

    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    const responseText = await response.clone().text();
    await settle();

    expect(response.status).toBe(404);
    expect(sent).toHaveLength(1);
    const serialized = JSON.stringify(sent[0]);
    for (const forbidden of [
      privatePath,
      privateQuery,
      privateHeader,
      key.secret,
      key.tokenHash,
      key.tokenPrefix,
      responseText,
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the response does not depend on the queue', () => {
  it('still answers successfully when USAGE_EVENTS_QUEUE is not bound at all', async () => {
    const key = await mintKeyFor('acme-no-queue');
    const { ctx, settle } = immediateContext();
    const request = new Request('https://edge.invalid/v1/health', {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const response = await serveRequest(request, envFor(undefined), ctx, openFixtureDriver);
    await settle();
    expect(response.status).toBe(200);
  });

  it('still answers successfully when the queue rejects the publish', async () => {
    const key = await mintKeyFor('acme-queue-down');
    const failingQueue: QueueBinding = {
      send: async () => {
        throw new Error('queue unavailable');
      },
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, settle } = immediateContext();
    const request = new Request('https://edge.invalid/v1/health', {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const response = await serveRequest(request, envFor(failingQueue), ctx, openFixtureDriver);
    await settle();

    expect(response.status).toBe(200);
    // Not silent: a failed publish is a lost usage record, and this is the
    // one channel an operator has for it.
    expect(errorSpy).toHaveBeenCalledWith(
      '[edge] usage event publish failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('the read the request served does not depend on any write path at all — this Worker never writes to api_usage_events', async () => {
    const key = await mintKeyFor('acme-read-only');
    const { queue, sent } = recordingQueue();
    const { ctx, settle } = immediateContext();
    const request = new Request(`https://edge.invalid/v1/entities/${fixtures.equipment.id}`, {
      headers: { authorization: `Bearer ${key.secret}` },
    });
    const before = await fixtures.driver.query<{ n: string }>('select count(*)::text as n from api_usage_events');
    const response = await serveRequest(request, envFor(queue), ctx, openFixtureDriver);
    await settle();
    const after = await fixtures.driver.query<{ n: string }>('select count(*)::text as n from api_usage_events');

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1); // the event was published...
    expect(after[0]?.n).toBe(before[0]?.n); // ...but never written by this Worker.
  });
});
