/**
 * The contract itself: what a usage event is allowed to say, and what
 * `parseUsageEvent` refuses before it ever reaches a database CHECK.
 */
import { describe, expect, it } from 'vitest';
import { buildUsageEvent, parseUsageEvent, type UsageEvent } from '../src/index.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const KEY_ID = '22222222-2222-4222-8222-222222222222';
const VERTICAL_ID = '33333333-3333-4333-8333-333333333333';

const validInput = {
  tenantId: TENANT_ID,
  apiKeyId: KEY_ID,
  verticalId: VERTICAL_ID,
  routeKey: 'entities.detail',
  method: 'GET',
  status: 200,
  accessTier: 'API_PAID',
  billingSource: 'DIRECT',
} as const;

/** Round-trip through JSON, the way a Queue message actually travels. */
const overWire = (event: UsageEvent): unknown => JSON.parse(JSON.stringify(event)) as unknown;

describe('buildUsageEvent', () => {
  it('mints a fresh, well-formed uuid for id', () => {
    const event = buildUsageEvent(validInput);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('mints a different id on every call — the whole idempotency mechanism depends on this', () => {
    const ids = new Set(Array.from({ length: 50 }, () => buildUsageEvent(validInput).id));
    expect(ids.size).toBe(50);
  });

  it('defaults rows_served to 0 and duration_ms to null', () => {
    const event = buildUsageEvent(validInput);
    expect(event.rows_served).toBe(0);
    expect(event.duration_ms).toBeNull();
  });

  it('carries through an explicit rows_served and duration_ms', () => {
    const event = buildUsageEvent({ ...validInput, rowsServed: 12, durationMs: 45 });
    expect(event.rows_served).toBe(12);
    expect(event.duration_ms).toBe(45);
  });

  it('stamps occurred_at as an ISO string, defaulting to now', () => {
    const before = Date.now();
    const event = buildUsageEvent(validInput);
    const stamped = Date.parse(event.occurred_at);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('never carries a field this package cannot name', () => {
    const event = buildUsageEvent(validInput);
    expect(Object.keys(event).sort()).toEqual(
      [
        'id',
        'tenant_id',
        'api_key_id',
        'occurred_at',
        'vertical_id',
        'route_key',
        'method',
        'status',
        'rows_served',
        'duration_ms',
        'schema_version',
        'access_tier',
        'billing_source',
      ].sort(),
    );
  });
});

describe('parseUsageEvent', () => {
  it('round-trips a built event across a JSON boundary', () => {
    const event = buildUsageEvent(validInput);
    expect(parseUsageEvent(overWire(event))).toEqual(event);
  });

  it('rejects a non-object', () => {
    expect(parseUsageEvent(null)).toBeNull();
    expect(parseUsageEvent('not an event')).toBeNull();
    expect(parseUsageEvent(42)).toBeNull();
    expect(parseUsageEvent([])).toBeNull();
  });

  it('rejects a missing required field', () => {
    const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    for (const field of [
      'id',
      'tenant_id',
      'api_key_id',
      'vertical_id',
      'occurred_at',
      'route_key',
      'method',
      'status',
      'rows_served',
      'duration_ms',
      'schema_version',
      'access_tier',
      'billing_source',
    ]) {
      const { [field]: _omitted, ...rest } = event;
      expect(parseUsageEvent(rest), `missing ${field}`).toBeNull();
    }
  });

  it('rejects an id, tenant_id, api_key_id or vertical_id that is not uuid-shaped', () => {
    for (const field of ['id', 'tenant_id', 'api_key_id', 'vertical_id']) {
      const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
      event[field] = 'not-a-uuid';
      expect(parseUsageEvent(event), field).toBeNull();
    }
  });

  it('rejects an occurred_at that does not parse as a date', () => {
    const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    event['occurred_at'] = 'not-a-date';
    expect(parseUsageEvent(event)).toBeNull();
  });

  it('rejects a parseable but noncanonical timestamp', () => {
    const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    event['occurred_at'] = '2026-08-28 09:00:00-04';
    expect(parseUsageEvent(event)).toBeNull();
  });

  it('rejects a route key carrying a query string or path-shaped data', () => {
    const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    event['route_key'] = '/v1/search?q=leak';
    expect(parseUsageEvent(event)).toBeNull();
    event['route_key'] = `entities.${TENANT_ID}`;
    expect(parseUsageEvent(event)).toBeNull();
  });

  it('rejects unknown fields so a raw target or credential cannot hitchhike through the event', () => {
    for (const [field, value] of [
      ['path', `/v1/entities/${TENANT_ID}`],
      ['query', 'q=secret'],
      ['entity_id', TENANT_ID],
      ['authorization', 'Bearer df_live_secret'],
      ['response_body', '{"private":true}'],
    ] as const) {
      const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
      event[field] = value;
      expect(parseUsageEvent(event), field).toBeNull();
    }
  });

  it('accepts the exact legacy v1 shape for a consumer-first rolling deploy', () => {
    const current = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    const {
      schema_version: _version,
      access_tier: _tier,
      billing_source: _source,
      ...legacy
    } = current;
    expect(parseUsageEvent(legacy)).toEqual(legacy);
  });

  it('rejects unknown versions and crossed marketplace billing classifications', () => {
    const unknown = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    unknown['schema_version'] = 3;
    expect(parseUsageEvent(unknown)).toBeNull();

    const crossed = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
    crossed['access_tier'] = 'RAPIDAPI';
    crossed['billing_source'] = 'DIRECT';
    expect(parseUsageEvent(crossed)).toBeNull();
  });

  it('rejects a method this API never serves', () => {
    for (const method of ['POST', 'DELETE', 'get', '']) {
      const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
      event['method'] = method;
      expect(parseUsageEvent(event), method).toBeNull();
    }
  });

  it('rejects a status outside 100-599, or a non-integer', () => {
    for (const status of [99, 600, 200.5, '200', NaN]) {
      const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
      event['status'] = status;
      expect(parseUsageEvent(event), String(status)).toBeNull();
    }
  });

  it('rejects a negative rows_served', () => {
    const event = overWire(buildUsageEvent({ ...validInput, rowsServed: 3 })) as Record<string, unknown>;
    event['rows_served'] = -1;
    expect(parseUsageEvent(event)).toBeNull();
  });

  it('rejects counters that overflow PostgreSQL INTEGER', () => {
    for (const field of ['rows_served', 'duration_ms']) {
      const event = overWire(buildUsageEvent(validInput)) as Record<string, unknown>;
      event[field] = 2_147_483_648;
      expect(parseUsageEvent(event), field).toBeNull();
    }
  });

  it('rejects a negative or fractional duration_ms but accepts null', () => {
    const event = overWire(buildUsageEvent({ ...validInput, durationMs: 5 })) as Record<string, unknown>;
    event['duration_ms'] = -1;
    expect(parseUsageEvent(event)).toBeNull();
    event['duration_ms'] = 1.5;
    expect(parseUsageEvent(event)).toBeNull();
    event['duration_ms'] = null;
    expect(parseUsageEvent(event)).not.toBeNull();
  });
});
