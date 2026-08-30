import type { AcquisitionMethod } from '@data-foundry/source-registry';
import { AcquisitionConfigurationError, ProviderTransportError } from '../errors.js';
import { matchesValidators, normalizeEtag } from '../policy/conditional.js';
import type { FetchedResource, ProviderTransportResult } from '../types.js';
import {
  asNumber,
  asString,
  isRecord,
  MAX_CONTROL_PLANE_JSON_RESPONSE_BYTES,
  normalizeHeaderRecord,
  readJson,
  requireFetch,
  timeoutSignal,
  type FetchLike,
} from './http-client.js';
import { BaseAcquisitionProvider, type AcquisitionProviderDeps, type TransportContext } from './base.js';

/**
 * Crawl4AI adapter (doc 05, step 7 of the acquisition hierarchy: customized
 * extraction where a generic crawl is not enough).
 *
 * Talks to a Crawl4AI service over its REST shape:
 *
 * ```text
 * POST {baseUrl}/crawl  { urls, browser_config, crawler_config }
 *   -> { success, results: [{ url, html, cleaned_html, markdown, status_code, response_headers }] }
 * ```
 *
 * Crawl4AI has no native conditional-request support, so this adapter evaluates
 * the caller's validators against the response's own `ETag`/`Last-Modified`
 * before storing anything. That keeps "unchanged means no new artifact"
 * true for every provider rather than only for the ones whose upstream happens
 * to implement HTTP caching.
 */

export type Crawl4AiFormat = 'html' | 'cleaned_html' | 'markdown' | 'extracted_content';

export const CRAWL4AI_MAX_RESULTS = 1_000;
export const CRAWL4AI_MAX_DIAGNOSTIC_BYTES = 256 * 1024;
const CRAWL4AI_MAX_RESULT_URL_BYTES = 8 * 1024;
const CRAWL4AI_MAX_ERROR_MESSAGE_BYTES = 1_024;

export interface Crawl4AiAcquisitionProviderOptions {
  readonly deps: AcquisitionProviderDeps;
  /** Base URL of the Crawl4AI service, e.g. `http://crawl4ai.internal:11235`. */
  readonly baseUrl: string;
  /** Bearer token when the service is protected. Never defaulted. */
  readonly apiToken?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  /** Which field of a Crawl4AI result becomes the artifact body, in preference order. */
  readonly formats?: readonly Crawl4AiFormat[] | undefined;
  readonly browserConfig?: Readonly<Record<string, unknown>> | undefined;
  readonly crawlerConfig?: Readonly<Record<string, unknown>> | undefined;
  readonly timeoutMs?: number | undefined;
}

const MIME_BY_FORMAT: Readonly<Record<Crawl4AiFormat, string>> = {
  html: 'text/html',
  cleaned_html: 'text/html',
  markdown: 'text/markdown',
  extracted_content: 'application/json',
};

export class Crawl4AIAcquisitionProvider extends BaseAcquisitionProvider {
  readonly id = 'crawl4ai';
  readonly version = '1.0.0';
  readonly methods: readonly AcquisitionMethod[] = ['CRAWL4AI'];

  readonly #fetch: FetchLike;
  readonly #baseUrl: string;
  readonly #apiToken: string | null;
  readonly #formats: readonly Crawl4AiFormat[];
  readonly #browserConfig: Readonly<Record<string, unknown>>;
  readonly #crawlerConfig: Readonly<Record<string, unknown>>;
  readonly #timeoutMs: number;

  constructor(options: Crawl4AiAcquisitionProviderOptions) {
    super(options.deps);
    if (options.baseUrl.trim() === '') {
      throw new AcquisitionConfigurationError(
        'Crawl4AIAcquisitionProvider requires the base URL of a Crawl4AI service.',
      );
    }
    this.#fetch = requireFetch('crawl4ai', options.fetch);
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#apiToken = options.apiToken ?? null;
    this.#formats = options.formats ?? ['html', 'cleaned_html', 'markdown'];
    this.#browserConfig = options.browserConfig ?? {};
    this.#crawlerConfig = options.crawlerConfig ?? {};
    this.#timeoutMs = options.timeoutMs ?? 120_000;
  }

  protected async transport(context: TransportContext): Promise<ProviderTransportResult> {
    const diagnostics: string[] = [];
    let diagnosticBytes = 0;
    const addDiagnostic = (message: string): void => {
      const messageBytes = encodedByteLength(message);
      if (messageBytes > CRAWL4AI_MAX_DIAGNOSTIC_BYTES - diagnosticBytes) {
        throw new ProviderTransportError(
          this.id,
          `crawl diagnostics exceeded the ${CRAWL4AI_MAX_DIAGNOSTIC_BYTES}-byte ceiling`,
        );
      }
      diagnosticBytes += messageBytes;
      diagnostics.push(message);
    };
    const signal = timeoutSignal(context.request.timeoutMs ?? this.#timeoutMs);

    const response = await this.#fetch(`${this.#baseUrl}/crawl`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.#apiToken !== null ? { authorization: `Bearer ${this.#apiToken}` } : {}),
      },
      body: JSON.stringify({
        urls: [context.request.url],
        browser_config: this.#browserConfig,
        crawler_config: {
          ...this.#crawlerConfig,
          ...(Object.keys(context.headers).length > 0 ? { headers: context.headers } : {}),
        },
      }),
      ...(signal !== undefined ? { signal } : {}),
    });

    const payload = await readJson(
      this.id,
      response,
      MAX_CONTROL_PLANE_JSON_RESPONSE_BYTES,
    );

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderTransportError(
        this.id,
        `/crawl failed with HTTP ${response.status}`,
        response.status,
      );
    }
    if (!isRecord(payload)) {
      throw new ProviderTransportError(this.id, '/crawl returned a non-object body', response.status);
    }
    if (payload['success'] === false) {
      const detail = boundedProviderText(
        this.id,
        'crawl error message',
        asString(payload['error_message']) ?? asString(payload['detail']) ?? 'no detail',
        CRAWL4AI_MAX_ERROR_MESSAGE_BYTES,
      );
      throw new ProviderTransportError(this.id, `/crawl reported failure: ${detail}`, response.status);
    }

    const results = payload['results'];
    if (!Array.isArray(results)) {
      return {
        resources: [],
        notModified: false,
        diagnostics: ['/crawl returned no results array; nothing acquired'],
      };
    }
    if (results.length > CRAWL4AI_MAX_RESULTS) {
      throw new ProviderTransportError(
        this.id,
        `/crawl exceeded the local result limit of ${CRAWL4AI_MAX_RESULTS}`,
      );
    }

    const resources: FetchedResource[] = [];
    let unchanged = 0;

    for (const raw of results) {
      if (!isRecord(raw)) {
        addDiagnostic('skipped a crawl4ai result that was not an object');
        continue;
      }
      const url = boundedProviderText(
        this.id,
        'crawl result URL',
        asString(raw['url']) ?? context.request.url,
        CRAWL4AI_MAX_RESULT_URL_BYTES,
      );

      if (raw['success'] === false) {
        const message = boundedProviderText(
          this.id,
          'crawl result error message',
          asString(raw['error_message']) ?? 'no detail',
          CRAWL4AI_MAX_ERROR_MESSAGE_BYTES,
        );
        addDiagnostic(`${url}: crawl4ai reported failure (${message}); nothing stored`);
        continue;
      }

      const headers = normalizeHeaderRecord(raw['response_headers']);
      const etag = headers['etag'];
      const lastModified = headers['last-modified'];

      // Conditional evaluation, performed here because the upstream will not do it.
      if (
        matchesValidators(context.conditional, {
          ...(etag !== undefined ? { etag: normalizeEtag(etag) } : {}),
          ...(lastModified !== undefined ? { lastModified } : {}),
        })
      ) {
        unchanged += 1;
        addDiagnostic(`${url}: validators match the previous acquisition; nothing stored`);
        continue;
      }

      const payloadForRecord = readPayload(raw, this.#formats);
      if (payloadForRecord === null) {
        addDiagnostic(`${url}: result carried none of the requested formats`);
        continue;
      }

      resources.push({
        url,
        httpStatus: asNumber(raw['status_code']) ?? 200,
        headers: { 'content-type': payloadForRecord.mimeType, ...headers },
        body: new TextEncoder().encode(payloadForRecord.text),
        mimeType: payloadForRecord.mimeType,
        variant: payloadForRecord.variant,
      });
    }

    return {
      resources,
      notModified: resources.length === 0 && unchanged > 0,
      diagnostics,
    };
  }
}

function encodedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedProviderText(provider: string, label: string, value: string, maxBytes: number): string {
  if (encodedByteLength(value) > maxBytes) {
    throw new ProviderTransportError(provider, `${label} exceeded the ${maxBytes}-byte ceiling`);
  }
  return value;
}

interface Crawl4AiPayload {
  readonly text: string;
  readonly mimeType: string;
  readonly variant: Crawl4AiFormat;
}

function readPayload(
  result: Record<string, unknown>,
  formats: readonly Crawl4AiFormat[],
): Crawl4AiPayload | null {
  for (const format of formats) {
    const value = result[format];
    const text = readText(value);
    if (text !== null && text !== '') {
      return { text, mimeType: MIME_BY_FORMAT[format], variant: format };
    }
  }
  return null;
}

/** `markdown` is a string in older builds and `{ raw_markdown, fit_markdown }` in newer ones. */
function readText(value: unknown): string | null {
  const direct = asString(value);
  if (direct !== null) return direct;
  if (isRecord(value)) {
    return (
      asString(value['raw_markdown']) ??
      asString(value['fit_markdown']) ??
      asString(value['markdown']) ??
      null
    );
  }
  return null;
}
