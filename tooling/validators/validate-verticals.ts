/**
 * Vertical configuration validator (CI gate).
 *
 * Verticals are configuration, not forks (AGENTS.md rule 4), so their config is
 * the thing that has to be validated. This script checks every directory under
 * `verticals/` against the minimum contract:
 *
 *   - `vertical.yaml` parses and matches the vertical config schema;
 *   - every file in `sources/` is a valid `SourceRegistryEntry`, i.e. it carries
 *     complete rights metadata (AGENTS.md rule 1 — a source declaration without
 *     rights metadata is not a valid declaration);
 *   - no source claims `status: ACTIVE` while failing the doc 13 activation gate;
 *   - the doc 11 required documentation files exist;
 *   - every operation the vertical declares is one the platform implements, in
 *     the namespace it was declared in (see `vertical-ops.ts`). Without this the
 *     first thing to notice a typo was the ingest worker, mid-crawl.
 *
 * Wave 1 does not own `verticals/`. Until that directory exists the validator
 * reports "nothing to validate" and exits 0, so CI is green now and starts
 * enforcing the moment the first vertical lands.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  RefreshPolicySchema,
  SchemaVersionSchema,
  SlugSchema,
  IdentifierSchema,
  VerticalStatusSchema,
} from '@data-foundry/canonical-schema';
import {
  evaluateSourceActivationGate,
  parseSourceRegistryEntry,
} from '@data-foundry/source-registry';
import { validateDeclaredOps } from './vertical-ops.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERTICALS_DIR = resolve(HERE, '..', '..', 'verticals');

/**
 * Minimum contract for `vertical.yaml`. Unknown keys are allowed — the verticals
 * package owns the full shape and may add to it; this validator only guarantees
 * that the platform-critical fields are present and well-formed.
 */
export const VerticalConfigSchema = z.looseObject({
  slug: SlugSchema,
  name: z.string().min(1),
  schema_version: SchemaVersionSchema,
  status: VerticalStatusSchema,
  default_refresh_policy: RefreshPolicySchema,
  entity_types: z.array(IdentifierSchema).min(1),
  relationship_predicates: z.array(IdentifierSchema),
});
export type VerticalConfig = z.infer<typeof VerticalConfigSchema>;

/** doc 11: "Every vertical folder must include ..." */
export const REQUIRED_VERTICAL_DOCS = [
  'README.md',
  'DATA_DICTIONARY.md',
  'SOURCES.md',
  'RIGHTS.md',
  'QUALITY.md',
  'CHANGELOG.md',
] as const;

export interface ValidationProblem {
  readonly file: string;
  readonly message: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listDirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

export async function validateVertical(dir: string, asOf: string): Promise<ValidationProblem[]> {
  const problems: ValidationProblem[] = [];
  const configPath = join(dir, 'vertical.yaml');

  if (!(await exists(configPath))) {
    return [{ file: configPath, message: 'missing vertical.yaml' }];
  }

  let config: VerticalConfig | null = null;
  try {
    const parsed = VerticalConfigSchema.safeParse(parseYaml(await readFile(configPath, 'utf8')));
    if (parsed.success) {
      config = parsed.data;
    } else {
      for (const issue of parsed.error.issues) {
        problems.push({
          file: configPath,
          message: `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        });
      }
    }
  } catch (error) {
    problems.push({
      file: configPath,
      message: `unparseable YAML: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  for (const doc of REQUIRED_VERTICAL_DOCS) {
    if (!(await exists(join(dir, doc)))) {
      problems.push({ file: join(dir, doc), message: 'required vertical document is missing' });
    }
  }

  // Runs before the sources/ check so a vertical missing its sources directory
  // still gets told about a bad op rather than only about the directory.
  problems.push(...(await validateDeclaredOps(dir, config?.slug ?? basename(dir))));

  const sourcesDir = join(dir, 'sources');
  if (!(await exists(sourcesDir))) {
    problems.push({ file: sourcesDir, message: 'missing sources/ directory' });
    return problems;
  }

  const sourceFiles = (await readdir(sourcesDir)).filter(
    (name) => name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.json'),
  );
  if (sourceFiles.length === 0) {
    problems.push({ file: sourcesDir, message: 'no source declarations found' });
  }

  const seenKeys = new Set<string>();
  for (const filename of sourceFiles.sort()) {
    const path = join(sourcesDir, filename);
    let raw: unknown;
    try {
      raw = parseYaml(await readFile(path, 'utf8'));
    } catch (error) {
      problems.push({
        file: path,
        message: `unparseable: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const result = parseSourceRegistryEntry(raw);
    if (!result.ok) {
      for (const message of result.errors) {
        problems.push({ file: path, message });
      }
      continue;
    }

    const entry = result.entry;
    if (seenKeys.has(entry.key)) {
      problems.push({ file: path, message: `duplicate source key "${entry.key}"` });
    }
    seenKeys.add(entry.key);

    if (config !== null && entry.vertical_slug !== config.slug) {
      problems.push({
        file: path,
        message: `vertical_slug "${entry.vertical_slug}" does not match vertical.yaml slug "${config.slug}"`,
      });
    }

    if (entry.status === 'ACTIVE') {
      const gate = evaluateSourceActivationGate(entry, asOf);
      for (const blocker of gate.blockers) {
        problems.push({
          file: path,
          message: `source is ACTIVE but fails the activation gate — ${blocker.code}: ${blocker.message}`,
        });
      }
    }
  }

  return problems;
}

export async function validateAllVerticals(
  root: string = VERTICALS_DIR,
  asOf: string = new Date().toISOString(),
): Promise<{ verticals: string[]; problems: ValidationProblem[] }> {
  if (!(await exists(root))) {
    return { verticals: [], problems: [] };
  }
  const names = (await listDirectories(root)).filter((name) => name !== '_template');
  const problems: ValidationProblem[] = [];
  for (const name of names) {
    problems.push(...(await validateVertical(join(root, name), asOf)));
  }
  return { verticals: names, problems };
}

async function main(): Promise<number> {
  const { verticals, problems } = await validateAllVerticals();

  if (verticals.length === 0) {
    console.log(`No verticals to validate (${VERTICALS_DIR} is absent or empty).`);
    return 0;
  }

  console.log(`Validated ${verticals.length} vertical(s): ${verticals.join(', ')}`);
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  ${problem.file}: ${problem.message}`);
    }
    return 1;
  }
  console.log('OK: all vertical configurations are valid.');
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
      process.exitCode = 1;
    });
}
