import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../../apps/api/src/openapi.js';
import { BUNDLED_VERTICALS, RUNTIMES } from '../../apps/edge/generated/runtime-registry.js';
import { isMain } from '../lib/cli-entry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OPENAPI_OUTPUT_PATH = join(REPO_ROOT, 'openapi', 'data-foundry-v1.openapi.json');
export const OPENAPI_OUTPUT_DIRECTORY = dirname(OPENAPI_OUTPUT_PATH);

export interface GenerateOpenApiOptions {
  /** Legacy single-artifact override retained for callers that target one vertical explicitly. */
  readonly outputPath?: string;
  /** Directory for the canonical per-edge-vertical artifacts. */
  readonly outputDirectory?: string;
}

type OpenApiRuntime = { readonly fields: readonly unknown[] };

function bundledSlugs(bundledVerticals: readonly string[]): readonly string[] {
  const slugs = [...bundledVerticals].sort();
  if (slugs.length === 0) throw new Error('At least one bundled vertical is required for OpenAPI generation.');
  if (new Set(slugs).size !== slugs.length) throw new Error('Bundled vertical slugs must be unique for OpenAPI generation.');
  return slugs;
}

function serializeOpenApiFor(
  slug: string,
  runtimes: Readonly<Record<string, OpenApiRuntime>>,
): string {
  const runtime = runtimes[slug];
  if (runtime === undefined) throw new Error(`Missing compiled runtime for OpenAPI vertical "${slug}".`);
  return `${JSON.stringify(buildOpenApiDocument({ slug, fields: runtime.fields }), null, 2)}\n`;
}

export function openApiArtifactFilename(slug: string): string {
  return `data-foundry-${slug}-v1.openapi.json`;
}

/**
 * One generated contract per edge vertical. Each API deployment selects one
 * vertical at runtime, so a single document cannot describe multiple field
 * schemas without losing the deployment-specific contract.
 */
export function serializeOpenApiArtifacts(
  bundledVerticals: readonly string[] = BUNDLED_VERTICALS,
  runtimes: Readonly<Record<string, OpenApiRuntime>> = RUNTIMES,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    bundledSlugs(bundledVerticals).map((slug) => [
      openApiArtifactFilename(slug),
      serializeOpenApiFor(slug, runtimes),
    ]),
  );
}

/** Backward-compatible content for consumers of the original single artifact path. */
export function serializeOpenApi(): string {
  const [slug] = bundledSlugs(BUNDLED_VERTICALS);
  if (slug === undefined) throw new Error('At least one bundled vertical is required for OpenAPI generation.');
  return serializeOpenApiFor(slug, RUNTIMES);
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function run(check: boolean, options: GenerateOpenApiOptions = {}): Promise<number> {
  if (options.outputPath !== undefined) {
    const expected = serializeOpenApi();
    if (check) {
      if ((await readIfPresent(options.outputPath)) !== expected) {
        process.stderr.write(
          `Stale OpenAPI artifact: ${options.outputPath}. Run \`pnpm openapi:generate\` and commit the result.\n`,
        );
        return 1;
      }
      process.stdout.write('OK: OpenAPI artifact is current.\n');
      return 0;
    }
    await mkdir(dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, expected, 'utf8');
    process.stdout.write(`Wrote ${options.outputPath}.\n`);
    return 0;
  }

  const outputDirectory = options.outputDirectory ?? OPENAPI_OUTPUT_DIRECTORY;
  const artifacts = {
    ...serializeOpenApiArtifacts(),
    // Preserve the original HVAC artifact path until downstream consumers have
    // moved to the per-vertical filename. Do not silently repoint that legacy
    // HVAC path when an alphabetically earlier vertical is bundled.
    ...(BUNDLED_VERTICALS.includes('hvac')
      ? { [OPENAPI_OUTPUT_PATH.split(/[\\/]/).at(-1) ?? 'data-foundry-v1.openapi.json']:
          serializeOpenApiFor('hvac', RUNTIMES) }
      : {}),
  };
  const expectedArtifacts = Object.entries(artifacts).map(([filename, content]) => ({
    path: join(outputDirectory, filename),
    content,
  }));
  if (check) {
    const stale = (await Promise.all(expectedArtifacts.map(async ({ path, content }) =>
      (await readIfPresent(path)) === content ? null : path,
    ))).filter((path): path is string => path !== null);
    if (stale.length > 0) {
      process.stderr.write(
        `Stale OpenAPI artifact(s): ${stale.join(', ')}. Run \`pnpm openapi:generate\` and commit the result.\n`,
      );
      return 1;
    }
    process.stdout.write(`OK: ${expectedArtifacts.length} OpenAPI artifact(s) are current.\n`);
    return 0;
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(expectedArtifacts.map(({ path, content }) => writeFile(path, content, 'utf8')));
  process.stdout.write(`Wrote ${expectedArtifacts.length} OpenAPI artifact(s) to ${outputDirectory}.\n`);
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.includes('--check')).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
