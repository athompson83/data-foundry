import {
  RightsViolationError,
  SourceArtifactSchema,
  sourceArtifactId,
  type SourceArtifact,
} from '@data-foundry/canonical-schema';
import type {
  AcquisitionMethod,
  SourceRegistryEntry,
  SourceRegistryLoader,
} from '@data-foundry/source-registry';
import { systemClock, type Clock } from '../clock.js';
import { deterministicUuid, sha256Hex } from '../hashing.js';
import {
  conditionalHeaders,
  validatorsFromHeaders,
  type ConditionalValidators,
  type ValidatorCache,
} from '../policy/conditional.js';
import type { PolicySnapshot, PolicySnapshotRecorder } from '../policy/policy-snapshot.js';
import { classifyAcquisitionResult } from '../policy/result-policy.js';
import {
  evaluateAcquisitionGate,
  requireAcquisitionAllowed,
  type AllowedAcquisition,
} from '../policy/rights-gate.js';
import {
  PerSourceRateLimiter,
  type RateLimiter,
  type RateLimitPolicy,
} from '../policy/rate-limit.js';
import type { ArtifactStore, StoredArtifact } from '../storage/artifact-store.js';
import { artifactContentKey, artifactRetrievalReceiptId } from '../storage/keys.js';
import { ProviderTransportError } from '../errors.js';
import type { AcquisitionProvider } from '../provider.js';
import type {
  AcquisitionOutcome,
  AcquisitionResult,
  FetchedResource,
  ProviderTransportResult,
  SourceRequest,
} from '../types.js';

/**
 * Everything a provider needs that is not vendor-specific.
 *
 * Every adapter takes exactly these, so constructing a different provider is a
 * one-line change at the composition root rather than a rewiring exercise.
 */
export interface AcquisitionProviderDeps {
  readonly registry: SourceRegistryLoader;
  readonly artifactStore: ArtifactStore;
  readonly policyRecorder: PolicySnapshotRecorder;
  /**
   * Trusted, fresh authorization check performed after politeness waiting and
   * immediately before vendor transport. Production composition must reload
   * stored rights here; an earlier admission is not reusable after a wait.
   */
  readonly beforeTransport: (input: PreTransportCheckInput) => Promise<void>;
  /**
   * Trusted, fresh authorization check performed after the complete transport
   * result manifest is validated and immediately before persistence. This is
   * also required before a NOT_MODIFIED result can publish freshness.
   */
  readonly beforePersistence: (input: PrePersistenceCheckInput) => Promise<void>;
  readonly rateLimiter?: RateLimiter | undefined;
  readonly validatorCache?: ValidatorCache | undefined;
  readonly clock?: Clock | undefined;
  /** Crawler identity, sent on every request (doc 05: "identify the crawler"). */
  readonly userAgent?: string | undefined;
}

export interface PreTransportCheckInput {
  readonly request: SourceRequest;
  readonly entry: SourceRegistryEntry;
  readonly asOf: string;
}

export interface PrePersistenceCheckInput {
  readonly request: SourceRequest;
  readonly entry: SourceRegistryEntry;
  readonly asOf: string;
}

export const DEFAULT_USER_AGENT = 'DataFoundryBot/0.1 (+https://example.invalid/bot)';
export const MAX_ACQUISITION_DIAGNOSTIC_BYTES = 256 * 1024;

/**
 * What the vendor-specific half of a provider is handed.
 *
 * `allowed` is proof the gate ran and permitted this fetch. It is required, and
 * it can only be *constructed* by `requireAcquisitionAllowed`, so removing the
 * gate call from `fetch` fails the build rather than silently opening a hole.
 * The ordering is no longer a property of one `if` statement someone could
 * delete.
 *
 * It is not a runtime capability check. A caller determined to bypass the gate
 * can assert the type and cast past `protected`; no type erased at compile time
 * stops that. What keeps it honest inside this repository is a scan —
 * `test/boundary.test.ts` permits the assertion in one function only.
 */
export interface TransportContext {
  /** Proof the gate ran and allowed this fetch. Only the gate constructs it. */
  readonly allowed: AllowedAcquisition;
  readonly request: SourceRequest;
  readonly entry: SourceRegistryEntry;
  /** Validators to send, resolved from the request or the cache. */
  readonly conditional: ConditionalValidators | null;
  /** Request headers including user-agent and conditional headers, lowercased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly userAgent: string;
  readonly clock: Clock;
}

/**
 * Shared provider pipeline.
 *
 * The order below is the whole point of the class, and it is not negotiable per
 * adapter:
 *
 * ```text
 * resolve rights record → evaluate gate → record policy snapshot
 *   → (refuse here, before any transport exists)
 *   → resolve conditional validators → wait out the politeness budget
 *   → transport (the only vendor-specific step)
 *   → content-address into the evidence store → stamp policy onto artifacts
 * ```
 *
 * Subclasses implement {@link transport} and nothing else. That is what makes
 * "the rights gate refuses before any network call" a property of the package
 * rather than a property of each adapter's diligence.
 */
export abstract class BaseAcquisitionProvider implements AcquisitionProvider {
  abstract readonly id: string;
  abstract readonly version: string;
  abstract readonly methods: readonly AcquisitionMethod[];

  protected readonly deps: AcquisitionProviderDeps;
  protected readonly clock: Clock;
  protected readonly userAgent: string;
  readonly #rateLimiter: RateLimiter;

  constructor(deps: AcquisitionProviderDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
    this.#rateLimiter =
      deps.rateLimiter ?? new PerSourceRateLimiter({ clock: this.clock });
  }

  /** Vendor-specific retrieval. Called only after the gate has allowed the fetch. */
  protected abstract transport(context: TransportContext): Promise<ProviderTransportResult>;

  async fetch(request: SourceRequest): Promise<AcquisitionResult> {
    const asOf = this.clock.nowIso();

    // 1. No source without rights metadata (AGENTS.md rule 1). An undeclared
    //    source is not "probably fine"; it is unreviewed by definition.
    const entry = await this.deps.registry.getSource(request.verticalSlug, request.sourceKey);
    if (entry === null) {
      throw new RightsViolationError(
        'UNREVIEWED',
        `source "${request.sourceKey}" (${request.url})`,
        `SOURCE_NOT_DECLARED: no source registry entry for "${request.sourceKey}" in vertical ` +
          `"${request.verticalSlug}"; acquisition requires a rights record.`,
      );
    }

    // 2. Rights + politeness gate, then record the decision either way — a refusal
    //    is exactly the kind of thing an auditor asks about later.
    const gate = evaluateAcquisitionGate({
      entry,
      url: request.url,
      asOf,
      providerMethods: this.methods,
    });
    const policySnapshot = await this.deps.policyRecorder.record({
      entry,
      gate,
      capturedAt: asOf,
    });
    // Refuses on a blocked gate, and otherwise returns the proof that transport
    // requires. Removing this line does not "skip a check" — it fails to
    // produce the token, and the call to `this.transport` below stops compiling.
    const allowed = requireAcquisitionAllowed(entry, gate);

    // 3. Incremental refresh: replay last run's validators unless the caller overrode them.
    const conditional =
      request.conditional ??
      (await this.deps.validatorCache?.get(entry.key, request.url)) ??
      null;

    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      ...conditionalHeaders(conditional),
    };
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }

    // 4. Politeness budget: crawl-delay from robots, request budget from the source policy.
    const rateLimit: RateLimitPolicy = {
      crawlDelaySeconds: allowed.robots.crawlDelaySeconds,
      maxRequestsPerMinute: entry.acquisition_policy.max_requests_per_minute,
    };
    const waitedMs = await this.#rateLimiter.acquire(entry.key, rateLimit);

    // 5. Rights or the operator kill switch may have changed while this run
    //    waited for its politeness budget. Reload trusted state at the last
    //    possible boundary; refusal here happens before any vendor transport.
    await this.deps.beforeTransport({
      request,
      entry,
      asOf: this.clock.nowIso(),
    });

    // 6. The one vendor-specific step.
    const transportResult = await this.transport({
      allowed,
      request,
      entry,
      conditional,
      headers,
      userAgent: this.userAgent,
      clock: this.clock,
    });

    const fetchedAt = this.clock.nowIso();
    const diagnostics: string[] = [];
    const diagnosticEncoder = new TextEncoder();
    let diagnosticBytes = 0;
    let reservedDiagnosticBytes = 0;
    const diagnosticByteLength = (message: string): number =>
      diagnosticEncoder.encode(message).byteLength;
    const assertDiagnosticBudget = (messageBytes: number): void => {
      if (
        messageBytes >
        MAX_ACQUISITION_DIAGNOSTIC_BYTES - diagnosticBytes - reservedDiagnosticBytes
      ) {
        throw new ProviderTransportError(
          this.id,
          `acquisition diagnostics exceeded the ${MAX_ACQUISITION_DIAGNOSTIC_BYTES}-byte ceiling`,
        );
      }
    };
    const addDiagnostic = (message: string): void => {
      const messageBytes = diagnosticByteLength(message);
      assertDiagnosticBudget(messageBytes);
      diagnosticBytes += messageBytes;
      diagnostics.push(message);
    };
    const reserveDiagnostic = (message: string): void => {
      const messageBytes = diagnosticByteLength(message);
      assertDiagnosticBudget(messageBytes);
      reservedDiagnosticBytes += messageBytes;
    };
    const releaseReservedDiagnostic = (message: string): void => {
      reservedDiagnosticBytes -= diagnosticByteLength(message);
    };
    const consumeReservedDiagnostic = (message: string): void => {
      const messageBytes = diagnosticByteLength(message);
      reservedDiagnosticBytes -= messageBytes;
      diagnosticBytes += messageBytes;
      diagnostics.push(message);
    };
    for (const diagnostic of transportResult.diagnostics) addDiagnostic(diagnostic);

    if (transportResult.notModified) {
      const validators = this.#validateDurableValidators(conditional ?? {});
      addDiagnostic('not modified since the previous acquisition; no bytes stored');
      await this.deps.beforePersistence({
        request,
        entry,
        asOf: this.clock.nowIso(),
      });
      return {
        provider: this.id,
        request,
        outcome: 'NOT_MODIFIED',
        artifacts: [],
        stored: [],
        policySnapshot,
        validators,
        fetchedAt,
        waitedMs,
        diagnostics,
      };
    }

    const artifacts: SourceArtifact[] = [];
    const stored: StoredArtifact[] = [];
    const validatorsByResource = new Map<FetchedResource, ConditionalValidators>();
    const reservedResourceDiagnostics: string[] = [];
    // Preflight the complete result manifest before the first byte is written.
    // A multi-resource provider returning one off-scope URL or one malformed
    // canonical artifact/validator must leave R2 empty, not persist an allowed
    // prefix and fail halfway through the response.
    for (const resource of transportResult.resources) {
      if (resource.httpStatus === 304) {
        const diagnostic = `${resource.url}: 304 Not Modified; nothing stored`;
        reserveDiagnostic(diagnostic);
        reservedResourceDiagnostics.push(diagnostic);
        continue;
      }
      if (resource.httpStatus >= 400) {
        const diagnostic =
          `${resource.url}: upstream returned ${resource.httpStatus}; not stored as evidence`;
        reserveDiagnostic(diagnostic);
        reservedResourceDiagnostics.push(diagnostic);
        continue;
      }
      classifyAcquisitionResult({
        targetUrl: request.url,
        resultUrl: resource.url,
        acquisitionRoute: entry.acquisition_policy.method,
        policy: request.resultUrlPolicy,
      });
      const contentHash = sha256Hex(resource.body);
      const key = artifactContentKey({
        vertical: entry.vertical_slug,
        source: entry.key,
        contentHash,
      });
      this.#buildArtifact({
        entry,
        request,
        resource,
        fetchedAt,
        policySnapshot,
        contentHash,
        r2Uri: this.deps.artifactStore.uriFor(key),
        byteSize: resource.body.byteLength,
        retrievedAt: fetchedAt,
      });
      validatorsByResource.set(
        resource,
        this.#validateDurableValidators(validatorsFromHeaders(resource.headers, contentHash)),
      );
      const diagnostic =
        `${resource.url}: identical bytes already stored at ${key}; write skipped`;
      reserveDiagnostic(diagnostic);
      reservedResourceDiagnostics.push(diagnostic);
    }
    const hasPersistableResource = transportResult.resources.some(
      (resource) => resource.httpStatus !== 304 && resource.httpStatus < 400,
    );
    if (hasPersistableResource) {
      await this.deps.beforePersistence({
        request,
        entry,
        asOf: this.clock.nowIso(),
      });
    }
    // A crawl-shaped provider returns many resources; the validators we replay next
    // run must be the ones belonging to the URL we asked for, not whichever page
    // happened to come last.
    let primaryValidators: ConditionalValidators | null = null;
    let firstValidators: ConditionalValidators | null = null;

    for (const [resourceIndex, resource] of transportResult.resources.entries()) {
      const reservedDiagnostic = reservedResourceDiagnostics[resourceIndex];
      if (reservedDiagnostic === undefined) {
        throw new Error('A resource bypassed complete diagnostic-manifest preflight.');
      }
      if (resource.httpStatus === 304) {
        consumeReservedDiagnostic(reservedDiagnostic);
        continue;
      }
      if (resource.httpStatus >= 400) {
        consumeReservedDiagnostic(reservedDiagnostic);
        continue;
      }

      const record = await this.#storeResource({ entry, request, resource, fetchedAt, policySnapshot });
      stored.push(record.stored);
      artifacts.push(record.artifact);
      if (record.stored.deduplicated) {
        consumeReservedDiagnostic(reservedDiagnostic);
      } else {
        releaseReservedDiagnostic(reservedDiagnostic);
      }
      const resourceValidators = validatorsByResource.get(resource);
      if (resourceValidators === undefined) {
        throw new Error('A persistable resource bypassed complete result-manifest preflight.');
      }
      firstValidators ??= resourceValidators;
      if (resource.url === request.url) primaryValidators = resourceValidators;
    }

    const validators: ConditionalValidators =
      primaryValidators ?? firstValidators ?? conditional ?? {};

    if (this.deps.validatorCache !== undefined && artifacts.length > 0) {
      await this.deps.validatorCache.set(entry.key, request.url, validators);
    }

    const outcome: AcquisitionOutcome = artifacts.length === 0 ? 'EMPTY' : 'FETCHED';

    return {
      provider: this.id,
      request,
      outcome,
      artifacts,
      stored,
      policySnapshot,
      validators,
      fetchedAt,
      waitedMs,
      diagnostics,
    };
  }

  async #storeResource(input: {
    entry: SourceRegistryEntry;
    request: SourceRequest;
    resource: FetchedResource;
    fetchedAt: string;
    policySnapshot: PolicySnapshot;
  }): Promise<{ stored: StoredArtifact; artifact: SourceArtifact }> {
    const { entry, request, resource, fetchedAt, policySnapshot } = input;
    const etag = resource.headers['etag'];
    const lastModified = resource.headers['last-modified'];

    const stored = await this.deps.artifactStore.put({
      vertical: entry.vertical_slug,
      source: entry.key,
      body: resource.body,
      ...(request.retrievalScopeId === undefined
        ? {}
        : {
            retrievalReceiptId: artifactRetrievalReceiptId(
              request.retrievalScopeId,
              resource.url,
              this.id,
            ),
          }),
      metadata: {
        source_key: entry.key,
        vertical_slug: entry.vertical_slug,
        url: resource.url,
        retrieved_at: fetchedAt,
        http_status: resource.httpStatus,
        mime_type: resource.mimeType,
        policy_snapshot_id: policySnapshot.id,
        acquisition_provider: this.id,
        acquisition_route: entry.acquisition_policy.method,
        account_or_product_plan: entry.acquisition_policy.account_or_product_plan,
        acquisition_jurisdiction: entry.acquisition_policy.jurisdiction,
        etag: etag ?? null,
        last_modified: lastModified ?? null,
      },
    });

    return {
      stored,
      artifact: this.#buildArtifact({
        entry,
        request,
        resource,
        fetchedAt,
        policySnapshot,
        contentHash: stored.contentHash,
        r2Uri: stored.uri,
        byteSize: stored.byteSize,
        retrievedAt: stored.metadata.retrieved_at,
      }),
    };
  }

  #buildArtifact(input: {
    entry: SourceRegistryEntry;
    request: SourceRequest;
    resource: FetchedResource;
    fetchedAt: string;
    policySnapshot: PolicySnapshot;
    contentHash: StoredArtifact['contentHash'];
    r2Uri: StoredArtifact['uri'];
    byteSize: number;
    retrievedAt: string;
  }): SourceArtifact {
    const { entry, request, resource, fetchedAt, policySnapshot } = input;
    // Derived, not random: re-acquiring identical bytes must not mint a second
    // artifact identity for the same evidence.
    return SourceArtifactSchema.parse({
      id: sourceArtifactId(
        deterministicUuid(
          'data-foundry:source-artifact',
          request.sourceId,
          resource.url,
          input.contentHash,
          entry.acquisition_policy.method,
          entry.acquisition_policy.account_or_product_plan ?? 'NO_ACCOUNT_OR_PRODUCT_PLAN',
          entry.acquisition_policy.jurisdiction ?? 'NO_ACQUISITION_JURISDICTION',
        ),
      ),
      source_id: request.sourceId,
      url: resource.url,
      retrieved_at: input.retrievedAt,
      content_hash: input.contentHash,
      mime_type: resource.mimeType,
      r2_uri: input.r2Uri,
      http_status: resource.httpStatus,
      extractor_version: `${this.id}@${this.version}`,
      policy_snapshot_id: policySnapshot.id,
      byte_size: input.byteSize,
      acquisition_provider: this.id,
      acquisition_route: entry.acquisition_policy.method,
      account_or_product_plan: entry.acquisition_policy.account_or_product_plan,
      acquisition_jurisdiction: entry.acquisition_policy.jurisdiction,
      created_at: fetchedAt,
    });
  }

  #validateDurableValidators(validators: ConditionalValidators): ConditionalValidators {
    if (
      validators.etag !== undefined &&
      (validators.etag.length < 1 || validators.etag.length > 1_024)
    ) {
      throw new ProviderTransportError(
        this.id,
        'response ETag must contain 1-1024 characters before it can become durable state',
      );
    }
    if (
      validators.lastModified !== undefined &&
      (validators.lastModified.length < 1 || validators.lastModified.length > 128)
    ) {
      throw new ProviderTransportError(
        this.id,
        'response Last-Modified must contain 1-128 characters before it can become durable state',
      );
    }
    return validators;
  }
}
