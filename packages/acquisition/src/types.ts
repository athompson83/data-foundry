import type { SourceArtifact, SourceId } from '@data-foundry/canonical-schema';
import type { ConditionalValidators } from './policy/conditional.js';
import type { PolicySnapshot } from './policy/policy-snapshot.js';
import type { StoredArtifact } from './storage/artifact-store.js';

/**
 * The acquisition vocabulary.
 *
 * Acquisition knows about bytes, URLs, headers, hashes and rights. It does not
 * know what an entity is, what a fact is, or which vertical it is serving —
 * `verticalSlug` here is a *storage partition and a registry lookup key*, not
 * domain knowledge. Nothing in this file may grow a field that only makes sense
 * for one vertical.
 */

export type HttpMethod = 'GET' | 'HEAD' | 'POST';

export interface AcquisitionResultUrlPolicy {
  readonly allowedOrigins: readonly string[];
  readonly allowedPathPrefixes: readonly string[];
}

/**
 * One unit of work handed to a provider.
 *
 * `sourceKey` + `verticalSlug` resolve the rights record; `sourceId` is the
 * canonical database identity that artifacts are attributed to. Both are
 * required — the first is how policy is looked up, the second is how provenance
 * is threaded, and deriving one from the other would couple the registry file
 * layout to the database.
 */
export interface SourceRequest {
  readonly sourceId: SourceId;
  readonly sourceKey: string;
  readonly verticalSlug: string;
  readonly url: string;
  /**
   * Durable caller-owned retrieval scope (the scheduled run id in production).
   * When present, every returned resource receives a receipt id bound to this
   * scope, its result URL, and the selected provider.
   */
  readonly retrievalScopeId?: string | undefined;
  /** Omit for exact-target-only; only browser/crawler routes may use children. */
  readonly resultUrlPolicy?: AcquisitionResultUrlPolicy | undefined;
  readonly method?: HttpMethod | undefined;
  /** Extra request headers. Lowercased on the way out; never carries credentials by default. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly body?: string | undefined;
  /**
   * Validators from the previous run. When omitted, the provider consults its
   * {@link ValidatorCache}, so incremental behaviour is the default rather than
   * something every caller has to remember.
   */
  readonly conditional?: ConditionalValidators | undefined;
  readonly timeoutMs?: number | undefined;
  /** Hard ceiling on the response body; exceeded bodies fail rather than truncate. */
  readonly maxBytes?: number | undefined;
  /**
   * Opaque, provider-specific knobs (crawl depth, extraction prompt, fixture
   * variant). Callers that set these are choosing a provider on purpose; callers
   * that do not must still work against every provider.
   */
  readonly providerOptions?: Readonly<Record<string, unknown>> | undefined;
}

/** One retrieved byte stream, before it becomes evidence. */
export interface FetchedResource {
  readonly url: string;
  readonly httpStatus: number;
  /** Response headers, lowercased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly mimeType: string;
  /** Transport label for multi-format responses, e.g. `html`, `markdown`, `json`. */
  readonly variant?: string | undefined;
}

/** What a provider's transport returns, before storage and rights stamping. */
export interface ProviderTransportResult {
  readonly resources: readonly FetchedResource[];
  /** Nothing changed since the supplied validators; no bytes were transferred. */
  readonly notModified: boolean;
  readonly diagnostics: readonly string[];
}

export const ACQUISITION_OUTCOMES = ['FETCHED', 'NOT_MODIFIED', 'EMPTY'] as const;
export type AcquisitionOutcome = (typeof ACQUISITION_OUTCOMES)[number];

/**
 * The result of `AcquisitionProvider.fetch`.
 *
 * `artifacts` is the doc 02 contract (`fetch(source_request) -> SourceArtifact[]`).
 * Everything alongside it exists so the caller never has to ask the provider a
 * follow-up question: what policy was in force, what should the next incremental
 * run send, and where did the bytes land.
 */
export interface AcquisitionResult {
  readonly provider: string;
  readonly request: SourceRequest;
  readonly outcome: AcquisitionOutcome;
  readonly artifacts: readonly SourceArtifact[];
  readonly stored: readonly StoredArtifact[];
  readonly policySnapshot: PolicySnapshot;
  /** Validators to replay on the next run for this URL. */
  readonly validators: ConditionalValidators;
  readonly fetchedAt: string;
  readonly waitedMs: number;
  readonly diagnostics: readonly string[];
}
