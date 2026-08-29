/** Generated JSON Schema artifact for offline rights-readiness evidence. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../lib/cli-entry.js';
import { serializeRightsEvidenceSnapshotJsonSchema } from './source-readiness.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_PATH = resolve(
  HERE,
  '..',
  '..',
  'schemas',
  'source-readiness-snapshot-v1.schema.json',
);

export async function run(check: boolean): Promise<number> {
  const expected = serializeRightsEvidenceSnapshotJsonSchema();
  if (check) {
    let actual: string;
    try {
      actual = await readFile(OUTPUT_PATH, 'utf8');
    } catch {
      console.error(`Missing generated file: ${OUTPUT_PATH}`);
      console.error('Run "pnpm source-readiness:schema:generate" and commit the result.');
      return 1;
    }
    if (actual !== expected) {
      console.error(`Out of date: ${OUTPUT_PATH}`);
      console.error('Run "pnpm source-readiness:schema:generate" and commit the result.');
      return 1;
    }
    console.log('OK: source-readiness snapshot JSON Schema is up to date.');
    return 0;
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, expected, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  return 0;
}

if (isMain(import.meta.url)) {
  run(process.argv.includes('--check'))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}
