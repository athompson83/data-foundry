import type {
  AcquisitionRuntimeTarget,
} from '@data-foundry/acquisition';
import {
  AcquisitionResultPolicyError,
  classifyAcquisitionResult,
} from '@data-foundry/acquisition';
import type { ScheduledAcquisitionResultRelation } from '@data-foundry/canonical-store';

export class ScheduledResultManifestError extends Error {
  constructor() {
    super('Provider result is outside the compiled scheduled result manifest.');
    this.name = 'ScheduledResultManifestError';
  }
}

/**
 * Bind one returned resource to the exact compiled target before bytes reach R2.
 * Browser/crawler adapters may return child resources; other transports may not.
 */
export function classifyScheduledResult(
  target: AcquisitionRuntimeTarget,
  resultUrl: string,
): ScheduledAcquisitionResultRelation {
  try {
    return classifyAcquisitionResult({
      targetUrl: target.target_url,
      resultUrl,
      acquisitionRoute: target.source.acquisition_policy.method,
      policy: target.result_url_policy,
    });
  } catch (error) {
    if (!(error instanceof AcquisitionResultPolicyError)) throw error;
    throw new ScheduledResultManifestError();
  }
}
