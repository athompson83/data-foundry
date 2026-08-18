import { ACQUISITION_METHODS, type AcquisitionMethod } from '@data-foundry/source-registry';
import { AcquisitionConfigurationError, FixtureNotFoundError } from '../errors.js';
import { nodeFileSystem, type ReadOnlyFileSystem } from '../fs.js';
import { matchesValidators, normalizeEtag } from '../policy/conditional.js';
import type { FetchedResource, ProviderTransportResult } from '../types.js';
import { BaseAcquisitionProvider, type AcquisitionProviderDeps, type TransportContext } from './base.js';

/**
 * Fixture acquisition — the provider CI and the offline pipeline run on.
 *
 * This is deliberately not a toy. Golden-record tests, extraction tests and the
 * end-to-end pipeline all need acquisition to behave *identically* to a live
 * provider while being hermetic and deterministic, so this adapter implements
 * the same contract in full: real files on disk, declared HTTP status codes,
 * declared response headers, working conditional requests, and multi-resource
 * responses for crawl-shaped sources.
 *
 * It also serves every acquisition method, because a fixture stands in for
 * whichever provider the source's policy names. That makes "run the whole
 * pipeline offline" a matter of registering one provider.
 */

export interface FixtureEntry {
  readonly url: string;
  /** File under the fixture directory holding the body. */
  readonly file?: string | undefined;
  /** Inline body, for small fixtures that do not deserve their own file. */
  readonly body?: string | undefined;
  readonly status?: number | undefined;
  readonly mimeType?: string | undefined;
  /** Response headers, e.g. `{"etag": "\"v1\""}`. Lowercased on load. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
  /** Further URLs returned alongside this one, for crawl-shaped sources. */
  readonly related?: readonly string[] | undefined;
}

export interface FixtureManifest {
  readonly version: number;
  readonly entries: readonly FixtureEntry[];
}

export const DEFAULT_FIXTURE_MANIFEST = 'manifest.json';

export interface FixtureAcquisitionProviderOptions {
  readonly deps: AcquisitionProviderDeps;
  /** Directory holding the manifest and the body files. */
  readonly directory?: string | undefined;
  /** Manifest supplied inline instead of read from disk. */
  readonly manifest?: FixtureManifest | undefined;
  readonly manifestFileName?: string | undefined;
  readonly fs?: ReadOnlyFileSystem | undefined;
  /** Return a 404 resource for unknown URLs instead of raising. Default: raise. */
  readonly missingAs404?: boolean | undefined;
  readonly methods?: readonly AcquisitionMethod[] | undefined;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  pdf: 'application/pdf',
  txt: 'text/plain',
  xml: 'application/xml',
  jsonl: 'application/x-ndjson',
};

export class FixtureAcquisitionProvider extends BaseAcquisitionProvider {
  readonly id = 'fixture';
  readonly version = '1.0.0';
  readonly methods: readonly AcquisitionMethod[];

  readonly #directory: string;
  readonly #manifestFileName: string;
  readonly #fs: ReadOnlyFileSystem;
  readonly #missingAs404: boolean;
  #manifest: FixtureManifest | null;
  #index: Map<string, FixtureEntry> | null = null;

  constructor(options: FixtureAcquisitionProviderOptions) {
    super(options.deps);
    if (options.directory === undefined && options.manifest === undefined) {
      throw new AcquisitionConfigurationError(
        'FixtureAcquisitionProvider requires either a fixture directory or an inline manifest.',
      );
    }
    this.#directory = (options.directory ?? '.').replace(/[\\/]+$/, '');
    this.#manifestFileName = options.manifestFileName ?? DEFAULT_FIXTURE_MANIFEST;
    this.#fs = options.fs ?? nodeFileSystem;
    this.#missingAs404 = options.missingAs404 ?? false;
    this.#manifest = options.manifest ?? null;
    this.methods = options.methods ?? [...ACQUISITION_METHODS];
  }

  /** Every URL the fixture set can serve. Useful for asserting fixture coverage in CI. */
  async urls(): Promise<readonly string[]> {
    return [...(await this.#loadIndex()).keys()];
  }

  protected async transport(context: TransportContext): Promise<ProviderTransportResult> {
    const index = await this.#loadIndex();
    const entry = lookup(index, context.request.url);

    if (entry === null) {
      if (!this.#missingAs404) {
        throw new FixtureNotFoundError(context.request.url, this.#directory);
      }
      return {
        resources: [
          {
            url: context.request.url,
            httpStatus: 404,
            headers: {},
            body: new Uint8Array(),
            mimeType: 'text/plain',
          },
        ],
        notModified: false,
        diagnostics: [`${context.request.url}: no fixture declared`],
      };
    }

    const diagnostics: string[] = [];
    const primary = await this.#toResource(entry);

    // Conditional support: a fixture that declares an ETag or Last-Modified
    // answers 304 exactly as the origin would, so incremental behaviour is
    // exercised offline rather than only against a live server.
    const current = {
      ...(primary.headers['etag'] !== undefined
        ? { etag: normalizeEtag(primary.headers['etag']) }
        : {}),
      ...(primary.headers['last-modified'] !== undefined
        ? { lastModified: primary.headers['last-modified'] }
        : {}),
    };
    if (matchesValidators(context.conditional, current)) {
      return {
        resources: [],
        notModified: true,
        diagnostics: [`${entry.url}: fixture validators unchanged; 304`],
      };
    }

    const resources: FetchedResource[] = [primary];
    for (const relatedUrl of entry.related ?? []) {
      const related = lookup(index, relatedUrl);
      if (related === null) {
        diagnostics.push(`${relatedUrl}: referenced by ${entry.url} but not declared`);
        continue;
      }
      resources.push(await this.#toResource(related));
    }

    return { resources, notModified: false, diagnostics };
  }

  async #toResource(entry: FixtureEntry): Promise<FetchedResource> {
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(entry.headers ?? {})) {
      headers[name.toLowerCase()] = value;
    }

    let body: Uint8Array;
    if (entry.body !== undefined) {
      body = new TextEncoder().encode(entry.body);
    } else if (entry.file !== undefined) {
      body = await this.#fs.readFile(`${this.#directory}/${entry.file}`);
    } else {
      body = new Uint8Array();
    }

    const mimeType =
      entry.mimeType ??
      (entry.file !== undefined ? mimeForFile(entry.file) : undefined) ??
      'application/octet-stream';
    headers['content-type'] ??= mimeType;

    return {
      url: entry.url,
      httpStatus: entry.status ?? 200,
      headers,
      body,
      mimeType,
    };
  }

  async #loadIndex(): Promise<Map<string, FixtureEntry>> {
    if (this.#index !== null) return this.#index;

    if (this.#manifest === null) {
      const path = `${this.#directory}/${this.#manifestFileName}`;
      const raw = await this.#fs.readFile(path);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !Array.isArray((parsed as FixtureManifest).entries)
      ) {
        throw new AcquisitionConfigurationError(
          `Fixture manifest ${path} must be an object with an "entries" array.`,
        );
      }
      this.#manifest = parsed as FixtureManifest;
    }

    const index = new Map<string, FixtureEntry>();
    for (const entry of this.#manifest.entries) {
      index.set(canonicalizeUrl(entry.url), entry);
    }
    this.#index = index;
    return index;
  }
}

function lookup(index: Map<string, FixtureEntry>, url: string): FixtureEntry | null {
  return index.get(canonicalizeUrl(url)) ?? null;
}

/** Trailing-slash and case differences in the host should not miss a fixture. */
function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

function mimeForFile(file: string): string | undefined {
  const extension = file.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension];
}
