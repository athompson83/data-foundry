import type { AcquisitionMethod } from '@data-foundry/canonical-schema';
import { AcquisitionError } from '../errors.js';
import type { AcquisitionResultUrlPolicy } from '../types.js';

export type AcquisitionResultRelation = 'TARGET' | 'CHILD_RESOURCE';

export class AcquisitionResultPolicyError extends AcquisitionError {
  override readonly name = 'AcquisitionResultPolicyError';
  constructor() {
    super('Provider result is outside the canonical acquisition result policy.');
  }
}

const pathMatches = (path: string, prefix: string): boolean =>
  path === prefix ||
  (prefix.endsWith('/') && path.startsWith(prefix)) ||
  (!prefix.endsWith('/') && path.startsWith(`${prefix}/`));

const unsafe = (value: string): boolean =>
  value.includes('\\') || /%(?:2e|2f|5c)/i.test(value);

/** Mandatory shared pre-store matcher. Omitted policy means exact target only. */
export function classifyAcquisitionResult(input: {
  readonly targetUrl: string;
  readonly resultUrl: string;
  readonly acquisitionRoute: AcquisitionMethod;
  readonly policy?: AcquisitionResultUrlPolicy | undefined;
}): AcquisitionResultRelation {
  let result: URL;
  try {
    result = new URL(input.resultUrl);
  } catch {
    throw new AcquisitionResultPolicyError();
  }
  if (
    result.protocol !== 'https:' ||
    result.username !== '' ||
    result.password !== '' ||
    result.hash !== '' ||
    unsafe(input.resultUrl)
  ) {
    throw new AcquisitionResultPolicyError();
  }
  if (input.resultUrl === input.targetUrl) return 'TARGET';
  if (
    input.policy === undefined ||
    (input.acquisitionRoute !== 'BROWSER_RUN' && input.acquisitionRoute !== 'CRAWL4AI') ||
    !input.policy.allowedOrigins.includes(result.origin) ||
    !input.policy.allowedPathPrefixes.some((prefix) => pathMatches(result.pathname, prefix))
  ) {
    throw new AcquisitionResultPolicyError();
  }
  return 'CHILD_RESOURCE';
}
