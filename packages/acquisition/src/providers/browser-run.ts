import type { AcquisitionMethod } from '@data-foundry/source-registry';
import { AcquisitionConfigurationError, ProviderTransportError } from '../errors.js';
import type { FetchedResource, ProviderTransportResult } from '../types.js';
import {
  asNumber,
  asString,
  isRecord,
  readJson,
  requireFetch,
  timeoutSignal,
  type FetchLike,
  type HttpRequestInit,
} from './http-client.js';
import { BaseAcquisitionProvider, type AcquisitionProviderDeps, type TransportContext } from './base.js';

/**
 * Cloudflare Browser Run adapter (doc 05, "Cloudflare Browser Run role").
 *
 * Speaks the documented REST shape:
 *
 * ```text
 * POST /accounts/{account_id}/browser-rendering/crawl        -> { success, result: <jobId> }
 * GET  /accounts/{account_id}/browser-rendering/crawl/{job}  -> { success, result: { status, ... } }
 * POST /accounts/{account_id}/browser-rendering/json         -> { success, result: <extraction> }
 * ```
 *
 * Crawl jobs are asynchronous, so `transport` initiates and then polls with the
 * injected clock — no wall-clock sleeping in tests.
 *
 * Two rules govern this file:
 *
 * - **Credentials are never hard-coded and never defaulted.** The account id and
 *   API token are constructor arguments; {@link browserRunConfigFromEnv} reads
 *   them from an explicitly supplied environment object and returns `null`
 *   rather than guessing.
 * - **Degrade, do not crash.** A record in an unexpected shape becomes a
 *   diagnostic; a `disallowed` record is dropped (Browser Run honours robots and
 *   so do we); only a genuine API failure raises.
 */

export const BROWSER_RUN_DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4';

export type BrowserRunFormat = 'html' | 'markdown' | 'json';

export interface BrowserRunCredentials {
  readonly accountId: string;
  readonly apiToken: string;
}

export interface BrowserRunAcquisitionProviderOptions {
  readonly deps: AcquisitionProviderDeps;
  readonly accountId: string;
  readonly apiToken: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  /** Output formats requested from `/crawl`; the first available one becomes the artifact body. */
  readonly formats?: readonly BrowserRunFormat[] | undefined;
  /** doc 05 prefers `render:false` (static fetch) before a rendered crawl. */
  readonly render?: boolean | undefined;
  readonly maxPages?: number | undefined;
  readonly maxDepth?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly maxPollAttempts?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Read credentials from an explicitly passed environment object.
 *
 * Takes the environment as an argument rather than reaching for `process.env`,
 * so a Worker, a test and a CLI all supply their own and nothing silently picks
 * up an ambient token.
 */
export function browserRunConfigFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): BrowserRunCredentials | null {
  const accountId = env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = env['CLOUDFLARE_API_TOKEN'];
  if (accountId === undefined || accountId === '' || apiToken === undefined || apiToken === '') {
    return null;
  }
  return { accountId, apiToken };
}

const RUNNING_STATUSES = new Set(['running', 'queued', 'pending']);

export class BrowserRunAcquisitionProvider extends BaseAcquisitionProvider {
  readonly id = 'browser-run';
  readonly version = '1.0.0';
  readonly methods: readonly AcquisitionMethod[] = ['BROWSER_RUN'];

  readonly #fetch: FetchLike;
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #baseUrl: string;
  readonly #formats: readonly BrowserRunFormat[];
  readonly #render: boolean;
  readonly #maxPages: number | null;
  readonly #maxDepth: number | null;
  readonly #pollIntervalMs: number;
  readonly #maxPollAttempts: number;
  readonly #timeoutMs: number;

  constructor(options: BrowserRunAcquisitionProviderOptions) {
    super(options.deps);
    if (options.accountId.trim() === '' || options.apiToken.trim() === '') {
      throw new AcquisitionConfigurationError(
        'BrowserRunAcquisitionProvider requires a Cloudflare account id and API token. ' +
          'Supply them from configuration or browserRunConfigFromEnv(env); they are never defaulted.',
      );
    }
    this.#fetch = requireFetch('browser-run', options.fetch);
    this.#accountId = options.accountId;
    this.#apiToken = options.apiToken;
    this.#baseUrl = (options.baseUrl ?? BROWSER_RUN_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.#formats = options.formats ?? ['html'];
    this.#render = options.render ?? false;
    this.#maxPages = options.maxPages ?? null;
    this.#maxDepth = options.maxDepth ?? null;
    this.#pollIntervalMs = options.pollIntervalMs ?? 2_000;
    this.#maxPollAttempts = options.maxPollAttempts ?? 60;
    this.#timeoutMs = options.timeoutMs ?? 60_000;
  }

  protected async transport(context: TransportContext): Promise<ProviderTransportResult> {
    const mode = readOption(context.request.providerOptions, 'mode');
    if (mode === 'json') return this.#extractJson(context);
    return this.#crawl(context);
  }

  /** `/json` — structured extraction where selectors are unstable but the record shape is clear. */
  async #extractJson(context: TransportContext): Promise<ProviderTransportResult> {
    const options = context.request.providerOptions ?? {};
    const prompt = readOption(options, 'prompt');
    const responseFormat = options['response_format'];

    const result = await this.#call(`browser-rendering/json`, {
      method: 'POST',
      body: JSON.stringify({
        url: context.request.url,
        ...(prompt !== null ? { prompt } : {}),
        ...(responseFormat !== undefined ? { response_format: responseFormat } : {}),
      }),
    });

    const body = new TextEncoder().encode(JSON.stringify(result ?? null));
    return {
      resources: [
        {
          url: context.request.url,
          httpStatus: 200,
          headers: { 'content-type': 'application/json' },
          body,
          mimeType: 'application/json',
          variant: 'json',
        },
      ],
      notModified: false,
      diagnostics: [],
    };
  }

  /** `/crawl` — initiate, poll, paginate, map. */
  async #crawl(context: TransportContext): Promise<ProviderTransportResult> {
    const diagnostics: string[] = [];

    // Incremental hint: Browser Run skips pages unchanged since this instant, which
    // is the crawl-shaped equivalent of If-Modified-Since.
    const modifiedSince = unixSeconds(context.conditional?.lastModified);

    const initiated = await this.#call('browser-rendering/crawl', {
      method: 'POST',
      body: JSON.stringify({
        url: context.request.url,
        formats: this.#formats,
        render: this.#render,
        ...(this.#maxPages !== null ? { limit: this.#maxPages } : {}),
        ...(this.#maxDepth !== null ? { maxDepth: this.#maxDepth } : {}),
        ...(modifiedSince !== null ? { modifiedSince } : {}),
      }),
    });

    const jobId = readJobId(initiated);
    if (jobId === null) {
      throw new ProviderTransportError(
        this.id,
        `crawl initiation returned no job id (received ${JSON.stringify(initiated)?.slice(0, 200)})`,
      );
    }

    const records: unknown[] = [];
    let cursor: string | null = null;
    let attempts = 0;
    let jobStatus = 'running';

    for (;;) {
      const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      const page: unknown = await this.#call(`browser-rendering/crawl/${jobId}${query}`, {
        method: 'GET',
      });
      if (!isRecord(page)) {
        diagnostics.push('crawl status response was not an object; treating the job as empty');
        break;
      }

      jobStatus = asString(page['status']) ?? 'completed';
      if (RUNNING_STATUSES.has(jobStatus)) {
        attempts += 1;
        if (attempts > this.#maxPollAttempts) {
          throw new ProviderTransportError(
            this.id,
            `crawl job ${jobId} did not finish within ${this.#maxPollAttempts} polls`,
          );
        }
        await context.clock.sleep(this.#pollIntervalMs);
        continue;
      }

      if (jobStatus !== 'completed') {
        throw new ProviderTransportError(this.id, `crawl job ${jobId} ended with status ${jobStatus}`);
      }

      for (const record of readRecords(page)) records.push(record);
      cursor = asString(page['cursor']);
      if (cursor === null) break;
    }

    const resources: FetchedResource[] = [];
    let skipped = 0;

    for (const raw of records) {
      if (!isRecord(raw)) {
        diagnostics.push('skipped a crawl record that was not an object');
        continue;
      }
      const url = asString(raw['url']);
      if (url === null) {
        diagnostics.push('skipped a crawl record with no url');
        continue;
      }

      const status = raw['status'];
      if (typeof status === 'string') {
        if (status === 'disallowed') {
          diagnostics.push(`${url}: robots disallowed by Browser Run; not fetched`);
          continue;
        }
        if (status === 'skipped') {
          skipped += 1;
          diagnostics.push(`${url}: skipped as unchanged or out of scope`);
          continue;
        }
        if (status !== 'completed') {
          diagnostics.push(`${url}: crawl record status ${status}; nothing stored`);
          continue;
        }
      }

      const httpStatus = asNumber(status) ?? 200;
      const payload = readRecordPayload(raw, this.#formats);
      if (payload === null) {
        diagnostics.push(`${url}: crawl record carried none of the requested formats`);
        continue;
      }

      resources.push({
        url,
        httpStatus,
        headers: { 'content-type': payload.mimeType },
        body: new TextEncoder().encode(payload.text),
        mimeType: payload.mimeType,
        variant: payload.variant,
      });
    }

    return {
      resources,
      // Every discovered page was skipped as unchanged: that is a 304 for a crawl.
      notModified: modifiedSince !== null && resources.length === 0 && skipped > 0,
      diagnostics,
    };
  }

  /** One Cloudflare API call, unwrapping the standard `{ success, result, errors }` envelope. */
  async #call(path: string, init: HttpRequestInit): Promise<unknown> {
    const url = `${this.#baseUrl}/accounts/${this.#accountId}/${path}`;
    const signal = timeoutSignal(this.#timeoutMs);
    const response = await this.#fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${this.#apiToken}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
      ...(signal !== undefined ? { signal } : {}),
    });

    const payload = await readJson(this.id, response);

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderTransportError(
        this.id,
        `${path} failed with HTTP ${response.status}: ${describeErrors(payload)}`,
        response.status,
      );
    }
    if (!isRecord(payload)) {
      throw new ProviderTransportError(this.id, `${path} returned a non-object body`, response.status);
    }
    if (payload['success'] === false) {
      throw new ProviderTransportError(
        this.id,
        `${path} reported failure: ${describeErrors(payload)}`,
        response.status,
      );
    }
    return payload['result'];
  }
}

function readOption(
  options: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | null {
  if (options === undefined) return null;
  return asString(options[key]);
}

function readJobId(result: unknown): string | null {
  if (typeof result === 'string' && result !== '') return result;
  if (isRecord(result)) return asString(result['id']) ?? asString(result['jobId']);
  return null;
}

/** The results array has moved between `records`, `results` and `data` across releases. */
function readRecords(page: Record<string, unknown>): readonly unknown[] {
  for (const key of ['records', 'results', 'data', 'urls'] as const) {
    const value = page[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

interface RecordPayload {
  readonly text: string;
  readonly mimeType: string;
  readonly variant: BrowserRunFormat;
}

function readRecordPayload(
  record: Record<string, unknown>,
  formats: readonly BrowserRunFormat[],
): RecordPayload | null {
  // Preference order follows the requested formats: raw HTML is the strongest
  // evidence (rule 10), Markdown is lossy, JSON is already an interpretation.
  const order = formats.length > 0 ? formats : (['html', 'markdown', 'json'] as const);
  for (const format of order) {
    const value = record[format];
    if (format === 'json') {
      if (value !== undefined && value !== null) {
        return { text: JSON.stringify(value), mimeType: 'application/json', variant: 'json' };
      }
      continue;
    }
    const text = asString(value);
    if (text !== null) {
      return {
        text,
        mimeType: format === 'html' ? 'text/html' : 'text/markdown',
        variant: format,
      };
    }
  }
  return null;
}

function describeErrors(payload: unknown): string {
  if (!isRecord(payload)) return 'no error detail';
  const errors = payload['errors'];
  if (!Array.isArray(errors) || errors.length === 0) return 'no error detail';
  return errors
    .map((error) => (isRecord(error) ? (asString(error['message']) ?? JSON.stringify(error)) : String(error)))
    .join('; ');
}

function unixSeconds(httpDate: string | undefined): number | null {
  if (httpDate === undefined || httpDate === '') return null;
  const parsed = Date.parse(httpDate);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
