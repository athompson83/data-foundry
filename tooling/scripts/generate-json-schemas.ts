/**
 * Generates `schemas/canonical/*.schema.json` from the Zod definitions.
 *
 * The Zod schemas are the source of truth; these JSON Schema files are a build
 * output for consumers that cannot import TypeScript — OpenAPI generation, MCP
 * tool definitions, Python/Splink in Phase 2, and external dataset consumers.
 *
 * Usage:
 *   pnpm schemas:generate   # write
 *   pnpm schemas:check      # CI gate: fail if the committed output is stale
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  CANONICAL_OBJECT_SCHEMAS,
  compareCodeUnits,
  type CanonicalObjectName,
} from '@data-foundry/canonical-schema';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(HERE, '..', '..', 'schemas', 'canonical');

const SCHEMA_BASE_URI = 'https://schemas.data-foundry.dev/canonical';

export interface GeneratedSchema {
  readonly name: CanonicalObjectName;
  readonly filename: string;
  readonly json: string;
}

/** Build the JSON Schema document for every registered canonical object. */
export function generateCanonicalJsonSchemas(): GeneratedSchema[] {
  const generated: GeneratedSchema[] = [];

  for (const [name, schema] of Object.entries(CANONICAL_OBJECT_SCHEMAS)) {
    const document = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
    const withMeta = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${SCHEMA_BASE_URI}/${name}.schema.json`,
      title: name,
      ...document,
    };
    generated.push({
      name: name as CanonicalObjectName,
      filename: `${name}.schema.json`,
      json: `${JSON.stringify(withMeta, null, 2)}\n`,
    });
  }

  generated.sort((a, b) => compareCodeUnits(a.filename, b.filename));
  return generated;
}

/** Manifest so consumers can discover the set without listing a directory. */
export function generateIndexDocument(schemas: readonly GeneratedSchema[]): string {
  return `${JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${SCHEMA_BASE_URI}/index.json`,
      title: 'data-foundry canonical schemas',
      description:
        'Generated from @data-foundry/canonical-schema. Do not edit by hand; run `pnpm schemas:generate`.',
      objects: schemas.map((schema) => ({ name: schema.name, file: schema.filename })),
    },
    null,
    2,
  )}\n`;
}

async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const schemas = generateCanonicalJsonSchemas();
  const files = new Map<string, string>([
    ...schemas.map((schema) => [schema.filename, schema.json] as const),
    ['index.json', generateIndexDocument(schemas)],
  ]);

  if (check) {
    const problems: string[] = [];
    let existing: string[] = [];
    try {
      existing = (await readdir(OUTPUT_DIR)).filter((name) => name.endsWith('.json'));
    } catch {
      problems.push(`${OUTPUT_DIR} does not exist. Run "pnpm schemas:generate".`);
    }
    for (const stale of existing.filter((name) => !files.has(name))) {
      problems.push(`Stale generated file: ${stale}`);
    }
    for (const [filename, expected] of files) {
      let actual: string;
      try {
        actual = await readFile(join(OUTPUT_DIR, filename), 'utf8');
      } catch {
        problems.push(`Missing generated file: ${filename}`);
        continue;
      }
      if (actual !== expected) {
        problems.push(`Out of date: ${filename}`);
      }
    }
    if (problems.length > 0) {
      console.error('JSON Schema exports are stale:');
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error('Run "pnpm schemas:generate" and commit the result.');
      return 1;
    }
    console.log(`OK: ${files.size} generated schema file(s) are up to date.`);
    return 0;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [filename, contents] of files) {
    await writeFile(join(OUTPUT_DIR, filename), contents, 'utf8');
  }
  console.log(`Wrote ${files.size} file(s) to ${OUTPUT_DIR}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}
