import type { AcquisitionGateCode, AcquisitionGateFinding } from './policy/gate-types.js';

/** Base class for every failure this package raises. */
export class AcquisitionError extends Error {
  override readonly name: string = 'AcquisitionError';
}

/** A provider was constructed without the configuration it needs (never with hard-coded defaults). */
export class AcquisitionConfigurationError extends AcquisitionError {
  override readonly name = 'AcquisitionConfigurationError';
}

/**
 * The rights/politeness gate refused the fetch. Raised **before** any transport
 * call, so a refusal is provably free of network traffic.
 */
export class AcquisitionRefusedError extends AcquisitionError {
  override readonly name: string = 'AcquisitionRefusedError';
  readonly code: AcquisitionGateCode;
  readonly sourceKey: string;
  readonly url: string;
  readonly blockers: readonly AcquisitionGateFinding[];

  constructor(input: {
    readonly sourceKey: string;
    readonly url: string;
    readonly blockers: readonly AcquisitionGateFinding[];
  }) {
    const blockers = input.blockers.length > 0 ? input.blockers : [
      { code: 'SOURCE_NOT_ACQUIRABLE' as const, message: 'refused without a recorded reason' },
    ];
    super(
      `Refusing to acquire ${input.url} from source "${input.sourceKey}": ` +
        blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(' | '),
    );
    this.code = blockers[0]?.code ?? 'SOURCE_NOT_ACQUIRABLE';
    this.sourceKey = input.sourceKey;
    this.url = input.url;
    this.blockers = blockers;
  }
}

/** Robots directives forbid this path for our user agent. */
export class RobotsDisallowedError extends AcquisitionRefusedError {
  override readonly name = 'RobotsDisallowedError';
}

/** The politeness budget for a source cannot be satisfied within the caller's wait budget. */
export class RateLimitExceededError extends AcquisitionError {
  override readonly name = 'RateLimitExceededError';
  readonly sourceKey: string;
  readonly requiredWaitMs: number;
  readonly maxWaitMs: number;

  constructor(sourceKey: string, requiredWaitMs: number, maxWaitMs: number) {
    super(
      `Rate limit for source "${sourceKey}" requires a ${requiredWaitMs}ms wait, ` +
        `which exceeds the ${maxWaitMs}ms budget.`,
    );
    this.sourceKey = sourceKey;
    this.requiredWaitMs = requiredWaitMs;
    this.maxWaitMs = maxWaitMs;
  }
}

/** The upstream acquisition service failed or answered in a shape we cannot use. */
export class ProviderTransportError extends AcquisitionError {
  override readonly name = 'ProviderTransportError';
  readonly provider: string;
  readonly httpStatus: number | null;

  constructor(provider: string, message: string, httpStatus: number | null = null) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
    this.httpStatus = httpStatus;
  }
}

/** The raw evidence store could not satisfy a read/write. */
export class ArtifactStoreError extends AcquisitionError {
  override readonly name = 'ArtifactStoreError';
}

/** A fixture directory does not describe the requested URL. */
export class FixtureNotFoundError extends AcquisitionError {
  override readonly name = 'FixtureNotFoundError';
  readonly url: string;

  constructor(url: string, directory: string) {
    super(`No fixture for ${url} in ${directory}`);
    this.url = url;
  }
}
