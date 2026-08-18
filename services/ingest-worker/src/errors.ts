/**
 * Ingest-worker error vocabulary.
 *
 * Every error class here is *classified* rather than merely named: the job
 * runner has to decide whether a failure is worth retrying, and that decision
 * must be a property of the error type rather than a string match on a message.
 * A misclassified error either burns the retry budget on a permanent
 * configuration bug, or silently gives up on a transient one.
 */

export type IngestErrorClass =
  /** Configuration or contract is wrong; retrying changes nothing. */
  | 'CONFIGURATION'
  /** Rights/robots refused the work. Never retried — the answer is "no". */
  | 'RIGHTS'
  /** Upstream or infrastructure hiccup; a later attempt may succeed. */
  | 'TRANSIENT'
  /** The data itself is unusable at this stage. */
  | 'DATA';

export class IngestError extends Error {
  override readonly name: string = 'IngestError';
  readonly code: string;
  readonly errorClass: IngestErrorClass;

  constructor(
    code: string,
    message: string,
    errorClass: IngestErrorClass = 'DATA',
    options: { readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.errorClass = errorClass;
  }

  get retryable(): boolean {
    return this.errorClass === 'TRANSIENT';
  }
}

export class PipelineConfigurationError extends IngestError {
  override readonly name = 'PipelineConfigurationError';

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super('PIPELINE_CONFIGURATION', message, 'CONFIGURATION', options);
  }
}

export class MappingCompilationError extends IngestError {
  override readonly name = 'MappingCompilationError';
  readonly path: string;

  constructor(path: string, message: string) {
    super('MAPPING_COMPILATION', `${path}: ${message}`, 'CONFIGURATION');
    this.path = path;
  }
}

/**
 * Classifies an arbitrary thrown value for the retry-metadata block on a FAILED
 * job. Unknown errors are treated as retryable-once rather than permanent: an
 * unclassified failure is more often a transient environment problem than a
 * contract violation, and the attempt budget bounds the damage either way.
 */
export function classifyError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
} {
  if (error instanceof IngestError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) {
    const retryable = error.name !== 'RightsViolationError' && error.name !== 'AcquisitionRefusedError';
    return { code: error.name, message: error.message, retryable };
  }
  return { code: 'UNKNOWN', message: String(error), retryable: true };
}
