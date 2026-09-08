import { describe, expect, it } from 'vitest';
import { ingestionControlConnections } from '../scripts/check-ingestion-postgres.js';

const configured = {
  DATA_FOUNDRY_INGESTION_POSTGRES_TEST: '1',
  DATA_FOUNDRY_INGESTION_CONTROL_POSTGRES_URL: 'postgres://fixture_admin@127.0.0.1:25439/data_foundry',
  DATA_FOUNDRY_INGESTION_POSTGRES_URL: 'postgres://df_ingestion@127.0.0.1:25439/data_foundry',
};

describe('disposable PostgreSQL ingestion controls', () => {
  it('requires explicit mode before connecting or seeding any database', () => {
    expect(() => ingestionControlConnections({})).toThrow(/Explicit disposable ingestion test mode/);
  });

  it('uses matching local connections with the actual restricted runtime identity', () => {
    expect(ingestionControlConnections(configured)).toEqual({
      control: configured.DATA_FOUNDRY_INGESTION_CONTROL_POSTGRES_URL,
      runtime: configured.DATA_FOUNDRY_INGESTION_POSTGRES_URL,
      allowPlaintextLoopback: false,
    });
  });

  it('permits plaintext only with a separate disposable loopback opt-in', () => {
    expect(ingestionControlConnections({ ...configured, DATA_FOUNDRY_INGESTION_PLAINTEXT_LOOPBACK: '1' }).allowPlaintextLoopback).toBe(true);
  });

  it.each([
    'postgres://df_ingestion:synthetic@remote.example.com:25439/data_foundry',
    'postgres://df_ingestion@127.0.0.1:25440/data_foundry',
    'postgres://df_edge@127.0.0.1:25439/data_foundry',
    'postgres://df_ingestion@127.0.0.1:25439/another_database',
    'postgres://df_ingestion@127.0.0.1:25439/data_foundry?options=unsafe',
  ])('refuses an unintended target without echoing connection data', (runtime) => {
    try {
      ingestionControlConnections({ ...configured, DATA_FOUNDRY_INGESTION_POSTGRES_URL: runtime });
      throw new Error('control unexpectedly accepted an unintended target');
    } catch (error) {
      expect((error as Error).message).toBe('Ingestion controls require matching disposable loopback database connections and the df_ingestion runtime identity.');
    }
  });
});
