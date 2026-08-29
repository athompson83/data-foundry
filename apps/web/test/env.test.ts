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

describe('production topology is explicit and fail closed', () => {
  it('requires Hyperdrive instead of a direct origin connection', () => {
    expect(() =>
      resolveWebConfig({
        DEPLOYMENT_ENVIRONMENT: 'production',
        POSTGRES_URL: 'postgres://origin/db',
        PUBLIC_ORIGIN: 'https://data-foundry.example',
      }),
    ).toThrow(/HYPERDRIVE/);
  });

  it('accepts a production Hyperdrive binding', () => {
    const config = resolveWebConfig({
      DEPLOYMENT_ENVIRONMENT: 'production',
      HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      PUBLIC_ORIGIN: 'https://data-foundry.example',
    });

    expect(config.connectionString).toBe('postgres://hyperdrive/db');
    expect(config.deploymentEnvironment).toBe('production');
  });

  it('refuses an unknown deployment environment', () => {
    expect(() =>
      resolveWebConfig({
        DEPLOYMENT_ENVIRONMENT: 'preview',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
        PUBLIC_ORIGIN: 'https://data-foundry.example',
      }),
    ).toThrow(/development.*production/);
  });
});
