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

/** Path-segment prefix match shared by every result-URL policy check. */
export const pathMatchesPrefix = (path: string, prefix: string): boolean =>
  path === prefix ||
  (prefix.endsWith('/') && path.startsWith(prefix)) ||
  (!prefix.endsWith('/') && path.startsWith(`${prefix}/`));

/** Encoded separators or backslashes that could smuggle a path past a prefix check. */
export const hasUnsafeUrlEncoding = (value: string): boolean =>
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
    hasUnsafeUrlEncoding(input.resultUrl)
  ) {
    throw new AcquisitionResultPolicyError();
  }
  if (input.resultUrl === input.targetUrl) return 'TARGET';
  if (
    input.policy === undefined ||
    (input.acquisitionRoute !== 'BROWSER_RUN' && input.acquisitionRoute !== 'CRAWL4AI') ||
    !input.policy.allowedOrigins.includes(result.origin) ||
    !input.policy.allowedPathPrefixes.some((prefix) => pathMatchesPrefix(result.pathname, prefix))
  ) {
    throw new AcquisitionResultPolicyError();
  }
  return 'CHILD_RESOURCE';
}
