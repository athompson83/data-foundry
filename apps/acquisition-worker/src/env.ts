import type { R2BucketBinding } from './r2.js';

export interface HyperdriveBinding {
  readonly connectionString: string;
}

export interface AcquisitionWorkerEnv {
  readonly DEPLOYMENT_ENVIRONMENT?: string | undefined;
  readonly VERTICAL_SLUG?: string;
  readonly RAW_ARTIFACTS_BUCKET_NAME?: string;
  readonly HYPERDRIVE?: HyperdriveBinding;
  readonly POSTGRES_URL?: string;
  readonly RAW_ARTIFACTS?: R2BucketBinding;
  readonly CLOUDFLARE_ACCOUNT_ID?: string;
  readonly CLOUDFLARE_API_TOKEN?: string;
  readonly CRAWL4AI_BASE_URL?: string;
  readonly CRAWL4AI_API_TOKEN?: string;
}

export interface ResolvedAcquisitionConfig {
  readonly deploymentEnvironment: 'development' | 'production';
  readonly connectionString: string;
  readonly verticalSlug: string;
  readonly bucketName: string;
  readonly bucket: R2BucketBinding;
}

export class AcquisitionWorkerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcquisitionWorkerConfigurationError';
  }
}

export function resolveAcquisitionConfig(env: AcquisitionWorkerEnv): ResolvedAcquisitionConfig {
  const deploymentEnvironment = env.DEPLOYMENT_ENVIRONMENT;
  if (deploymentEnvironment !== 'development' && deploymentEnvironment !== 'production') {
    throw new AcquisitionWorkerConfigurationError(
      'DEPLOYMENT_ENVIRONMENT must be exactly development or production.',
    );
  }
  if (deploymentEnvironment === 'production' && env.HYPERDRIVE === undefined) {
    throw new AcquisitionWorkerConfigurationError('Production requires the HYPERDRIVE binding.');
  }
  const connectionString = deploymentEnvironment === 'production'
    ? env.HYPERDRIVE?.connectionString ?? ''
    : env.HYPERDRIVE?.connectionString ?? env.POSTGRES_URL ?? '';
  if (connectionString.trim() === '') {
    throw new AcquisitionWorkerConfigurationError(
      'No database is configured; acquisition never falls back to an in-memory database.',
    );
  }
  const verticalSlug = env.VERTICAL_SLUG?.trim() ?? '';
  if (verticalSlug === '') throw new AcquisitionWorkerConfigurationError('VERTICAL_SLUG is required.');
  const bucketName = env.RAW_ARTIFACTS_BUCKET_NAME?.trim() ?? '';
  if (bucketName === '') {
    throw new AcquisitionWorkerConfigurationError('RAW_ARTIFACTS_BUCKET_NAME is required.');
  }
  if (env.RAW_ARTIFACTS === undefined) {
    throw new AcquisitionWorkerConfigurationError('The RAW_ARTIFACTS R2 binding is required.');
  }
  return {
    deploymentEnvironment,
    connectionString,
    verticalSlug,
    bucketName,
    bucket: env.RAW_ARTIFACTS,
  };
}
