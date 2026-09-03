import type {
  PrivateCanaryProbeInput,
  PrivateCanaryProbeResult,
} from '@data-foundry/private-canary';
import {
  probePrivateCanaryDatabase,
  type PrivateCanaryDatabaseProbeOptions,
} from './composition.js';
import type { WebEnv } from './env.js';

export type PrivateCanaryProbeOptions = Pick<PrivateCanaryDatabaseProbeOptions, 'openDriver'>;

function failedProbe(): never {
  throw new Error('Private canary probe failed.');
}

/** Service-binding-only database readiness; no public page is rendered. */
export async function probePrivateCanaryReadiness(
  input: PrivateCanaryProbeInput,
  env: WebEnv,
  options: PrivateCanaryProbeOptions = {},
): Promise<PrivateCanaryProbeResult> {
  try {
    await probePrivateCanaryDatabase({ env, ...options });

    return {
      worker: 'web',
      runId: input.runId,
      readiness: 'READY',
      metering: 'NOT_APPLICABLE',
    };
  } catch {
    return failedProbe();
  }
}
