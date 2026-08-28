import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from '../../apps/api/src/openapi.js';
import { BUNDLED_VERTICALS, RUNTIMES } from '../../apps/edge/generated/runtime-registry.js';
import { isMain } from '../lib/cli-entry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');
export const OPENAPI_OUTPUT_PATH = join(REPO_ROOT, 'openapi', 'data-foundry-v1.openapi.json');

export interface GenerateOpenApiOptions {
  readonly outputPath?: string;
}

export function serializeOpenApi(): string {
  const [slug] = BUNDLED_VERTICALS;
  if (slug === undefined) throw new Error('At least one bundled vertical is required for OpenAPI generation.');
  if (BUNDLED_VERTICALS.length !== 1) {
    throw new Error(
      'The canonical OpenAPI artifact is vertical-specific; select one output per bundled vertical before bundling more than one.',
    );
  }
  const runtime = RUNTIMES[slug];
  if (runtime === undefined) throw new Error(`Missing compiled runtime for OpenAPI vertical "${slug}".`);
  return `${JSON.stringify(buildOpenApiDocument({ slug, fields: runtime.fields }), null, 2)}\n`;
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
  const outputPath = options.outputPath ?? OPENAPI_OUTPUT_PATH;
  const expected = serializeOpenApi();
  if (check) {
    if ((await readIfPresent(outputPath)) !== expected) {
      process.stderr.write(
        `Stale OpenAPI artifact: ${outputPath}. Run \`pnpm openapi:generate\` and commit the result.\n`,
      );
      return 1;
    }
    process.stdout.write('OK: OpenAPI artifact is current.\n');
    return 0;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, 'utf8');
  process.stdout.write(`Wrote ${outputPath}.\n`);
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
