import { describe, expect, it } from 'vitest';
import { resolveWebConfig, WebConfigurationError } from '../src/env.js';

describe('public origin configuration', () => {
  it('refuses to manufacture a localhost canonical origin when none is configured', () => {
    expect(() => resolveWebConfig({ POSTGRES_URL: 'postgres://fixture/db' })).toThrow(
      WebConfigurationError,
    );
  });

  it('accepts an explicit localhost origin for local development', () => {
    expect(
      resolveWebConfig({
        POSTGRES_URL: 'postgres://fixture/db',
        PUBLIC_ORIGIN: 'http://localhost:8787/',
      }).publicOrigin,
    ).toBe('http://localhost:8787');
  });

  it('requires HTTPS for a non-local public origin', () => {
    expect(() =>
      resolveWebConfig({
        POSTGRES_URL: 'postgres://fixture/db',
        PUBLIC_ORIGIN: 'http://data-foundry.example',
      }),
    ).toThrow(WebConfigurationError);
  });

  it.each([
    'https://data-foundry.example/path',
    'https://data-foundry.example?preview=true',
    'https://user:data@data-foundry.example',
  ])('refuses a value that is not an origin: %s', (publicOrigin) => {
    expect(() =>
      resolveWebConfig({ POSTGRES_URL: 'postgres://fixture/db', PUBLIC_ORIGIN: publicOrigin }),
    ).toThrow(WebConfigurationError);
  });
});
