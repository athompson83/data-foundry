/**
 * Operator-supplied bulk artifacts for the offline ingest path.
 *
 * Some sources publish a bulk file larger than any scheduled acquisition route
 * accepts (the 16 MiB direct-HTTP ceiling, the Worker ingestion limits). Their
 * initial load is an operator step: download the file, then run
 * `pnpm ingest --artifact <source-key>=<path>`. This module turns those files
 * into the same inline manifest the fixture harness uses, so the bytes go
 * through the *same* acquisition provider, rights gates, evidence store and
 * pipeline as every other offline run — nothing about rights is bypassed, and
 * the file (a ZIP archive, when that is what the publisher ships) is recorded as
 * the source artifact exactly as a fixture would be.
 *
 * The URL recorded for the artifact is derived from the source's own robots
 * allow-list plus the file's name, the same rule as for fixtures, so the
 * acquisition gate evaluates a request it would also permit live.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { sha256Hex, type ReadOnlyFileSystem } from '@data-foundry/acquisition';
import { PipelineConfigurationError } from './errors.js';
import type { VerticalConfig } from './config.js';
import { fixtureUrl, type FixtureBinding } from './fixtures.js';

/** YAML arrives untyped. */
type Yaml = any;

export interface OperatorArtifact {
  readonly sourceKey: string;
  readonly path: string;
}

/** The whole file is read into memory; beyond this the operator must split the load. */
export const MAX_OPERATOR_ARTIFACT_BYTES = 1024 * 1024 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.zip': 'application/zip',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

/** Virtual directory the inline manifest's files resolve against. */
export const OPERATOR_ARTIFACT_DIRECTORY = 'operator-artifacts';

export interface OperatorArtifactManifest {
  readonly directory: string;
  readonly bindings: readonly FixtureBinding[];
  /** Serves exactly the declared files, from the bytes already read and hashed. */
  readonly fs: ReadOnlyFileSystem;
}

export async function buildOperatorArtifactManifest(
  config: VerticalConfig,
  artifacts: readonly OperatorArtifact[],
): Promise<OperatorArtifactManifest> {
  const files = new Map<string, Uint8Array>();
  const bindings: FixtureBinding[] = [];
  const seen = new Set<string>();

  for (const { sourceKey, path } of artifacts) {
    if (seen.has(sourceKey)) {
      throw new PipelineConfigurationError(`--artifact names source "${sourceKey}" more than once`);
    }
    seen.add(sourceKey);
    const entry = config.sources.find((source) => source.key === sourceKey);
    if (entry === undefined) {
      throw new PipelineConfigurationError(
        `source "${sourceKey}" has no registry entry in vertical "${config.slug}"; ` +
          'an artifact cannot be loaded for a source without a rights record (AGENTS.md rule 1)',
      );
    }
    const mapping = ((config.sourceMappings?.sources ?? []) as Yaml[]).find(
      (candidate) => String(candidate.source_key) === sourceKey,
    );
    if (mapping === undefined) {
      throw new PipelineConfigurationError(`source "${sourceKey}" has no mapping in source-mappings.yaml`);
    }

    const absolute = resolve(path);
    const name = basename(absolute);
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    const mimeType = MIME_BY_EXTENSION[extension];
    if (mimeType === undefined) {
      throw new PipelineConfigurationError(
        `artifact ${name} for "${sourceKey}" has an unsupported extension; expected one of ` +
          Object.keys(MIME_BY_EXTENSION).join(', '),
      );
    }
    if (extension === '.zip' && mapping.parsing?.archive === undefined) {
      throw new PipelineConfigurationError(
        `artifact ${name} is a ZIP archive but source "${sourceKey}" declares no parsing.archive member`,
      );
    }
    let size: number;
    try {
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error('not a regular file');
      size = info.size;
    } catch (error) {
      throw new PipelineConfigurationError(
        `artifact for "${sourceKey}" is not a readable file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (size === 0 || size > MAX_OPERATOR_ARTIFACT_BYTES) {
      throw new PipelineConfigurationError(
        `artifact for "${sourceKey}" is ${size} bytes; it must be non-empty and at most ${MAX_OPERATOR_ARTIFACT_BYTES}`,
      );
    }
    const body = new Uint8Array(await readFile(absolute));
    const file = `${sourceKey}/${name}`;
    files.set(`${OPERATOR_ARTIFACT_DIRECTORY}/${file}`, body);
    bindings.push({
      sourceKey,
      file,
      entry: {
        url: fixtureUrl(entry.domain, entry.robots_policy.allowed_paths, encodeURIComponent(name)),
        file,
        status: 200,
        mimeType,
        // A validator derived from the bytes, as for fixtures.
        headers: { etag: `"${sha256Hex(body).slice(0, 32)}"` },
      },
    });
  }

  return {
    directory: OPERATOR_ARTIFACT_DIRECTORY,
    bindings,
    fs: {
      readFile: (path) => {
        const body = files.get(path);
        return body === undefined
          ? Promise.reject(new PipelineConfigurationError(`no operator artifact at ${path}`))
          : Promise.resolve(body);
      },
      exists: (path) => Promise.resolve(files.has(path)),
    },
  };
}
