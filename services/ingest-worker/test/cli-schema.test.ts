import { describe, expect, it } from 'vitest';
import { resolveRealPostgresSchema } from '../src/cli.js';

describe('real Postgres ingestion isolation', () => {
  it('defaults live ingestion to Alpha Lab while retaining an explicit legacy opt-in', () => {
    expect(resolveRealPostgresSchema({})).toBe('data_foundry');
    expect(resolveRealPostgresSchema({ DATA_FOUNDRY_SCHEMA: 'public' })).toBe('public');
  });
});
