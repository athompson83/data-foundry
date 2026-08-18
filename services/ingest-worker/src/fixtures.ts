/**
 * The offline factory's fixture harness.
 *
 * `FixtureAcquisitionProvider` needs a manifest of URL → file. A vertical ships
 * fixtures but no machine-readable binding between them and its sources, so
 * this module derives one — and derives it *strictly*, failing loudly rather
 * than guessing, because a fixture silently bound to the wrong source would
 * make every golden assertion downstream meaningless.
 *
 * The binding rules, in order:
 *
 * 1. Candidates are the files under `fixtures/` whose extension matches the
 *    format the source declares in `source-mappings.yaml`.
 * 2. If the source's own registry entry names exactly one of those candidates
 *    anywhere in its text (`license_text_ref`, acquisition notes), that is the
 *    binding.
 * 3. Otherwise, if exactly one candidate exists, that is the binding.
 * 4. Otherwise it is ambiguous, and the vertical must say which.
 *
 * The URL is built from the source's own robots allow-list, so the fetch that
 * the offline factory performs is one the rights gate would also permit against
 * the live origin. A fixture that could only be acquired at a disallowed path
 * would be testing a request we are not permitted to make.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex, type FixtureEntry } from '@data-foundry/acquisition';
import { PipelineConfigurationError } from './errors.js';
import type { VerticalConfig } from './config.js';

/** YAML arrives untyped; every reader below narrows what it needs. */
type Yaml = any;

export interface FixtureBinding {
  readonly sourceKey: string;
  readonly file: string;
  readonly entry: FixtureEntry;
}

export interface FixtureManifestResult {
  /** Directory the manifest's `file` entries are resolved against. */
  readonly directory: string;
  readonly bindings: readonly FixtureBinding[];
}

const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  json: ['.json'],
  csv: ['.csv'],
  html: ['.html', '.htm'],
  pdf: ['.pdf'],
};

const MIME: Readonly<Record<string, string>> = {
  json: 'application/json',
  csv: 'text/csv',
  html: 'text/html',
  pdf: 'application/pdf',
};

export interface FixtureManifestOptions {
  /**
   * Source key → replacement body, served instead of the file on disk.
   *
   * The harness affordance that makes "the upstream value changed" testable:
   * an incremental re-run has to be provable against *different* bytes, not
   * only against identical ones, and mutating a committed fixture to prove it
   * would break every other test.
   */
  readonly overrides?: Readonly<Record<string, string>>;
}

export async function buildFixtureManifest(
  config: VerticalConfig,
  options: FixtureManifestOptions = {},
): Promise<FixtureManifestResult> {
  const fixturesDir = join(config.directory, 'fixtures');
  const files = (await readdir(fixturesDir)).sort();
  const bindings: FixtureBinding[] = [];

  for (const mapping of (config.sourceMappings?.sources ?? []) as Yaml[]) {
    const sourceKey = String(mapping.source_key);
    const format = String(mapping.format);
    const entry = config.sources.find((source) => source.key === sourceKey);
    if (entry === undefined) {
      throw new PipelineConfigurationError(
        `source-mappings.yaml declares "${sourceKey}", which has no source registry entry`,
      );
    }

    const extensions = EXTENSIONS[format] ?? [];
    const candidates = files.filter((file) =>
      extensions.some((extension) => file.toLowerCase().endsWith(extension)),
    );
    if (candidates.length === 0) {
      throw new PipelineConfigurationError(
        `no ${format} fixture in ${fixturesDir} for source "${sourceKey}"`,
      );
    }

    const declared = JSON.stringify(entry);
    const named = candidates.filter((file) => declared.includes(`fixtures/${file}`));
    const file = named.length === 1 ? named[0] : candidates.length === 1 ? candidates[0] : null;
    if (file === undefined || file === null) {
      throw new PipelineConfigurationError(
        `fixture binding for "${sourceKey}" is ambiguous between [${candidates.join(', ')}]; ` +
          'name the intended file in the source registry entry',
      );
    }

    const override = options.overrides?.[sourceKey];
    const body =
      override === undefined
        ? new Uint8Array(await readFile(join(fixturesDir, file)))
        : new TextEncoder().encode(override);
    bindings.push({
      sourceKey,
      file,
      entry: {
        url: fixtureUrl(entry.domain, entry.robots_policy.allowed_paths, file),
        ...(override === undefined ? { file } : { body: override }),
        status: 200,
        mimeType: MIME[format] ?? 'application/octet-stream',
        headers: {
          // A real validator, derived from the bytes, so conditional requests
          // are genuinely exercised offline rather than stubbed.
          etag: `"${sha256Hex(body).slice(0, 32)}"`,
        },
      },
    });
  }

  return { directory: fixturesDir, bindings };
}

/**
 * `https://<domain><allowed path>[<file>]`.
 *
 * Built from the robots allow-list rather than invented, so the URL the offline
 * run fetches is one the acquisition gate would also permit live.
 */
function fixtureUrl(domain: string, allowedPaths: readonly string[], file: string): string {
  const path = allowedPaths[0] ?? '/';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const suffix = normalized.endsWith('/') ? file : '';
  return `https://${domain}${normalized}${suffix}`;
}
