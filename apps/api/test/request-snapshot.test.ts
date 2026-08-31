/**
 * One matched REST request owns one immutable database snapshot.
 *
 * These tests keep the real PGlite-backed query model and observe only its
 * transaction boundary. They fail if a compound handler lets any of its
 * surface reads open a second transaction, or if dispatch opens a database
 * snapshot for a service document or a request that never reaches a handler.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { call, createApiFixtures, type ApiFixtures } from './support.js';

let fixtures: ApiFixtures;
let transactions: MockInstance;

beforeAll(async () => {
  fixtures = await createApiFixtures();
  transactions = vi.spyOn(fixtures.driver, 'transaction');
}, 300_000);

beforeEach(() => {
  transactions.mockClear();
});

afterAll(async () => {
  transactions?.mockRestore();
  await fixtures?.driver.close();
});

describe('one snapshot per matched route handler', () => {
  const compoundRoutes = (): readonly { readonly name: string; readonly url: string }[] => [
    {
      name: 'facts',
      url: `/v1/entities/${fixtures.equipment.id}/facts?limit=100`,
    },
    {
      name: 'relationships',
      url: `/v1/entities/${fixtures.equipment.id}/relationships?direction=out&depth=2&limit=50`,
    },
    {
      name: 'compare',
      url: `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
    },
  ];

  for (const name of ['facts', 'relationships', 'compare'] as const) {
    it(`${name} keeps every compound read in exactly one driver transaction`, async () => {
      const route = compoundRoutes().find((candidate) => candidate.name === name);
      if (route === undefined) throw new Error(`missing ${name} route fixture`);

      const response = await call(fixtures.app, route.url);

      expect(response.status).toBe(200);
      expect(transactions).toHaveBeenCalledTimes(1);
    });
  }
});

describe('dispatch paths with no matched data handler', () => {
  it.each(['/', '/v1'])('serves %s without opening a database transaction', async (url) => {
    const response = await call(fixtures.app, url);

    expect(response.status).toBe(200);
    expect(transactions).not.toHaveBeenCalled();
  });

  it('rejects an unmatched route without opening a database transaction', async () => {
    const response = await call(fixtures.app, '/v1/not-a-route');

    expect(response.status).toBe(404);
    expect(transactions).not.toHaveBeenCalled();
  });

  it('rejects an unparseable request target without opening a database transaction', async () => {
    const response = await call(fixtures.app, 'http://[');

    expect(response.status).toBe(400);
    expect(transactions).not.toHaveBeenCalled();
  });
});
