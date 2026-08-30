import { describe, expect, it } from 'vitest';
import { resolveAcquisitionConfig, type AcquisitionWorkerEnv } from '../src/env.js';
import type { R2BucketBinding } from '../src/r2.js';

const bucket = {} as R2BucketBinding;
const production = (): AcquisitionWorkerEnv => ({
  DEPLOYMENT_ENVIRONMENT: 'production',
  VERTICAL_SLUG: 'hvac',
  RAW_ARTIFACTS_BUCKET_NAME: 'data-foundry-raw-artifacts',
  HYPERDRIVE: { connectionString: 'postgres://example.invalid/data-foundry' },
  RAW_ARTIFACTS: bucket,
});

describe('acquisition Worker configuration', () => {
  it.each([undefined, '', ' ', 'preview'])('refuses an absent, blank, or unknown deployment environment: %j', (value) => {
    expect(() =>
      resolveAcquisitionConfig({
        DEPLOYMENT_ENVIRONMENT: value,
        POSTGRES_URL: 'postgres://localhost/data-foundry',
        VERTICAL_SLUG: 'hvac',
        RAW_ARTIFACTS_BUCKET_NAME: 'local-raw',
        RAW_ARTIFACTS: bucket,
      }),
    ).toThrow(/DEPLOYMENT_ENVIRONMENT/);
  });

  it('resolves production Hyperdrive and R2 without any queue binding', () => {
    expect(resolveAcquisitionConfig(production())).toMatchObject({
      deploymentEnvironment: 'production',
      verticalSlug: 'hvac',
      bucketName: 'data-foundry-raw-artifacts',
      bucket,
    });
  });

  it.each(['HYPERDRIVE', 'RAW_ARTIFACTS', 'RAW_ARTIFACTS_BUCKET_NAME', 'VERTICAL_SLUG'] as const)(
    'fails closed when production lacks %s',
    (key) => {
      const env = { ...production() } as Record<string, unknown>;
      delete env[key];
      expect(() => resolveAcquisitionConfig(env as AcquisitionWorkerEnv)).toThrow();
    },
  );

  it('allows POSTGRES_URL only for local development', () => {
    expect(
      resolveAcquisitionConfig({
        DEPLOYMENT_ENVIRONMENT: 'development',
        POSTGRES_URL: 'postgres://localhost/data-foundry',
        VERTICAL_SLUG: 'hvac',
        RAW_ARTIFACTS_BUCKET_NAME: 'local-raw',
        RAW_ARTIFACTS: bucket,
      }).connectionString,
    ).toContain('localhost');
  });
});
