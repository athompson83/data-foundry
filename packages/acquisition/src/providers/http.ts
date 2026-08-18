import type { AcquisitionMethod } from '@data-foundry/source-registry';
import { ProviderTransportError } from '../errors.js';
import type { ProviderTransportResult } from '../types.js';
import {
  headersToRecord,
  parseMimeType,
  requireFetch,
  timeoutSignal,
  type FetchLike,
} from './http-client.js';
import { BaseAcquisitionProvider, type AcquisitionProviderDeps, type TransportContext } from './base.js';

/**
 * Direct HTTP acquisition — the least brittle lawful method and therefore the
 * top of doc 05's acquisition hierarchy: official APIs, bulk downloads,
 * structured feeds and static HTML all arrive through here.
 *
 * It is format-blind on purpose. JSON, CSV, PDF, XML and HTML are all "bytes with
 * a mime type" at this layer; deciding what they mean is extraction's job.
 */
export interface HttpAcquisitionProviderOptions {
  readonly deps: AcquisitionProviderDeps;
  /** Injected for tests; defaults to the runtime's `fetch`. */
  readonly fetch?: FetchLike | undefined;
  readonly defaultTimeoutMs?: number | undefined;
  /** Hard body ceiling; a larger response fails rather than being silently truncated. */
  readonly maxBytes?: number | undefined;
  /** Methods this adapter is permitted to serve. */
  readonly methods?: readonly AcquisitionMethod[] | undefined;
}

const DEFAULT_METHODS: readonly AcquisitionMethod[] = [
  'DIRECT_HTTP',
  'VENDOR_API',
  'SITEMAP',
  'BULK_FILE',
  'RSS',
];

export class HttpAcquisitionProvider extends BaseAcquisitionProvider {
  readonly id = 'http';
  readonly version = '1.0.0';
  readonly methods: readonly AcquisitionMethod[];

  readonly #fetch: FetchLike;
  readonly #defaultTimeoutMs: number;
  readonly #maxBytes: number | null;

  constructor(options: HttpAcquisitionProviderOptions) {
    super(options.deps);
    this.#fetch = requireFetch('http', options.fetch);
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.#maxBytes = options.maxBytes ?? null;
    this.methods = options.methods ?? DEFAULT_METHODS;
  }

  protected async transport(context: TransportContext): Promise<ProviderTransportResult> {
    const { request } = context;
    const signal = timeoutSignal(request.timeoutMs ?? this.#defaultTimeoutMs);

    const response = await this.#fetch(request.url, {
      method: request.method ?? 'GET',
      headers: { ...context.headers },
      ...(request.body !== undefined ? { body: request.body } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });

    const headers = headersToRecord(response.headers);

    // A 304 is the point of conditional requests: no body, nothing to store, and
    // the previous artifact remains the current evidence.
    if (response.status === 304) {
      return {
        resources: [],
        notModified: true,
        diagnostics: [`${request.url}: 304 Not Modified`],
      };
    }

    const body = new Uint8Array(await response.arrayBuffer());
    const ceiling = request.maxBytes ?? this.#maxBytes;
    if (ceiling !== null && ceiling !== undefined && body.byteLength > ceiling) {
      throw new ProviderTransportError(
        this.id,
        `response body for ${request.url} is ${body.byteLength} bytes, over the ${ceiling}-byte ceiling`,
        response.status,
      );
    }

    return {
      resources: [
        {
          url: request.url,
          httpStatus: response.status,
          headers,
          body,
          mimeType: parseMimeType(headers['content-type'], 'application/octet-stream'),
        },
      ],
      notModified: false,
      diagnostics: [],
    };
  }
}
